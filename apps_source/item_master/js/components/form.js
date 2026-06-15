// js/components/form.js — Item Master create/edit form
import { sync }                  from "../api.js";
import { navigate, getNavState } from "../router.js";

const CODE_RE = /^[A-Z0-9_-]{1,50}$/;

export async function mount(root) {
  const res = await fetch("js/components/form.html");
  root.innerHTML = await res.text();

  // ── element refs ──────────────────────────────────────────────────────────
  const btnBack    = root.querySelector("#im-btn-back");
  const btnSave    = root.querySelector("#im-btn-save");
  const btnCancel  = root.querySelector("#im-btn-cancel");
  const formTitle  = root.querySelector("#im-form-title");
  const tabs       = root.querySelectorAll("#im-tabs .nav-link");
  const panes      = { general:  root.querySelector("#im-tab-general"),
                       planning: root.querySelector("#im-tab-planning"),
                       costing:  root.querySelector("#im-tab-costing") };

  const fId            = root.querySelector("#im-f-id");
  const fVersion       = root.querySelector("#im-f-version");
  const fCode          = root.querySelector("#im-f-code");
  const fName          = root.querySelector("#im-f-name");
  const fType          = root.querySelector("#im-f-type");
  const fCategory      = root.querySelector("#im-f-category");
  const fUom           = root.querySelector("#im-f-uom");
  const fDesc          = root.querySelector("#im-f-desc");
  const fLot           = root.querySelector("#im-f-lot");
  const fSafetyStock   = root.querySelector("#im-f-safety-stock");
  const fReorderPoint  = root.querySelector("#im-f-reorder-point");
  const fLeadTime      = root.querySelector("#im-f-lead-time");
  const fMinOrder      = root.querySelector("#im-f-min-order");
  const fCostMethod    = root.querySelector("#im-f-costing-method");
  const fStdCost       = root.querySelector("#im-f-standard-cost");
  const fAvgCost       = root.querySelector("#im-f-avg-cost");
  const fCurrency      = root.querySelector("#im-f-currency");
  const codeErr        = root.querySelector("#im-code-err");

  let isDirty    = false;
  let isEditMode = false;

  function toast(msg, type) {
    if (window.AdminWS && typeof AdminWS.showToast === "function")
      AdminWS.showToast(type || "info", msg);
  }

  // ── tab switching ─────────────────────────────────────────────────────────
  function activateTab(name) {
    tabs.forEach(function(t) {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    Object.entries(panes).forEach(function([k, el]) {
      el.classList.toggle("d-none", k !== name);
    });
  }

  tabs.forEach(function(t) {
    t.addEventListener("click", function() { activateTab(t.dataset.tab); });
  });

  // ── dirty state guard ─────────────────────────────────────────────────────
  root.querySelectorAll("input, select, textarea").forEach(function(el) {
    el.addEventListener("input",  function() { isDirty = true; });
    el.addEventListener("change", function() { isDirty = true; });
  });

  function guardDirty() {
    if (!isDirty) return true;
    return confirm("You have unsaved changes. Leave without saving?");
  }

  btnBack.addEventListener("click",   function() { if (guardDirty()) navigate("dashboard"); });
  btnCancel.addEventListener("click", function() { if (guardDirty()) navigate("dashboard"); });

  // ── item code: normalise + validate on blur ───────────────────────────────
  fCode.addEventListener("blur", function() {
    fCode.value = fCode.value.trim().toUpperCase().replace(/\s+/g, "_");
    if (fCode.value && !CODE_RE.test(fCode.value)) {
      fCode.classList.add("is-invalid");
      codeErr.textContent = "Only A-Z, 0-9, hyphens and underscores. Max 50 chars.";
    } else {
      fCode.classList.remove("is-invalid");
      codeErr.textContent = "";
    }
  });

  // ── load reference data ───────────────────────────────────────────────────
  async function loadRefs() {
    const [uomData, catData] = await Promise.all([
      sync("list_uoms", {}),
      sync("list_categories", {}),
    ]);
    (uomData.data || []).forEach(function(u) {
      const o = document.createElement("option");
      o.value = u.id; o.textContent = u.uom_code + " — " + u.name;
      fUom.appendChild(o);
    });
    (catData.data || []).forEach(function(c) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.parent_name ? c.parent_name + " > " + c.name : c.name;
      fCategory.appendChild(o);
    });
  }

  // ── populate form for edit ────────────────────────────────────────────────
  async function loadItem(id) {
    const data = await sync("get_item", { id });
    const item = data.data;
    if (!item) { toast("Item not found", "error"); navigate("dashboard"); return; }

    fId.value           = item.id;
    fVersion.value      = item.version;
    fCode.value         = item.item_code;
    fName.value         = item.name;
    fDesc.value         = item.description || "";
    fType.value         = item.item_type;
    fCategory.value     = item.category_id || "";
    fUom.value          = item.base_uom_id || "";
    fLot.checked        = !!item.is_lot_tracked;

    fSafetyStock.value  = item.safety_stock   ?? 0;
    fReorderPoint.value = item.reorder_point  ?? 0;
    fLeadTime.value     = item.lead_time_days ?? 0;
    fMinOrder.value     = item.min_order_qty  ?? 1;

    fCostMethod.value   = item.costing_method || "STANDARD";
    fStdCost.value      = item.standard_cost  ?? 0;
    fAvgCost.value      = item.avg_cost       ?? 0;
    fCurrency.value     = item.currency       || "USD";

    isDirty = false;
  }

  // ── save ──────────────────────────────────────────────────────────────────
  btnSave.addEventListener("click", async function() {
    const code = fCode.value.trim().toUpperCase();
    const name = fName.value.trim();
    const type = fType.value;
    const cat  = fCategory.value;
    const uom  = fUom.value;

    if (!code)               { toast("Item Code is required",   "warning"); activateTab("general"); fCode.focus(); return; }
    if (!CODE_RE.test(code)) { toast("Item Code format invalid","warning"); activateTab("general"); fCode.focus(); return; }
    if (!name)               { toast("Item Name is required",   "warning"); activateTab("general"); fName.focus(); return; }
    if (!type)               { toast("Item Type is required",   "warning"); activateTab("general"); fType.focus(); return; }
    if (!cat)                { toast("Category is required",    "warning"); activateTab("general"); fCategory.focus(); return; }
    if (!uom)                { toast("Base UOM is required",    "warning"); activateTab("general"); fUom.focus(); return; }

    const payload = {
      item_code:      code,
      name,
      description:    fDesc.value.trim() || null,
      item_type:      type,
      category_id:    cat,
      base_uom_id:    uom,
      is_lot_tracked: fLot.checked,
      safety_stock:   parseFloat(fSafetyStock.value)  || 0,
      reorder_point:  parseFloat(fReorderPoint.value) || 0,
      lead_time_days: parseInt(fLeadTime.value, 10)   || 0,
      min_order_qty:  parseFloat(fMinOrder.value)     || 1,
      costing_method: fCostMethod.value,
      standard_cost:  parseFloat(fStdCost.value)      || 0,
      avg_cost:       parseFloat(fAvgCost.value)      || 0,
      currency:       fCurrency.value,
    };

    try {
      btnSave.disabled = true;
      if (isEditMode) {
        payload.id      = fId.value;
        payload.version = parseInt(fVersion.value, 10);
        const result = await sync("update_item", payload);
        toast("Item updated: " + result.data?.item_code, "success");
      } else {
        const result = await sync("insert_item", payload);
        toast("Item created: " + result.data?.item_code, "success");
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
  await loadRefs();

  if (state && state.mode === "edit" && state.id) {
    isEditMode = true;
    formTitle.textContent = "Edit Item";
    await loadItem(state.id);
  } else {
    formTitle.textContent = "New Item Setup";
  }

  isDirty = false;
  activateTab("general");
  fCode.focus();
}
