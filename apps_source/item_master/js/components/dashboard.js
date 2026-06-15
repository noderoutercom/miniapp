// js/components/dashboard.js — Item Master list screen
import { sync }     from "../api.js";
import { navigate } from "../router.js";

const PAGE_SIZE = 25;

export async function mount(root) {
  const res = await fetch("js/components/dashboard.html");
  root.innerHTML = await res.text();

  // elements
  const tbody          = root.querySelector("#im-tbody");
  const emptyEl        = root.querySelector("#im-empty");
  const loadingEl      = root.querySelector("#im-loading");
  const pageInfo       = root.querySelector("#im-page-info");
  const btnNew         = root.querySelector("#im-btn-new");
  const btnSearch      = root.querySelector("#im-btn-search");
  const btnRefresh     = root.querySelector("#im-btn-refresh");
  const btnPrev        = root.querySelector("#im-btn-prev");
  const btnNext        = root.querySelector("#im-btn-next");
  const fSearch        = root.querySelector("#im-filter-search");
  const fType          = root.querySelector("#im-filter-type");
  const fStatus        = root.querySelector("#im-filter-status");
  const fCategory      = root.querySelector("#im-filter-category");
  const statusModal    = root.querySelector("#im-status-modal");
  const modalStatus    = root.querySelector("#im-modal-status");
  const modalItemId    = root.querySelector("#im-modal-item-id");
  const modalBtnApply  = root.querySelector("#im-modal-btn-apply");

  let currentPage  = 1;
  let totalItems   = 0;
  let bsModal      = null;

  if (window.bootstrap && window.bootstrap.Modal) {
    bsModal = new bootstrap.Modal(statusModal);
  }

  function toast(msg, type) {
    if (window.AdminWS && typeof AdminWS.showToast === "function")
      AdminWS.showToast(type || "info", msg);
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function formatDate(iso) { return iso ? iso.slice(0, 10) : "-"; }

  function statusBadge(s) {
    const map = { ACTIVE:"success", DRAFT:"secondary", PHASE_OUT:"warning", OBSOLETE:"danger" };
    const cls = map[s] || "secondary";
    return `<span class="badge im-badge-${s.toLowerCase()}">${s}</span>`;
  }

  function typeLabel(t) {
    return { RAW_MATERIAL:"Raw Material", WORK_IN_PROGRESS:"WIP",
             FINISHED_GOOD:"Finished Good", PACKAGING:"Packaging", CONSUMABLE:"Consumable" }[t] || t;
  }

  async function loadCategories() {
    try {
      const data = await sync("list_categories", {});
      (data.data || []).forEach(function(c) {
        const opt = document.createElement("option");
        opt.value       = c.id;
        opt.textContent = c.name;
        fCategory.appendChild(opt);
      });
    } catch (e) { /* non-critical */ }
  }

  function getFilters() {
    return {
      search:      fSearch.value.trim()   || null,
      item_type:   fType.value            || null,
      status:      fStatus.value          || null,
      category_id: fCategory.value        || null,
    };
  }

  async function loadCount() {
    const data = await sync("count_items", getFilters());
    totalItems  = (data.data || {}).total || 0;
  }

  async function loadItems() {
    tbody.innerHTML  = "";
    emptyEl.classList.add("d-none");
    loadingEl.classList.remove("d-none");
    try {
      await loadCount();
      const filters = { ...getFilters(), page: currentPage, page_size: PAGE_SIZE };
      const data    = await sync("list_items", filters);
      const rows    = data.data || [];

      loadingEl.classList.add("d-none");
      if (rows.length === 0) { emptyEl.classList.remove("d-none"); updatePager(); return; }

      rows.forEach(function(row) {
        const tr = document.createElement("tr");
        tr.dataset.id = row.id;
        tr.innerHTML =
          `<td><code>${escHtml(row.item_code)}</code></td>` +
          `<td>${escHtml(row.name)}</td>` +
          `<td><span class="im-type-tag">${typeLabel(row.item_type)}</span></td>` +
          `<td>${escHtml(row.category_name || "-")}</td>` +
          `<td>${escHtml(row.base_uom_code || "-")}</td>` +
          `<td>${row.is_lot_tracked ? '<span class="badge bg-info">LOT</span>' : "-"}</td>` +
          `<td>${statusBadge(row.status)}</td>` +
          `<td>${formatDate(row.created_at)}</td>` +
          `<td>` +
            `<button class="btn btn-xs btn-outline-primary me-1 im-btn-edit" data-id="${row.id}" title="Edit">Edit</button>` +
            `<button class="btn btn-xs btn-outline-secondary im-btn-status" data-id="${row.id}" data-status="${row.status}" title="Change Status">Status</button>` +
          `</td>`;
        tbody.appendChild(tr);
      });
      updatePager();
    } catch (e) {
      loadingEl.classList.add("d-none");
      toast(e.message, "error");
    }
  }

  function updatePager() {
    const totalPages = Math.max(Math.ceil(totalItems / PAGE_SIZE), 1);
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} items)`;
    btnPrev.disabled = currentPage <= 1;
    btnNext.disabled = currentPage >= totalPages;
  }

  // ── events ──────────────────────────────────────────────────────────────────

  btnNew.addEventListener("click", function() { navigate("form", { mode: "new" }); });
  btnSearch.addEventListener("click", function() { currentPage = 1; loadItems(); });
  btnRefresh.addEventListener("click", function() { loadItems(); });
  fSearch.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { currentPage = 1; loadItems(); }
  });
  btnPrev.addEventListener("click", function() { if (currentPage > 1) { currentPage--; loadItems(); } });
  btnNext.addEventListener("click", function() { currentPage++; loadItems(); });

  tbody.addEventListener("click", function(e) {
    const editBtn   = e.target.closest(".im-btn-edit");
    const statusBtn = e.target.closest(".im-btn-status");
    if (editBtn)   navigate("form", { mode: "edit", id: editBtn.dataset.id });
    if (statusBtn && bsModal) {
      modalItemId.value = statusBtn.dataset.id;
      modalStatus.value = statusBtn.dataset.status;
      bsModal.show();
    }
  });

  modalBtnApply.addEventListener("click", async function() {
    const id     = modalItemId.value;
    const status = modalStatus.value;
    try {
      await sync("change_item_status", { id, status });
      toast("Status updated to " + status, "success");
      if (bsModal) bsModal.hide();
      await loadItems();
    } catch (e) {
      toast(e.message, "error");
    }
  });

  await loadCategories();
  await loadItems();
}
