// js/components/form.js — Item Category create/edit form
import { sync }                  from "../api.js";
import { navigate, getNavState } from "../router.js";

const CODE_RE = /^[A-Z0-9_]{1,20}$/;

export async function mount(root) {
  const res = await fetch("js/components/form.html");
  root.innerHTML = await res.text();

  const btnBack   = root.querySelector("#ic-btn-back");
  const btnSave   = root.querySelector("#ic-btn-save");
  const btnCancel = root.querySelector("#ic-btn-cancel");
  const formTitle = root.querySelector("#ic-form-title");
  const fId       = root.querySelector("#ic-f-id");
  const fCode     = root.querySelector("#ic-f-code");
  const fName     = root.querySelector("#ic-f-name");
  const fParent   = root.querySelector("#ic-f-parent");
  const codeErr   = root.querySelector("#ic-code-err");

  let isDirty    = false;
  let isEditMode = false;

  function toast(msg, type) {
    if (window.AdminWS && typeof AdminWS.showToast === "function")
      AdminWS.showToast(type || "info", msg);
  }

  // ── dirty guard ───────────────────────────────────────────────────────────
  root.querySelectorAll("input, select").forEach(function(el) {
    el.addEventListener("input",  function() { isDirty = true; });
    el.addEventListener("change", function() { isDirty = true; });
  });

  function guardDirty() {
    if (!isDirty) return true;
    return confirm("You have unsaved changes. Leave without saving?");
  }

  btnBack.addEventListener("click",   function() { if (guardDirty()) navigate("dashboard"); });
  btnCancel.addEventListener("click", function() { if (guardDirty()) navigate("dashboard"); });

  // ── code: normalise + validate on blur ────────────────────────────────────
  fCode.addEventListener("blur", function() {
    fCode.value = fCode.value.trim().toUpperCase();
    if (fCode.value && !CODE_RE.test(fCode.value)) {
      fCode.classList.add("is-invalid");
      codeErr.textContent = "Only A–Z, 0–9, underscore. Max 20 chars.";
    } else {
      fCode.classList.remove("is-invalid");
      codeErr.textContent = "";
    }
  });

  // ── load parent dropdown ──────────────────────────────────────────────────
  async function loadParentOptions(excludeId) {
    try {
      const data = await sync("list_parent_options", { exclude_id: excludeId || null });
      (data.data || []).forEach(function(c) {
        const o = document.createElement("option");
        o.value       = c.id;
        o.textContent = c.category_code + " — " + c.name;
        fParent.appendChild(o);
      });
    } catch (e) { /* non-critical */ }
  }

  // ── populate form for edit ────────────────────────────────────────────────
  async function loadCategory(id) {
    const data = await sync("get_category", { id });
    const cat  = data.data;
    if (!cat) { toast("Category not found", "error"); navigate("dashboard"); return; }

    fId.value     = cat.id;
    fCode.value   = cat.category_code;
    fName.value   = cat.name;
    fParent.value = cat.parent_id || "";
    isDirty = false;
  }

  // ── save ──────────────────────────────────────────────────────────────────
  btnSave.addEventListener("click", async function() {
    const code   = fCode.value.trim().toUpperCase();
    const name   = fName.value.trim();
    const parent = fParent.value || null;

    if (!code) { toast("Category Code is required", "warning"); fCode.focus(); return; }
    if (!CODE_RE.test(code)) { toast("Category Code format invalid", "warning"); fCode.focus(); return; }
    if (!name) { toast("Category Name is required", "warning"); fName.focus(); return; }

    const payload = { category_code: code, name, parent_id: parent };

    try {
      btnSave.disabled = true;
      if (isEditMode) {
        payload.id = fId.value;
        const result = await sync("update_category", payload);
        toast("Category updated: " + result.data?.category_code, "success");
      } else {
        const result = await sync("insert_category", payload);
        toast("Category created: " + result.data?.category_code, "success");
      }
      isDirty = false;
      navigate("dashboard");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      btnSave.disabled = false;
    }
  });

  // ── init ──────────────────────────────────────────────────────────────────
  const state = getNavState();

  if (state && state.mode === "edit" && state.id) {
    isEditMode = true;
    formTitle.textContent = "Edit Category";
    await loadParentOptions(state.id);
    await loadCategory(state.id);
  } else {
    formTitle.textContent = "New Category";
    await loadParentOptions(null);
  }

  isDirty = false;
  fCode.focus();
}
