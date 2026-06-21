// lib/helpers.js — shared utilities
"use strict"

function requireField(params, field) {
  if (!params[field]) throw new Error(field + " is required")
}

function one(rows) {
  if (!rows || !rows.length) throw new Error("not found")
  return rows[0]
}

module.exports = { requireField, one }
