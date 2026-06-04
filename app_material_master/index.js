(function () {
  "use strict";

  var root = document.querySelector(".nr-app") || document.body;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function el(id) { return root.querySelector("#" + id); }

  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  async function api(body) {
    var res = await fetch("/api/sync/app_material_master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch (_) { throw new Error(text); }
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  function showScreen(name) {
    ["list", "detail", "form"].forEach(function (s) {
      el("mm-screen-" + s).classList.toggle("d-none", s !== name);
    });
  }

  var STATUS_COLORS = {
    DRAFT: "secondary", ACTIVE: "success", DEPRECATED: "warning", INACTIVE: "danger"
  };

  function statusBadge(status) {
    return '<span class="badge bg-' + (STATUS_COLORS[status] || "secondary") + '">' + esc(status) + "</span>";
  }

  // ── State ──────────────────────────────────────────────────────────────────

  var state = {
    page: 1, perPage: 25, totalRows: 0,
    sort: "updated_at", dir: "desc",
    search: "", statuses: [], categories: [],
    uoms: [], cats: [],
    currentMaterial: null,
    editMode: false,
    skuCheckTimer: null,
  };

  // ── Bootstrap modals/offcanvas (set up lazily after DOM is ready) ──────────

  var uomModal, catDrawer;

  function getUomModal() {
    if (!uomModal) uomModal = new bootstrap.Modal(el("mm-uom-modal"));
    return uomModal;
  }
  function getCatDrawer() {
    if (!catDrawer) catDrawer = new bootstrap.Offcanvas(el("mm-cat-drawer"));
    return catDrawer;
  }

  // ── Grid (Bootstrap table) ────────────────────────────────────────────────

  function initGrid() {
    // wire sortable column headers
    root.querySelectorAll(".mm-list-table th[data-col]").forEach(function (th) {
      th.style.cursor = "pointer";
      th.addEventListener("click", function () {
        var col = th.dataset.col;
        if (state.sort === col) {
          state.dir = state.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort = col;
          state.dir = "desc";
        }
        state.page = 1;
        updateSortIcons();
        loadList();
      });
    });
  }

  function updateSortIcons() {
    root.querySelectorAll(".mm-list-table th[data-col]").forEach(function (th) {
      var icon = th.querySelector(".mm-sort-icon");
      if (!icon) return;
      if (th.dataset.col === state.sort) {
        icon.setAttribute("data-lucide", state.dir === "asc" ? "chevron-up" : "chevron-down");
      } else {
        icon.setAttribute("data-lucide", "chevrons-up-down");
      }
    });
    lucide.createIcons();
  }

  function renderGridRows(rows) {
    var tbody = el("mm-grid-body");
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No materials found</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      return '<tr class="mm-grid-row" data-id="' + esc(r.id) + '" style="cursor:pointer">'
        + '<td><code>' + esc(r.sku_code) + '</code></td>'
        + '<td>' + esc(r.name) + '</td>'
        + '<td>' + esc(r.category_name) + '</td>'
        + '<td class="text-center"><span class="badge bg-secondary">' + esc(r.base_uom_code) + '</span></td>'
        + '<td class="text-center"><span class="badge bg-secondary">' + esc(r.tracking_profile) + '</span></td>'
        + '<td class="text-center">' + statusBadge(r.status) + '</td>'
        + '<td class="text-muted small">' + dayjs(r.updated_at).format("DD/MM/YYYY HH:mm") + '</td>'
        + '</tr>';
    }).join("");
  }

  function loadList() {
    var selStatus = Array.from(root.querySelectorAll(".mm-status-chk:checked")).map(function (c) { return c.value; });
    var selCat    = Array.from(root.querySelectorAll(".mm-cat-chk:checked")).map(function (c) { return c.value; });
    el("mm-grid-body").innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Loading…</td></tr>';

    api({
      action: "list_materials",
      search: state.search,
      statuses: selStatus,
      categories: selCat,
      page: state.page,
      per_page: state.perPage,
      sort: state.sort,
      dir: state.dir,
    }).then(function (data) {
      state.totalRows = data.total;
      renderGridRows(data.rows);
      updatePager();
      updateSortIcons();
    }).catch(function (e) {
      el("mm-grid-body").innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">' + esc(e.message) + '</td></tr>';
    });
  }

  function updatePager() {
    var pages = Math.max(1, Math.ceil(state.totalRows / state.perPage));
    el("mm-page-info").textContent =
      "Page " + state.page + " of " + pages + " (" + state.totalRows + " total)";
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  function openDetail(row) {
    api({ action: "get_material", id: row.id }).then(function (mat) {
      state.currentMaterial = mat;
      renderDetail(mat);
      showScreen("detail");
      lucide.createIcons();
    });
  }

  function renderDetail(mat) {
    el("mm-detail-name").textContent = mat.name;
    el("mm-detail-sku").textContent  = mat.sku_code;
    el("mm-detail-breadcrumb").textContent = mat.sku_code;

    var badge = el("mm-detail-status-badge");
    badge.textContent = mat.status;
    badge.className   = "badge bg-" + (STATUS_COLORS[mat.status] || "secondary") + " mm-status-badge";

    var specFields = [
      ["SKU / Part Number", mat.sku_code],
      ["Material Name",     mat.name],
      ["Description",       mat.description || "—"],
      ["Category",          mat.category_name],
      ["Base UoM",          mat.base_uom_code + " – " + mat.base_uom_name],
      ["Lifecycle Status",  statusBadge(mat.status)],
      ["Tracking Profile",  mat.tracking_profile],
      ["Created",           dayjs(mat.created_at).format("DD/MM/YYYY HH:mm")],
      ["Last Modified",     dayjs(mat.updated_at).format("DD/MM/YYYY HH:mm")],
    ];

    var attrs = mat.attributes || {};
    Object.keys(attrs).forEach(function (k) {
      specFields.push([k, esc(attrs[k])]);
    });

    el("mm-specs-grid").innerHTML = specFields.map(function (f) {
      return '<div class="col-12 col-md-6">'
        + '<div class="mm-spec-row">'
        + '<span class="mm-spec-key">' + esc(f[0]) + '</span>'
        + '<span class="mm-spec-val">' + f[1] + '</span>'
        + '</div></div>';
    }).join("");

    var convRows = (mat.conversions || []).map(function (c) {
      return "<tr><td><code>" + esc(c.uom_code) + "</code></td>"
        + "<td>" + esc(c.uom_name) + "</td>"
        + "<td>" + esc(c.conversion_factor) + "</td>"
        + '<td class="text-muted small">1 ' + esc(c.uom_code) + " = " + esc(c.conversion_factor) + " " + esc(mat.base_uom_code) + "</td>"
        + "</tr>";
    }).join("");
    el("mm-conv-tbody").innerHTML = convRows || '<tr><td colspan="4" class="text-muted text-center py-3">No conversions defined</td></tr>';

    el("mm-audit-timeline").innerHTML =
      '<div class="mm-timeline-item">'
      + '<span class="mm-timeline-dot"></span>'
      + '<div class="mm-timeline-body">'
      + '<strong>Last updated</strong>'
      + '<div class="text-muted small">' + dayjs(mat.updated_at).format("DD/MM/YYYY HH:mm") + '</div>'
      + '</div></div>'
      + '<div class="mm-timeline-item">'
      + '<span class="mm-timeline-dot"></span>'
      + '<div class="mm-timeline-body">'
      + '<strong>Created</strong>'
      + '<div class="text-muted small">' + dayjs(mat.created_at).format("DD/MM/YYYY HH:mm") + '</div>'
      + '</div></div>';
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  function openForm(mat) {
    state.editMode = !!mat;
    populateFormSelects();

    el("mm-form-title").textContent = mat ? "Edit Material" : "New Material";
    el("mm-form-bc-action").textContent = mat ? "Edit" : "New";
    el("mm-form-bc-detail").innerHTML = mat
      ? '<a href="#" data-action="back-to-detail">' + esc(mat.sku_code) + '</a>'
      : "";

    el("mm-f-sku").value      = mat ? mat.sku_code : "";
    el("mm-f-sku-auto").checked = false;
    el("mm-f-name").value     = mat ? mat.name : "";
    el("mm-f-desc").value     = mat ? (mat.description || "") : "";
    el("mm-f-status").value   = mat ? mat.status : "DRAFT";
    el("mm-f-tracking").value = mat ? mat.tracking_profile : "NONE";
    el("mm-f-sku").dataset.editId = mat ? mat.id : "";
    el("mm-sku-feedback").textContent = "";
    el("mm-form-error").classList.add("d-none");

    // disable base UoM in edit (treat as always locked for safety)
    el("mm-f-uom").disabled = !!mat;

    setTimeout(function () {
      if (mat) {
        el("mm-f-cat").value = mat.category_id;
        el("mm-f-uom").value = mat.base_uom_id;
        renderConvFormRows(mat.conversions || []);
        renderAttrsPanel(mat.attributes || {});
      } else {
        renderConvFormRows([]);
        renderAttrsPanel({});
      }
      lucide.createIcons();
    }, 0);

    showScreen("form");
    lucide.createIcons();
  }

  function populateFormSelects() {
    var catSel = el("mm-f-cat");
    catSel.innerHTML = '<option value="">— Select Category —</option>'
      + state.cats.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.code) + ' – ' + esc(c.name) + '</option>';
      }).join("");

    var uomSel = el("mm-f-uom");
    uomSel.innerHTML = '<option value="">— Select UoM —</option>'
      + state.uoms.map(function (u) {
        return '<option value="' + esc(u.id) + '">' + esc(u.code) + ' – ' + esc(u.name) + '</option>';
      }).join("");
  }

  function renderConvFormRows(convs) {
    var tbody = el("mm-conv-form-tbody");
    tbody.innerHTML = "";
    convs.forEach(function (c) { addConvRow(c); });
  }

  function addConvRow(c) {
    c = c || {};
    var tr = document.createElement("tr");
    tr.className = "mm-conv-row";
    var uomOpts = state.uoms.map(function (u) {
      var sel = (c.alt_uom_id && c.alt_uom_id === u.id) ? ' selected' : "";
      return '<option value="' + esc(u.id) + '"' + sel + '>' + esc(u.code) + ' – ' + esc(u.name) + '</option>';
    }).join("");
    tr.innerHTML = '<td><select class="form-select form-select-sm mm-conv-uom">'
      + '<option value="">— UoM —</option>' + uomOpts + '</select></td>'
      + '<td><input type="number" class="form-control form-control-sm mm-conv-factor" '
      + 'min="0.0001" step="0.0001" value="' + esc(c.conversion_factor || "") + '" /></td>'
      + '<td class="text-muted small mm-conv-label">—</td>'
      + '<td><button class="btn btn-sm btn-outline-danger" data-action="remove-conv-row">'
      + '<i data-lucide="trash-2"></i></button></td>';
    el("mm-conv-form-tbody").appendChild(tr);
    lucide.createIcons();
  }

  function renderAttrsPanel(attrs) {
    var keys = Object.keys(attrs);
    if (keys.length === 0) {
      el("mm-attrs-panel").innerHTML =
        '<p class="text-muted small mb-2">No custom attributes. Add below.</p>' + attrAddWidget();
    } else {
      el("mm-attrs-panel").innerHTML = keys.map(function (k) {
        return '<div class="d-flex gap-2 mb-2 mm-attr-row">'
          + '<input type="text" class="form-control form-control-sm mm-attr-key" value="' + esc(k) + '" placeholder="Key" />'
          + '<input type="text" class="form-control form-control-sm mm-attr-val" value="' + esc(attrs[k]) + '" placeholder="Value" />'
          + '<button class="btn btn-sm btn-outline-danger" data-action="remove-attr-row">'
          + '<i data-lucide="trash-2"></i></button></div>';
      }).join("") + attrAddWidget();
      lucide.createIcons();
    }
  }

  function attrAddWidget() {
    return '<button class="btn btn-sm btn-outline-secondary" data-action="add-attr-row">'
      + '<i data-lucide="plus"></i> Add Attribute</button>';
  }

  function collectFormData() {
    var convs = [];
    el("mm-conv-form-tbody").querySelectorAll(".mm-conv-row").forEach(function (tr) {
      var uomId = tr.querySelector(".mm-conv-uom").value;
      var factor = parseFloat(tr.querySelector(".mm-conv-factor").value);
      if (uomId && factor > 0) convs.push({ alt_uom_id: uomId, conversion_factor: factor });
    });

    var attrs = {};
    el("mm-attrs-panel").querySelectorAll(".mm-attr-row").forEach(function (row) {
      var k = row.querySelector(".mm-attr-key").value.trim();
      var v = row.querySelector(".mm-attr-val").value.trim();
      if (k) attrs[k] = v;
    });

    return {
      sku_code:         el("mm-f-sku").value.trim(),
      name:             el("mm-f-name").value.trim(),
      description:      el("mm-f-desc").value.trim(),
      category_id:      el("mm-f-cat").value,
      base_uom_id:      el("mm-f-uom").value,
      status:           el("mm-f-status").value,
      tracking_profile: el("mm-f-tracking").value,
      attributes:       attrs,
      conversions:      convs,
    };
  }

  async function saveMaterial() {
    var mat = collectFormData();
    var err = "";
    if (!mat.sku_code)    err = "SKU code is required.";
    else if (!mat.name)   err = "Material name is required.";
    else if (!mat.category_id) err = "Category is required.";
    else if (!mat.base_uom_id) err = "Base UoM is required.";

    if (err) {
      el("mm-form-error").textContent = err;
      el("mm-form-error").classList.remove("d-none");
      return;
    }
    el("mm-form-error").classList.add("d-none");

    try {
      var editId = el("mm-f-sku").dataset.editId;
      var result;
      if (editId) {
        result = await api({ action: "update_material", id: editId, material: mat });
      } else {
        result = await api({ action: "create_material", material: mat });
      }
      if (result.error) {
        el("mm-form-error").textContent = result.error;
        el("mm-form-error").classList.remove("d-none");
        return;
      }
      if (editId) {
        openDetail({ id: editId });
      } else {
        showScreen("list");
        loadList();
      }
    } catch (e) {
      el("mm-form-error").textContent = e.message;
      el("mm-form-error").classList.remove("d-none");
    }
  }

  // ── SKU auto-check ─────────────────────────────────────────────────────────

  function checkSku(value) {
    var excludeId = el("mm-f-sku").dataset.editId || "";
    clearTimeout(state.skuCheckTimer);
    state.skuCheckTimer = setTimeout(function () {
      api({ action: "check_sku", sku_code: value, exclude_id: excludeId })
        .then(function (res) {
          var fb = el("mm-sku-feedback");
          if (res.exists) {
            fb.textContent = "SKU already exists.";
            fb.className = "form-text text-danger";
          } else if (value.length > 0) {
            fb.textContent = "SKU is available.";
            fb.className = "form-text text-success";
          } else {
            fb.textContent = "";
          }
        });
    }, 400);
  }

  // ── UoM Modal ──────────────────────────────────────────────────────────────

  function renderUomList() {
    el("mm-uom-list-area").innerHTML = state.uoms.length === 0
      ? '<p class="text-muted small">No UoMs defined.</p>'
      : '<table class="table table-sm mm-table mb-0"><thead><tr>'
        + '<th>Code</th><th>Name</th><th>Fractional</th><th></th>'
        + '</tr></thead><tbody>'
        + state.uoms.map(function (u) {
          return '<tr>'
            + '<td><code>' + esc(u.code) + '</code></td>'
            + '<td>' + esc(u.name) + '</td>'
            + '<td>' + (u.allow_fractional ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>') + '</td>'
            + '<td class="text-end">'
            + '<button class="btn btn-xs btn-outline-secondary me-1" data-action="edit-uom" data-id="' + esc(u.id) + '">Edit</button>'
            + '<button class="btn btn-xs btn-outline-danger" data-action="delete-uom" data-id="' + esc(u.id) + '">Del</button>'
            + '</td></tr>';
        }).join("") + '</tbody></table>';
  }

  function resetUomForm() {
    el("mm-uom-edit-id").value = "";
    el("mm-uom-code").value = "";
    el("mm-uom-name").value = "";
    el("mm-uom-frac").checked = false;
    el("mm-uom-form-title").textContent = "Add UoM";
    el("mm-uom-cancel-edit").classList.add("d-none");
    el("mm-uom-form-error").classList.add("d-none");
  }

  async function saveUom() {
    var code = el("mm-uom-code").value.trim();
    var name = el("mm-uom-name").value.trim();
    var frac = el("mm-uom-frac").checked;
    var uid  = el("mm-uom-edit-id").value;
    if (!code || !name) {
      el("mm-uom-form-error").textContent = "Code and Name are required.";
      el("mm-uom-form-error").classList.remove("d-none");
      return;
    }
    try {
      if (uid) {
        await api({ action: "update_uom", id: uid, code: code, name: name, allow_fractional: frac });
      } else {
        await api({ action: "create_uom", code: code, name: name, allow_fractional: frac });
      }
      await refreshUoms();
      renderUomList();
      resetUomForm();
      populateFormSelects();
    } catch (e) {
      el("mm-uom-form-error").textContent = e.message;
      el("mm-uom-form-error").classList.remove("d-none");
    }
  }

  async function refreshUoms() {
    var data = await api({ action: "list_uoms" });
    state.uoms = data.rows;
  }

  // ── Category Drawer ────────────────────────────────────────────────────────

  function renderCatTree() {
    if (state.cats.length === 0) {
      el("mm-cat-tree-area").innerHTML = '<p class="text-muted small">No categories yet.</p>';
      return;
    }
    el("mm-cat-tree-area").innerHTML = '<table class="table table-sm mm-table mb-0"><thead><tr>'
      + '<th>Code</th><th>Name</th><th>Parent</th><th></th>'
      + '</tr></thead><tbody>'
      + state.cats.map(function (c) {
        return '<tr>'
          + '<td><code>' + esc(c.code) + '</code></td>'
          + '<td>' + esc(c.name) + '</td>'
          + '<td>' + esc(c.parent_name || "—") + '</td>'
          + '<td class="text-end">'
          + '<button class="btn btn-xs btn-outline-secondary me-1" data-action="edit-cat" data-id="' + esc(c.id) + '">Edit</button>'
          + '<button class="btn btn-xs btn-outline-danger" data-action="delete-cat" data-id="' + esc(c.id) + '">Del</button>'
          + '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  function resetCatForm() {
    el("mm-cat-edit-id").value = "";
    el("mm-cat-code").value = "";
    el("mm-cat-name").value = "";
    el("mm-cat-parent").value = "";
    el("mm-cat-form-title").textContent = "Add Category";
    el("mm-cat-cancel-edit").classList.add("d-none");
    el("mm-cat-form-error").classList.add("d-none");
  }

  function populateCatParentSelect(excludeId) {
    var sel = el("mm-cat-parent");
    sel.innerHTML = '<option value="">— Root —</option>'
      + state.cats.filter(function (c) { return c.id !== excludeId; })
        .map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.code) + ' – ' + esc(c.name) + '</option>';
        }).join("");
  }

  function populateCatFilterSelect() {
    var prev = Array.from(root.querySelectorAll(".mm-cat-chk:checked")).map(function (c) { return c.value; });
    var list = el("mm-cat-dd-list");
    if (state.cats.length === 0) {
      list.innerHTML = '<li><span class="dropdown-item-text text-muted small">No categories</span></li>';
      return;
    }
    list.innerHTML = state.cats.map(function (c) {
      var chk = prev.includes(c.id) ? " checked" : "";
      return '<li><label class="dropdown-item d-flex gap-2 align-items-center rounded">'
        + '<input type="checkbox" class="form-check-input mm-cat-chk" value="' + esc(c.id) + '"' + chk + ' />'
        + '<span class="small">' + esc(c.code) + ' – ' + esc(c.name) + '</span>'
        + '</label></li>';
    }).join("");
  }

  function updateFilterBadges() {
    var statusCount = root.querySelectorAll(".mm-status-chk:checked").length;
    var catCount    = root.querySelectorAll(".mm-cat-chk:checked").length;
    var sb = el("mm-status-badge");
    var cb = el("mm-cat-badge");
    if (sb) { sb.textContent = statusCount; sb.classList.toggle("d-none", statusCount === 0); }
    if (cb) { cb.textContent = catCount;    cb.classList.toggle("d-none", catCount === 0); }
  }

  async function refreshCats() {
    var data = await api({ action: "list_categories" });
    state.cats = data.rows;
  }

  async function saveCat() {
    var code     = el("mm-cat-code").value.trim();
    var name     = el("mm-cat-name").value.trim();
    var parentId = el("mm-cat-parent").value || null;
    var cid      = el("mm-cat-edit-id").value;
    if (!code || !name) {
      el("mm-cat-form-error").textContent = "Code and Name are required.";
      el("mm-cat-form-error").classList.remove("d-none");
      return;
    }
    try {
      if (cid) {
        await api({ action: "update_category", id: cid, code: code, name: name, parent_id: parentId });
      } else {
        await api({ action: "create_category", code: code, name: name, parent_id: parentId });
      }
      await refreshCats();
      renderCatTree();
      populateCatParentSelect();
      populateCatFilterSelect();
      resetCatForm();
      populateFormSelects();
    } catch (e) {
      el("mm-cat-form-error").textContent = e.message;
      el("mm-cat-form-error").classList.remove("d-none");
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async function init() {
    await Promise.all([refreshUoms(), refreshCats()]);
    populateCatFilterSelect();
    initGrid();
    loadList();
    lucide.createIcons();
  }

  // ── Event delegation ───────────────────────────────────────────────────────

  root.addEventListener("click", function (e) {
    // row click → open detail
    var row = e.target.closest(".mm-grid-row");
    if (row && !e.target.closest("[data-action]")) {
      openDetail({ id: row.dataset.id });
      return;
    }

    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.dataset.action;

    switch (action) {

      case "new-material":
        openForm(null);
        break;

      case "edit-current":
        if (state.currentMaterial) openForm(state.currentMaterial);
        break;

      case "back-to-list":
        e.preventDefault();
        showScreen("list");
        loadList();
        break;

      case "back-to-detail":
        e.preventDefault();
        if (state.currentMaterial) {
          renderDetail(state.currentMaterial);
          showScreen("detail");
          lucide.createIcons();
        }
        break;

      case "cancel-form":
        if (state.currentMaterial) {
          renderDetail(state.currentMaterial);
          showScreen("detail");
          lucide.createIcons();
        } else {
          showScreen("list");
          loadList();
        }
        break;

      case "save-material":
        saveMaterial();
        break;

      case "apply-filters":
        state.page = 1;
        updateFilterBadges();
        loadList();
        break;

      case "reset-filters":
        el("mm-search").value = "";
        state.search = "";
        root.querySelectorAll(".mm-status-chk").forEach(function (c) { c.checked = false; });
        root.querySelectorAll(".mm-cat-chk").forEach(function (c) { c.checked = false; });
        updateFilterBadges();
        state.page = 1;
        loadList();
        break;

      case "page-prev":
        if (state.page > 1) { state.page--; loadList(); }
        break;

      case "page-next":
        var pages = Math.ceil(state.totalRows / state.perPage);
        if (state.page < pages) { state.page++; loadList(); }
        break;

      case "add-conversion-row":
        addConvRow({});
        break;

      case "remove-conv-row":
        btn.closest(".mm-conv-row").remove();
        break;

      case "add-attr-row": {
        var panel = el("mm-attrs-panel");
        var addBtn = panel.querySelector("[data-action='add-attr-row']");
        var row = document.createElement("div");
        row.className = "d-flex gap-2 mb-2 mm-attr-row";
        row.innerHTML = '<input type="text" class="form-control form-control-sm mm-attr-key" placeholder="Key" />'
          + '<input type="text" class="form-control form-control-sm mm-attr-val" placeholder="Value" />'
          + '<button class="btn btn-sm btn-outline-danger" data-action="remove-attr-row">'
          + '<i data-lucide="trash-2"></i></button>';
        panel.insertBefore(row, addBtn);
        lucide.createIcons();
        break;
      }

      case "remove-attr-row":
        btn.closest(".mm-attr-row").remove();
        break;

      // ── UoM modal ──

      case "open-uom-modal":
        renderUomList();
        resetUomForm();
        getUomModal().show();
        break;

      case "save-uom":
        saveUom();
        break;

      case "cancel-uom-edit":
        resetUomForm();
        break;

      case "edit-uom": {
        var uid = btn.dataset.id;
        var u = state.uoms.find(function (x) { return x.id === uid; });
        if (!u) break;
        el("mm-uom-edit-id").value = u.id;
        el("mm-uom-code").value = u.code;
        el("mm-uom-name").value = u.name;
        el("mm-uom-frac").checked = u.allow_fractional;
        el("mm-uom-form-title").textContent = "Edit UoM";
        el("mm-uom-cancel-edit").classList.remove("d-none");
        el("mm-uom-form-error").classList.add("d-none");
        break;
      }

      case "delete-uom": {
        var duid = btn.dataset.id;
        if (!confirm("Delete this UoM?")) break;
        api({ action: "delete_uom", id: duid }).then(function (r) {
          if (r.error) { alert(r.error); return; }
          refreshUoms().then(function () {
            renderUomList();
            populateFormSelects();
          });
        });
        break;
      }

      // ── Category drawer ──

      case "open-cat-modal":
        renderCatTree();
        populateCatParentSelect();
        resetCatForm();
        getCatDrawer().show();
        break;

      case "save-cat":
        saveCat();
        break;

      case "cancel-cat-edit":
        resetCatForm();
        populateCatParentSelect();
        break;

      case "edit-cat": {
        var cid = btn.dataset.id;
        var c = state.cats.find(function (x) { return x.id === cid; });
        if (!c) break;
        el("mm-cat-edit-id").value = c.id;
        el("mm-cat-code").value = c.code;
        el("mm-cat-name").value = c.name;
        el("mm-cat-form-title").textContent = "Edit Category";
        el("mm-cat-cancel-edit").classList.remove("d-none");
        el("mm-cat-form-error").classList.add("d-none");
        populateCatParentSelect(c.id);
        el("mm-cat-parent").value = c.parent_id || "";
        break;
      }

      case "delete-cat": {
        var dcid = btn.dataset.id;
        if (!confirm("Delete this category?")) break;
        api({ action: "delete_category", id: dcid }).then(function (r) {
          if (r.error) { alert(r.error); return; }
          refreshCats().then(function () {
            renderCatTree();
            populateCatParentSelect();
            populateCatFilterSelect();
            populateFormSelects();
          });
        });
        break;
      }
    }
  });

  // Filter checkbox changes → update badge counts live
  root.addEventListener("change", function (e) {
    if (e.target.classList.contains("mm-status-chk") || e.target.classList.contains("mm-cat-chk")) {
      updateFilterBadges();
    }
  });

  // Search input
  root.querySelector("#mm-search").addEventListener("input", function (e) {
    state.search = e.target.value;
  });
  root.querySelector("#mm-search").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { state.page = 1; loadList(); }
  });

  // SKU input check
  root.querySelector("#mm-f-sku").addEventListener("input", function (e) {
    checkSku(e.target.value.trim());
  });

  // SKU auto-generate
  root.querySelector("#mm-f-sku-auto").addEventListener("change", function (e) {
    var skuInput = el("mm-f-sku");
    skuInput.readOnly = e.target.checked;
    if (e.target.checked) {
      var cat = state.cats.find(function (c) { return c.id === el("mm-f-cat").value; });
      var prefix = cat ? cat.code : "MAT";
      skuInput.value = prefix + "-" + Date.now().toString().slice(-6);
      el("mm-sku-feedback").textContent = "";
    }
  });

  // Per-page change
  root.querySelector("#mm-per-page").addEventListener("change", function (e) {
    state.perPage = parseInt(e.target.value);
    state.page = 1;
    loadList();
  });

  init();

})();
