// js/components/dashboard.js — Item Category Master list screen
import { sync }     from "../api.js";
import { navigate } from "../router.js";

const PAGE_SIZE = 25;

export async function mount(root) {
  const res = await fetch("js/components/dashboard.html");
  root.innerHTML = await res.text();

  const tbody         = root.querySelector("#ic-tbody");
  const emptyEl       = root.querySelector("#ic-empty");
  const loadingEl     = root.querySelector("#ic-loading");
  const pageInfo      = root.querySelector("#ic-page-info");
  const btnNew        = root.querySelector("#ic-btn-new");
  const btnSearch     = root.querySelector("#ic-btn-search");
  const btnRefresh    = root.querySelector("#ic-btn-refresh");
  const btnImport     = root.querySelector("#ic-btn-import");
  const btnPrev       = root.querySelector("#ic-btn-prev");
  const btnNext       = root.querySelector("#ic-btn-next");
  const fSearch       = root.querySelector("#ic-filter-search");

  const deleteModal   = root.querySelector("#ic-delete-modal");
  const modalCode     = root.querySelector("#ic-modal-code");
  const modalDeleteId = root.querySelector("#ic-modal-delete-id");
  const modalBtnDel   = root.querySelector("#ic-modal-btn-delete");

  const importModal      = root.querySelector("#ic-import-modal");
  const impFile          = root.querySelector("#ic-imp-file");
  const impBtnTemplate   = root.querySelector("#ic-imp-btn-template");
  const impBtnConfirm    = root.querySelector("#ic-imp-btn-confirm");
  const impStepPick      = root.querySelector("#ic-imp-step-pick");
  const impStepPreview   = root.querySelector("#ic-imp-step-preview");
  const impStepResult    = root.querySelector("#ic-imp-step-result");
  const impRowCount      = root.querySelector("#ic-imp-row-count");
  const impTbody         = root.querySelector("#ic-imp-tbody");
  const impOk            = root.querySelector("#ic-imp-ok");
  const impSkipped       = root.querySelector("#ic-imp-skipped");
  const impErrorsWrap    = root.querySelector("#ic-imp-errors-wrap");
  const impErrorsList    = root.querySelector("#ic-imp-errors-list");

  let currentPage  = 1;
  let totalItems   = 0;
  let bsDelete     = null;
  let bsImport     = null;
  let parsedRows   = [];

  if (window.bootstrap && window.bootstrap.Modal) {
    bsDelete = new bootstrap.Modal(deleteModal);
    bsImport = new bootstrap.Modal(importModal);
  }

  function toast(msg, type) {
    if (window.AdminWS && typeof AdminWS.showToast === "function")
      AdminWS.showToast(type || "info", msg);
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── list ──────────────────────────────────────────────────────────────────

  function getSearch() { return fSearch.value.trim() || null; }

  async function loadCount() {
    const data = await sync("count_categories", { search: getSearch() });
    totalItems = (data.data || {}).total || 0;
  }

  async function loadCategories() {
    tbody.innerHTML = "";
    emptyEl.classList.add("d-none");
    loadingEl.classList.remove("d-none");
    try {
      await loadCount();
      const offset = (currentPage - 1) * PAGE_SIZE;
      const data   = await sync("list_categories", { search: getSearch(), page_size: PAGE_SIZE, offset });
      const rows   = data.data || [];
      loadingEl.classList.add("d-none");
      if (!rows.length) { emptyEl.classList.remove("d-none"); updatePager(); return; }
      rows.forEach(function(row) {
        const tr = document.createElement("tr");
        tr.dataset.id = row.id;
        tr.innerHTML =
          `<td><code>${escHtml(row.category_code)}</code></td>` +
          `<td>${escHtml(row.name)}</td>` +
          `<td>${escHtml(row.parent_name || "—")}</td>` +
          `<td class="text-end"><span class="ic-child-count">${row.child_count}</span></td>` +
          `<td>` +
            `<button class="btn btn-xs btn-outline-primary me-1 ic-btn-edit" data-id="${row.id}">Edit</button>` +
            `<button class="btn btn-xs btn-outline-danger ic-btn-delete" data-id="${row.id}" data-code="${escHtml(row.category_code)}">✕</button>` +
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
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalItems} categories)`;
    btnPrev.disabled = currentPage <= 1;
    btnNext.disabled = currentPage >= totalPages;
  }

  // ── import helpers ────────────────────────────────────────────────────────

  function normalizeHeader(h) {
    return h.toLowerCase().replace(/[\s_-]+/g, "_");
  }

  function pickCol(headers, ...candidates) {
    for (const c of candidates) {
      const norm = normalizeHeader(c);
      const found = headers.find(function(h) { return normalizeHeader(h) === norm; });
      if (found) return found;
    }
    return null;
  }

  function mapRows(rawRows) {
    if (!rawRows.length) return [];
    const headers = Object.keys(rawRows[0]);
    const colCode   = pickCol(headers, "category_code", "code", "cat_code");
    const colName   = pickCol(headers, "name", "category_name", "cat_name");
    const colParent = pickCol(headers, "parent_code", "parent", "parent_cat_code");
    if (!colCode || !colName) throw new Error("Required columns not found. Need: category_code, name");
    return rawRows.map(function(r) {
      return {
        category_code: String(r[colCode] || "").trim(),
        name:          String(r[colName] || "").trim(),
        parent_code:   colParent ? String(r[colParent] || "").trim() : "",
      };
    }).filter(function(r) { return r.category_code || r.name; });
  }

  function parseCsvText(text) {
    const lines = text.split(/\r?\n/);
    function parseLine(line) {
      const fields = [];
      let i = 0;
      while (i <= line.length) {
        if (line[i] === '"') {
          let val = ""; i++;
          while (i < line.length) {
            if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
            else if (line[i] === '"') { i++; break; }
            else { val += line[i++]; }
          }
          fields.push(val);
          if (line[i] === ",") i++;
        } else {
          const end = line.indexOf(",", i);
          if (end === -1) { fields.push(line.slice(i)); break; }
          fields.push(line.slice(i, end));
          i = end + 1;
        }
      }
      return fields;
    }
    if (!lines.length || !lines[0].trim()) return [];
    const headers = parseLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseLine(lines[i]);
      const obj = {};
      headers.forEach(function(h, idx) { obj[h] = vals[idx] !== undefined ? vals[idx] : ""; });
      rows.push(obj);
    }
    return rows;
  }

  function parseFile(file) {
    return new Promise(function(resolve, reject) {
      const ext = file.name.split(".").pop().toLowerCase();
      const reader = new FileReader();

      reader.onerror = function() { reject(new Error("File read failed")); };

      if (ext === "csv") {
        reader.onload = function(e) {
          try {
            resolve(mapRows(parseCsvText(e.target.result)));
          } catch (err) { reject(err); }
        };
        reader.readAsText(file);
      } else {
        reader.onload = function(e) {
          try {
            const wb   = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
            resolve(mapRows(data));
          } catch (err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
      }
    });
  }

  function resetImportModal() {
    parsedRows = [];
    impFile.value = "";
    impStepPick.classList.remove("d-none");
    impStepPreview.classList.add("d-none");
    impStepResult.classList.add("d-none");
    impBtnConfirm.disabled = true;
    impBtnConfirm.classList.remove("d-none");
    impTbody.innerHTML = "";
    impErrorsList.innerHTML = "";
    impErrorsWrap.classList.add("d-none");
  }

  function downloadTemplate() {
    const csv = "category_code,name,parent_code\nSEMI,Semiconductors,ELEC\nCAPACITOR,Capacitors,ELEC\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "category_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── import events ─────────────────────────────────────────────────────────

  btnImport.addEventListener("click", function() {
    resetImportModal();
    if (bsImport) bsImport.show();
  });

  importModal.addEventListener("hidden.bs.modal", function() { resetImportModal(); });

  impBtnTemplate.addEventListener("click", downloadTemplate);

  impFile.addEventListener("change", async function() {
    const file = impFile.files[0];
    if (!file) return;
    try {
      parsedRows = await parseFile(file);
      if (!parsedRows.length) { toast("No valid rows found in file", "warning"); return; }
      impRowCount.textContent = parsedRows.length;
      impTbody.innerHTML = "";
      parsedRows.slice(0, 100).forEach(function(r) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td><code>${escHtml(r.category_code)}</code></td>` +
          `<td>${escHtml(r.name)}</td>` +
          `<td>${escHtml(r.parent_code || "—")}</td>`;
        impTbody.appendChild(tr);
      });
      if (parsedRows.length > 100) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="3" class="text-muted small">… and ${parsedRows.length - 100} more rows</td>`;
        impTbody.appendChild(tr);
      }
      impStepPreview.classList.remove("d-none");
      impBtnConfirm.disabled = false;
    } catch (e) {
      toast(e.message, "error");
    }
  });

  impBtnConfirm.addEventListener("click", async function() {
    if (!parsedRows.length) return;
    try {
      impBtnConfirm.disabled = true;
      impBtnConfirm.textContent = "Importing…";
      const data   = await sync("import_categories", { rows: parsedRows });
      const result = data.data || {};
      impOk.textContent      = result.imported + " imported";
      impSkipped.textContent = result.skipped  ? result.skipped + " skipped (duplicate codes)" : "";
      impStepPreview.classList.add("d-none");
      impStepResult.classList.remove("d-none");
      impBtnConfirm.classList.add("d-none");
      if (result.errors && result.errors.length) {
        impErrorsWrap.classList.remove("d-none");
        result.errors.forEach(function(e) {
          const li = document.createElement("li");
          li.textContent = "Row " + e.row + " (" + e.category_code + "): " + e.error;
          impErrorsList.appendChild(li);
        });
      }
      if (result.imported > 0) await loadCategories();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      impBtnConfirm.disabled = false;
      impBtnConfirm.textContent = "Import";
    }
  });

  // ── list events ───────────────────────────────────────────────────────────

  btnNew.addEventListener("click", function() { navigate("form", { mode: "new" }); });
  btnSearch.addEventListener("click", function() { currentPage = 1; loadCategories(); });
  btnRefresh.addEventListener("click", function() { loadCategories(); });
  fSearch.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { currentPage = 1; loadCategories(); }
  });
  btnPrev.addEventListener("click", function() { if (currentPage > 1) { currentPage--; loadCategories(); } });
  btnNext.addEventListener("click", function() { currentPage++; loadCategories(); });

  tbody.addEventListener("click", function(e) {
    const editBtn = e.target.closest(".ic-btn-edit");
    const delBtn  = e.target.closest(".ic-btn-delete");
    if (editBtn) navigate("form", { mode: "edit", id: editBtn.dataset.id });
    if (delBtn && bsDelete) {
      modalDeleteId.value   = delBtn.dataset.id;
      modalCode.textContent = delBtn.dataset.code;
      bsDelete.show();
    }
  });

  modalBtnDel.addEventListener("click", async function() {
    try {
      modalBtnDel.disabled = true;
      await sync("delete_category", { id: modalDeleteId.value });
      toast("Category deleted", "success");
      if (bsDelete) bsDelete.hide();
      await loadCategories();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      modalBtnDel.disabled = false;
    }
  });

  await loadCategories();
}
