(function () {
  "use strict";

  var APP  = "app_hello_lua";
  var root = document.querySelector(".nr-app") || document.body;

  var _modal    = null;
  var _delModal = null;
  var _detailOC = null;
  var _deleteId = null;
  var _viewedId = null;

  // ── Safe DOM helpers ──────────────────────────────────────────────────────
  // All use getElementById so they work regardless of where root is in the DOM.
  // Null-safe: never throw if an element doesn't exist.

  function el(id)          { return document.getElementById(id); }
  function setVal(id, v)   { var e = el(id); if (e) e.value       = v; }
  function getVal(id)      { var e = el(id); return e ? e.value   : ""; }
  function setText(id, v)  { var e = el(id); if (e) e.textContent = v; }
  function setHtml(id, v)  { var e = el(id); if (e) e.innerHTML   = v; }
  function hide(id)        { var e = el(id); if (e) e.classList.add("d-none"); }
  function show(id)        { var e = el(id); if (e) e.classList.remove("d-none"); }

  // ── Bootstrap overlay getters ─────────────────────────────────────────────

  function getModal() {
    if (!_modal) _modal = new bootstrap.Modal(el("hl-modal"));
    return _modal;
  }

  function getDelModal() {
    if (!_delModal) _delModal = new bootstrap.Modal(el("hl-del-modal"));
    return _delModal;
  }

  function getDetailOC() {
    if (!_detailOC) _detailOC = new bootstrap.Offcanvas(el("hl-detail"));
    return _detailOC;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleString(); } catch (_) { return s; }
  }

  function status(msg, type) {
    var s = el("hl-status");
    if (!s) return;
    s.textContent = msg;
    s.className = "hl-status hl-status-" + (type || "info");
    s.classList.remove("d-none");
    clearTimeout(s._timer);
    s._timer = setTimeout(function () { s.classList.add("d-none"); }, 3000);
  }

  // ── API ───────────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  var STATUS_BADGE = {
    open: '<span class="badge bg-warning text-dark">open</span>',
    done: '<span class="badge bg-success">done</span>',
  };

  function renderRows(rows) {
    var tbody   = root.querySelector("#hl-tbody");
    var emptyTr = root.querySelector("#hl-empty-row");

    Array.from(tbody.querySelectorAll("tr.hl-row")).forEach(function (r) { r.remove(); });

    if (!rows || rows.length === 0) {
      if (emptyTr) emptyTr.classList.remove("d-none");
      return;
    }
    if (emptyTr) emptyTr.classList.add("d-none");

    rows.forEach(function (item) {
      var p = {};
      try { p = JSON.parse(item.payload || "{}"); } catch (_) {}

      var tr = document.createElement("tr");
      tr.className         = "hl-row";
      tr.dataset.id        = item.id;
      tr.dataset.title     = p.title       || "";
      tr.dataset.status    = p.status      || "open";
      tr.dataset.note      = p.note        || "";
      tr.dataset.createdAt = item.created_at || "";
      tr.dataset.updatedAt = item.updated_at || "";
      tr.innerHTML =
        "<td>" + esc(p.title || "—") + "</td>" +
        "<td>" + (STATUS_BADGE[p.status] || esc(p.status)) + "</td>" +
        "<td class='text-secondary small'>" + esc(p.note || "") + "</td>" +
        "<td class='text-end'>" +
          "<button class='btn btn-link btn-sm py-0 px-1' data-action='view-row'>View</button>" +
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

  // ── Detail offcanvas ──────────────────────────────────────────────────────

  function fillDetail(id, title, st, note, createdAt, updatedAt) {
    setText("hl-detail-id",      id    || "—");
    setText("hl-detail-title",   title || "—");
    setHtml("hl-detail-status",  STATUS_BADGE[st] || esc(st) || "—");
    setText("hl-detail-note",    note  || "—");
    setText("hl-detail-created", fmtDate(createdAt));
    setText("hl-detail-updated", fmtDate(updatedAt));
    hide("hl-detail-error");
  }

  function fillDetailForm(p) {
    setVal("hl-det-desc",     p.description || "");
    setVal("hl-det-priority", p.priority    || "");
    setVal("hl-det-due",      p.due_date    || "");
    setVal("hl-det-tags",     p.tags        || "");
  }

  function viewDetail(row) {
    _viewedId = row.dataset.id;
    fillDetail(
      row.dataset.id, row.dataset.title, row.dataset.status,
      row.dataset.note, row.dataset.createdAt, row.dataset.updatedAt
    );
    fillDetailForm({});
    getDetailOC().show();

    call({ action: "get", id: _viewedId })
      .then(function (data) {
        if (!data.ok || !data.item) return;
        var p = {};
        try { p = JSON.parse(data.item.payload || "{}"); } catch (_) {}
        fillDetail(data.item.id, p.title, p.status, p.note, data.item.created_at, data.item.updated_at);
      })
      .catch(function () {});

    call({ action: "get_detail", item_id: _viewedId })
      .then(function (data) {
        if (!data.ok || !data.detail) return;
        var p = {};
        try { p = JSON.parse(data.detail.payload || "{}"); } catch (_) {}
        fillDetailForm(p);
      })
      .catch(function () {});
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function clearDetailFields() {
    setVal("hl-edit-desc",     "");
    setVal("hl-edit-priority", "");
    setVal("hl-edit-due",      "");
    setVal("hl-edit-tags",     "");
  }

  function openCreate() {
    setText("hl-modal-title", "New Item");
    setVal("hl-edit-id",      "");
    setVal("hl-edit-title",   "");
    setVal("hl-edit-status",  "open");
    setVal("hl-edit-note",    "");
    hide("hl-modal-error");
    clearDetailFields();
    getModal().show();
    setTimeout(function () { var e = el("hl-edit-title"); if (e) e.focus(); }, 300);
  }

  function openEdit(row) {
    setText("hl-modal-title", "Edit Item");
    setVal("hl-edit-id",     row.dataset.id);
    setVal("hl-edit-title",  row.dataset.title);
    setVal("hl-edit-status", row.dataset.status);
    setVal("hl-edit-note",   row.dataset.note);
    hide("hl-modal-error");
    clearDetailFields();
    getModal().show();
    setTimeout(function () { var e = el("hl-edit-title"); if (e) e.focus(); }, 300);

    call({ action: "get_detail", item_id: row.dataset.id })
      .then(function (data) {
        if (!data.ok || !data.detail) return;
        var p = {};
        try { p = JSON.parse(data.detail.payload || "{}"); } catch (_) {}
        setVal("hl-edit-desc",     p.description || "");
        setVal("hl-edit-priority", p.priority    || "");
        setVal("hl-edit-due",      p.due_date    || "");
        setVal("hl-edit-tags",     p.tags        || "");
      })
      .catch(function () {});
  }

  function saveItem() {
    var id       = getVal("hl-edit-id").trim();
    var title    = getVal("hl-edit-title").trim();
    var st       = getVal("hl-edit-status");
    var note     = getVal("hl-edit-note").trim();
    var desc     = getVal("hl-edit-desc").trim();
    var priority = getVal("hl-edit-priority");
    var dueDate  = getVal("hl-edit-due");
    var tags     = getVal("hl-edit-tags").trim();
    var errEl    = el("hl-modal-error");

    if (!title) {
      if (errEl) { errEl.textContent = "Title is required."; show("hl-modal-error"); }
      return;
    }
    hide("hl-modal-error");

    // Detail fields are sent in the same payload — Lua writes both domains
    // in one execute() call → one atomic ledger event.
    var action  = id ? "update" : "create";
    var payload = {
      action: action, title: title, status: st, note: note,
      description: desc, priority: priority, due_date: dueDate, tags: tags,
    };
    if (id) payload.id = id;

    call(payload)
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "failed");
        getModal().hide();
        status(id ? "Item updated." : "Item created.", "ok");
        loadList();
      })
      .catch(function (err) {
        if (errEl) { errEl.textContent = err.message; show("hl-modal-error"); }
      });
  }

  // ── Event delegation ──────────────────────────────────────────────────────

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

      case "save-detail": {
        if (!_viewedId) break;
        hide("hl-detail-error");
        var detPayload = {
          action:      "save_detail",
          item_id:     _viewedId,
          description: getVal("hl-det-desc").trim(),
          priority:    getVal("hl-det-priority"),
          due_date:    getVal("hl-det-due"),
          tags:        getVal("hl-det-tags").trim(),
        };
        call(detPayload)
          .then(function (data) {
            if (!data.ok) throw new Error(data.error || "failed");
            status("Details saved.", "ok");
          })
          .catch(function (err) {
            setText("hl-detail-error", err.message);
            show("hl-detail-error");
          });
        break;
      }

      case "view-row": {
        var row = btn.closest("tr.hl-row");
        if (row) viewDetail(row);
        break;
      }

      case "edit-row": {
        var row = btn.closest("tr.hl-row");
        if (row) openEdit(row);
        break;
      }

      case "detail-edit": {
        getDetailOC().hide();
        var editRow = root.querySelector("tr.hl-row[data-id='" + _viewedId + "']");
        if (editRow) openEdit(editRow);
        break;
      }

      case "detail-delete": {
        if (!_viewedId) break;
        var delRow = root.querySelector("tr.hl-row[data-id='" + _viewedId + "']");
        _deleteId = _viewedId;
        setText("hl-del-title", (delRow && delRow.dataset.title) || "this item");
        getDetailOC().hide();
        getDelModal().show();
        break;
      }

      case "delete-row": {
        var row = btn.closest("tr.hl-row");
        if (!row) break;
        _deleteId = row.dataset.id;
        setText("hl-del-title", row.dataset.title || "this item");
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

  // ── Real-time events from Lua ─────────────────────────────────────────────

  window.addEventListener("adminws:edge_event", function (e) {
    var d = e.detail;
    if (!d || d.app_id !== APP) return;
    if (d.event === "item_created" || d.event === "item_updated" || d.event === "item_deleted") {
      loadList();
    }
  });

  // ── Enter key in modal ────────────────────────────────────────────────────

  var _modalEl = el("hl-modal");
  if (_modalEl) _modalEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      saveItem();
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────

  loadList();

})();
