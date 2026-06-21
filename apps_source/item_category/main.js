// main.js — Item Category Master entry point
"use strict"

var cat = require("lib/categories")

function execute(payload) {
  var action = payload.action || ""

  try {
    if (action === "list_categories")    return { data: cat.listCategories(payload.params || {}) }
    if (action === "count_categories")   return { data: cat.countCategories(payload.params || {}) }
    if (action === "get_category")       return { data: cat.getCategory(payload.params || {}) }
    if (action === "list_parent_options") return { data: cat.listParentOptions(payload.params || {}) }
    if (action === "insert_category") {
      var created = cat.insertCategory(payload.params || {})
      return { data: created, _actions: [{ action: "item_category_created", payload: { id: created.id } }] }
    }
    if (action === "update_category") {
      var updated = cat.updateCategory(payload.params || {})
      return { data: updated, _actions: [{ action: "item_category_updated", payload: { id: updated.id } }] }
    }
    if (action === "delete_category") {
      var deleted = cat.deleteCategory(payload.params || {})
      return { data: deleted, _actions: [{ action: "item_category_deleted", payload: { id: deleted.id } }] }
    }
    if (action === "import_categories") {
      var imported = cat.importCategories(payload.params || {})
      return { data: imported, _actions: [{ action: "item_category_imported", payload: { imported: imported.imported } }] }
    }
    return { error: "unknown action: " + action }
  } catch (e) {
    return { error: e.message }
  }
}
