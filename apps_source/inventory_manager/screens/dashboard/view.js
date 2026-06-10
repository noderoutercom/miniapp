// screens/dashboard/view.js
import { sync } from "../../lib/api.js";

export async function mount(root) {
  const res = await fetch("screens/dashboard/view.html");
  root.innerHTML = await res.text();

  const tbody        = root.querySelector("#inv-tbody");
  const emptyEl      = root.querySelector("#inv-empty");
  const formWrap     = root.querySelector("#inv-form-wrap");
  const filterStatus = root.querySelector("#inv-filter-status");
  const btnAdd       = root.querySelector("#inv-btn-add");
  const btnSave      = root.querySelector("#inv-btn-save");
  const btnCancel    = root.querySelector("#inv-btn-cancel");
  const btnRefresh   = root.querySelector("#inv-btn-refresh");
  const fCode        = root.querySelector("#inv-f-code");
  const fQty         = root.querySelector("#inv-f-qty");
  const fStatus      = root.querySelector("#inv-f-status");

  function toast(msg, type) {
    if (window.AdminWS && typeof AdminWS.showToast === "function")
      AdminWS.showToast(type || "info", msg);
  }

  function formatDate(iso) {
    return iso ? iso.slice(0, 10) : "-";
  }

  async function loadItems() {
    tbody.innerHTML = "";
    emptyEl.classList.add("d-none");
    try {
      const data = await sync("list_items", { status: filterStatus.value || null });
      const rows = data.data || [];
      if (rows.length === 0) {
        emptyEl.classList.remove("d-none");
        return;
      }
      rows.forEach(function (row) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + row.item_code + "</td>" +
          "<td>" + row.quantity + "</td>" +
          "<td><span class=\"badge inv-badge-" + row.status + "\">" + row.status + "</span></td>" +
          "<td>" + formatDate(row.created_at) + "</td>";
        tbody.appendChild(tr);
      });
    } catch (e) {
      toast(e.message, "error");
    }
  }

  btnAdd.addEventListener("click", function () {
    formWrap.classList.toggle("d-none");
    fCode.focus();
  });

  btnCancel.addEventListener("click", function () {
    formWrap.classList.add("d-none");
    fCode.value = "";
    fQty.value = "";
    fStatus.value = "active";
  });

  btnSave.addEventListener("click", async function () {
    const item_code = fCode.value.trim();
    const quantity  = parseInt(fQty.value, 10);
    const status    = fStatus.value;
    if (!item_code) { toast("Item Code is required", "warning"); return; }
    if (isNaN(quantity) || quantity < 0) { toast("Quantity must be a non-negative number", "warning"); return; }
    try {
      await sync("insert_item", { item_code, quantity, status });
      toast("Item added: " + item_code, "success");
      btnCancel.click();
      await loadItems();
    } catch (e) {
      toast(e.message, "error");
    }
  });

  btnRefresh.addEventListener("click", loadItems);
  filterStatus.addEventListener("change", loadItems);

  await loadItems();
}
