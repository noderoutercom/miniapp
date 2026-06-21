// lib/categories.js — category business logic
"use strict"

var h = require("lib/helpers")

var CODE_RE = /^[A-Z0-9_]{1,20}$/

function listCategories(payload) {
  var search   = payload.search   || null
  var pageSize = payload.page_size || 25
  var offset   = payload.offset   || 0
  return sql(
    "SELECT c.id::text, c.category_code, c.name, c.parent_id::text, p.name AS parent_name, COUNT(ch.id)::integer AS child_count" +
    " FROM public.item_categories c" +
    " LEFT JOIN public.item_categories p ON p.id = c.parent_id" +
    " LEFT JOIN public.item_categories ch ON ch.parent_id = c.id" +
    " WHERE ($1::text IS NULL OR c.category_code ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')" +
    " GROUP BY c.id, c.category_code, c.name, c.parent_id, p.name" +
    " ORDER BY c.category_code" +
    " LIMIT $2::integer OFFSET $3::integer",
    [search, pageSize, offset]
  )
}

function countCategories(payload) {
  var search = payload.search || null
  var rows = sql(
    "SELECT COUNT(*)::integer AS total FROM public.item_categories c" +
    " WHERE ($1::text IS NULL OR c.category_code ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')",
    [search]
  )
  return rows[0] || { total: 0 }
}

function getCategory(payload) {
  h.requireField(payload, "id")
  var rows = sql(
    "SELECT c.id::text, c.category_code, c.name, c.parent_id::text, p.name AS parent_name" +
    " FROM public.item_categories c" +
    " LEFT JOIN public.item_categories p ON p.id = c.parent_id" +
    " WHERE c.id = $1::uuid",
    [payload.id]
  )
  if (!rows.length) throw new Error("Category not found")
  return rows[0]
}

function listParentOptions(payload) {
  var excludeId = payload.exclude_id || null
  return sql(
    "SELECT id::text, category_code, name FROM public.item_categories" +
    " WHERE ($1::text IS NULL OR id::text != $1)" +
    " ORDER BY category_code",
    [excludeId]
  )
}

function insertCategory(payload) {
  h.requireField(payload, "category_code")
  h.requireField(payload, "name")
  var code = payload.category_code.trim().toUpperCase()
  if (!CODE_RE.test(code)) throw new Error("category_code must be 1–20 uppercase letters, digits, or underscores")
  var parentId = payload.parent_id || null
  var rows = sql(
    "INSERT INTO public.item_categories (category_code, name, parent_id)" +
    " VALUES ($1, $2, $3::uuid) RETURNING id::text, category_code, name",
    [code, payload.name.trim(), parentId]
  )
  return h.one(rows)
}

function updateCategory(payload) {
  h.requireField(payload, "id")
  h.requireField(payload, "category_code")
  h.requireField(payload, "name")
  if (payload.parent_id && payload.parent_id === payload.id)
    throw new Error("A category cannot be its own parent")
  var code = payload.category_code.trim().toUpperCase()
  if (!CODE_RE.test(code)) throw new Error("category_code must be 1–20 uppercase letters, digits, or underscores")
  var parentId = payload.parent_id || null
  var rows = sql(
    "UPDATE public.item_categories SET category_code=$2, name=$3, parent_id=$4::uuid" +
    " WHERE id=$1::uuid RETURNING id::text, category_code, name",
    [payload.id, code, payload.name.trim(), parentId]
  )
  return h.one(rows)
}

function deleteCategory(payload) {
  h.requireField(payload, "id")
  var id = payload.id

  var childRows = sql(
    "SELECT COUNT(*)::integer AS total FROM public.item_categories WHERE parent_id = $1::uuid",
    [id]
  )
  if ((childRows[0] || {}).total > 0)
    throw new Error("Cannot delete: category has sub-categories. Remove them first.")

  try {
    var itemRows = sql(
      "SELECT COUNT(*)::integer AS total FROM item_master.items WHERE category_id = $1::uuid",
      [id]
    )
    if ((itemRows[0] || {}).total > 0)
      throw new Error("Cannot delete: items are assigned to this category. Reassign them first.")
  } catch (e) {
    if (e.message.indexOf("Cannot delete") === 0) throw e
    // item_master schema may not be deployed yet — skip check
  }

  var rows = sql(
    "DELETE FROM public.item_categories WHERE id=$1::uuid RETURNING id::text",
    [id]
  )
  return h.one(rows)
}

function importCategories(payload) {
  var rows = payload.rows || []
  if (!rows.length) throw new Error("No rows to import")
  if (rows.length > 500) throw new Error("Maximum 500 rows per import")

  var existing = sql("SELECT id::text, category_code FROM public.item_categories")
  var codeMap = {}
  existing.forEach(function(r) { codeMap[r.category_code] = r.id })

  var imported = 0
  var skipped  = 0
  var errors   = []

  rows.forEach(function(row, idx) {
    var rowNum = idx + 2
    try {
      var code = String(row.category_code || "").trim().toUpperCase()
      var name = String(row.name || "").trim()
      if (!code) throw new Error("category_code is required")
      if (!name) throw new Error("name is required")
      if (!CODE_RE.test(code)) throw new Error("invalid category_code '" + code + "'")

      var parentId = null
      if (row.parent_code) {
        var pc = String(row.parent_code).trim().toUpperCase()
        if (pc) {
          parentId = codeMap[pc] || null
          if (!parentId) throw new Error("parent_code '" + pc + "' not found")
        }
      }

      var result = sql(
        "INSERT INTO public.item_categories (category_code, name, parent_id)" +
        " VALUES ($1, $2, $3::uuid)" +
        " ON CONFLICT (category_code) DO NOTHING" +
        " RETURNING id::text, category_code",
        [code, name, parentId]
      )

      if (result.length) {
        codeMap[code] = result[0].id
        imported++
      } else {
        skipped++
      }
    } catch (e) {
      errors.push({ row: rowNum, category_code: String(row.category_code || ""), error: e.message })
    }
  })

  return { imported: imported, skipped: skipped, errors: errors }
}

module.exports = {
  listCategories,
  countCategories,
  getCategory,
  listParentOptions,
  insertCategory,
  updateCategory,
  deleteCategory,
  importCategories,
}
