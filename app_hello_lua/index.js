(function () {
  "use strict";

  var APP  = "app_hello_lua";
  var root = document.querySelector(".nr-app") || document.body;

  var _modal    = null;
  var _delModal = null;
  var _deleteId = null;

  // ── Bootstrap modals ──────────────────────────────────────────────────────

  function getModal() {
    if (!_modal) _modal = new bootstrap.Modal(root.querySelector("#hl-modal"));
    return _modal;
  }

  function getDelModal() {
    if (!_delModal) _delModal = new bootstrap.Modal(root.querySelector("#hl-del-modal"));
    return _delModal;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function status(msg, type) {
    var el = root.querySelector("#hl-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "hl-status hl-status-" + (type || "info");
    el.classList.remove("d-none");
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.add("d-none"); }, 3000);
  }

  // ── API ────────────────────────────────────────────────────────────────────

  async function call(payload) {
    var res  = await fetch("/api/sync/" + APP, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  var STATUS_BADGE = {
    open: '<span class="badge bg-warning text-dark">open</span>',
    done: '<span class="badge bg-success">done</span>',
  };

  function renderRows(rows) {
    var tbody   = root.querySelector("#hl-tbody");
    var emptyTr = root.querySelector("#hl-empty-row");

    // Remove old data rows (keep empty row template)
    Array.from(tbody.querySelectorAll("tr.hl-row")).forEach(function (r) { r.remove(); });

    if (!rows || rows.length === 0) {
      if (emptyTr) emptyTr.classList.remove("d-none");
      return;
    }
    if (emptyTr) emptyTr.classList.add("d-none");

    rows.forEach(function (item) {
      // payload is a JSON string in the SQLite TEXT column — parse it.
      var p = {};
      try { p = JSON.parse(item.payload || "{}"); } catch (_) {}

      var tr = document.createElement("tr");
      tr.className = "hl-row";
      tr.dataset.id     = item.id;
      tr.dataset.title  = p.title  || "";
      tr.dataset.status = p.status || "open";
      tr.dataset.note   = p.note   || "";
      tr.innerHTML =
        "<td>" + esc(p.title || "—") + "</td>" +
        "<td>" + (STATUS_BADGE[p.status] || esc(p.status)) + "</td>" +
        "<td class='text-secondary small'>" + esc(p.note || "") + "</td>" +
        "<td class='text-end'>" +
          "<button class='btn btn-link btn-sm py-0 px-1' data-action='edit-row'>Edit</button>" +
          "<button class='btn btn-link btn-sm py-0 px-1 text-danger' data-action='delete-row'>Del</button>" +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function loadList() {
    call({ action: "list" })
      .then(function (data) {
        var rows = Array.isArray(data) ? data : (data.rows || []);
        renderRows(rows);
      })
      .catch(function (err) { status(err.message, "error"); });
  }

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function openCreate() {
    var m = root.querySelector("#hl-modal");
    m.querySelector("#hl-modal-title").textContent = "New Item";
    m.querySelector("#hl-edit-id").value    = "";
    m.querySelector("#hl-edit-title").value = "";
    m.querySelector("#hl-edit-status").value = "open";
    m.querySelector("#hl-edit-note").value  = "";
    m.querySelector("#hl-modal-error").classList.add("d-none");
    getModal().show();
    setTimeout(function () { m.querySelector("#hl-edit-title").focus(); }, 300);
  }

  function openEdit(row) {
    var m = root.querySelector("#hl-modal");
    m.querySelector("#hl-modal-title").textContent = "Edit Item";
    m.querySelector("#hl-edit-id").value     = row.dataset.id;
    m.querySelector("#hl-edit-title").value  = row.dataset.title;
    m.querySelector("#hl-edit-status").value = row.dataset.status;
    m.querySelector("#hl-edit-note").value   = row.dataset.note;
    m.querySelector("#hl-modal-error").classList.add("d-none");
    getModal().show();
    setTimeout(function () { m.querySelector("#hl-edit-title").focus(); }, 300);
  }

  function saveItem() {
    var m      = root.querySelector("#hl-modal");
    var id     = m.querySelector("#hl-edit-id").value.trim();
    var title  = m.querySelector("#hl-edit-title").value.trim();
    var st     = m.querySelector("#hl-edit-status").value;
    var note   = m.querySelector("#hl-edit-note").value.trim();
    var errEl  = m.querySelector("#hl-modal-error");

    if (!title) {
      errEl.textContent = "Title is required.";
      errEl.classList.remove("d-none");
      return;
    }
    errEl.classList.add("d-none");

    var action  = id ? "update" : "create";
    var payload = { action: action, title: title, status: st, note: note };
    if (id) payload.id = id;

    call(payload)
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "failed");
        getModal().hide();
        status(id ? "Item updated." : "Item created.", "ok");
        loadList();
      })
      .catch(function (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("d-none");
      });
  }

  // ── Event delegation ───────────────────────────────────────────────────────

  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;

    switch (btn.dataset.action) {

      case "open-create":
        openCreate();
        break;

      case "save-item":
        saveItem();
        break;

      case "edit-row": {
        var row = btn.closest("tr.hl-row");
        if (row) openEdit(row);
        break;
      }

      case "delete-row": {
        var row = btn.closest("tr.hl-row");
        if (!row) break;
        _deleteId = row.dataset.id;
        root.querySelector("#hl-del-title").textContent = row.dataset.title || "this item";
        getDelModal().show();
        break;
      }

      case "confirm-delete":
        if (!_deleteId) break;
        call({ action: "delete", id: _deleteId })
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || "failed");
            getDelModal().hide();
            _deleteId = null;
            status("Item deleted.", "ok");
            loadList();
          })
          .catch(function (err) { status(err.message, "error"); });
        break;
    }
  });

  // ── Real-time events from Lua ──────────────────────────────────────────────

  window.addEventListener("adminws:edge_event", function (e) {
    var d = e.detail;
    if (!d || d.app_id !== APP) return;
    // Reload list on any CRUD event from another session or dispatch.
    if (d.event === "item_created" || d.event === "item_updated" || d.event === "item_deleted") {
      loadList();
    }
  });

  // ── Enter key in modal ─────────────────────────────────────────────────────

  root.querySelector("#hl-modal") && root.querySelector("#hl-modal")
    .addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        saveItem();
      }
    });

  // ── Init ───────────────────────────────────────────────────────────────────

  loadList();

})();
