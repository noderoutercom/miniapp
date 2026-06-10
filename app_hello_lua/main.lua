-- app_hello_lua/main.lua  v6
-- CRUD demo on domain_hello_items + domain_hello_item_details.
-- Item and its detail are written in one execute() call → one atomic ledger event.

noderouter.log("info", "app_hello_lua v6 loaded")

function execute(payload_json)
  local data   = json.decode(payload_json) or {}
  local action = data.action or "list"

  -- ── LIST ──────────────────────────────────────────────────────────────────
  if action == "list" then
    local ok, result = pcall(function()
      local rows, err = noderouter.query(
        "SELECT id, payload, created_at, updated_at FROM domain_hello_items WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
        "[]"
      )
      if err then return json.encode({ ok = true, rows = {} }) end
      return rows
    end)
    if not ok then return json.encode({ ok = true, rows = {} }) end
    return result
  end

  -- ── GET FULL (item + detail in one call) ──────────────────────────────────
  -- Combines get + get_detail so the frontend makes one request instead of
  -- two concurrent ones (concurrent calls hit the busy VM and return 503).
  if action == "get_full" then
    local id = data.id
    if not id or id == "" then
      return json.encode({ ok = false, error = "id is required" })
    end

    local item_rows_json, err = noderouter.query(
      "SELECT id, payload, created_at, updated_at FROM domain_hello_items WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      json.encode({ id })
    )
    if err then return json.encode({ ok = false, error = err }) end
    local item_rows = json.decode(item_rows_json) or {}
    if #item_rows == 0 then
      return json.encode({ ok = false, error = "not found" })
    end

    local det_rows_json, _ = noderouter.query(
      "SELECT id, payload, created_at, updated_at FROM domain_hello_item_details WHERE deleted_at IS NULL AND payload LIKE ? LIMIT 1",
      json.encode({ '%"item_id":"' .. id .. '"%' })
    )
    local det_rows = json.decode(det_rows_json) or {}
    local detail = nil
    if #det_rows > 0 then detail = det_rows[1] end

    return json.encode({ ok = true, item = item_rows[1], detail = detail })
  end

  -- ── GET DETAIL (standalone, kept for backward compat) ─────────────────────
  if action == "get_detail" then
    local item_id = data.item_id
    if not item_id or item_id == "" then
      return json.encode({ ok = false, error = "item_id is required" })
    end
    local rows_json, err = noderouter.query(
      "SELECT id, payload, created_at, updated_at FROM domain_hello_item_details WHERE deleted_at IS NULL AND payload LIKE ? LIMIT 1",
      json.encode({ '%"item_id":"' .. item_id .. '"%' })
    )
    if err then return json.encode({ ok = false, error = err }) end
    local rows = json.decode(rows_json) or {}
    if #rows == 0 then
      return json.encode({ ok = true, detail = nil })
    end
    return json.encode({ ok = true, detail = rows[1] })
  end

  -- ── CREATE ────────────────────────────────────────────────────────────────
  -- Writes hello_items AND hello_item_details in one execute() call so both ops
  -- share a single local_seq and become one atomic event in the ledger.
  if action == "create" then
    local title  = (data.title  and data.title  ~= "") and data.title  or "Untitled"
    local status = (data.status and data.status ~= "") and data.status or "open"
    local note   = data.note or ""

    local id, err = noderouter.domain_insert(
      "hello_items",
      json.encode({ title = title, status = status, note = note })
    )
    if err then return json.encode({ ok = false, error = err }) end

    -- Detail fields (optional; silently skip if all empty)
    local description = data.description or ""
    local priority    = data.priority    or ""
    local due_date    = data.due_date    or ""
    local tags        = data.tags        or ""
    if description ~= "" or priority ~= "" or due_date ~= "" or tags ~= "" then
      noderouter.domain_insert(
        "hello_item_details",
        json.encode({
          item_id = id, description = description,
          priority = priority, due_date = due_date, tags = tags
        })
      )
    end

    noderouter.emit("item_created", json.encode({ id = id, title = title }))
    return json.encode({ ok = true, id = id })
  end

  -- ── UPDATE ────────────────────────────────────────────────────────────────
  -- Updates hello_items AND upserts hello_item_details atomically.
  if action == "update" then
    local id     = data.id
    local title  = data.title  or ""
    local status = data.status or "open"
    local note   = data.note   or ""
    if not id or id == "" then
      return json.encode({ ok = false, error = "id is required" })
    end

    local err = noderouter.domain_update(
      "hello_items", id,
      json.encode({ title = title, status = status, note = note })
    )
    if err then return json.encode({ ok = false, error = err }) end

    -- Upsert detail: find existing detail row then update, or insert if absent.
    local description = data.description or ""
    local priority    = data.priority    or ""
    local due_date    = data.due_date    or ""
    local tags        = data.tags        or ""

    local det_rows_json, _ = noderouter.query(
      "SELECT id FROM domain_hello_item_details WHERE deleted_at IS NULL AND payload LIKE ? LIMIT 1",
      json.encode({ '%"item_id":"' .. id .. '"%' })
    )
    local det_rows = json.decode(det_rows_json) or {}
    if #det_rows > 0 then
      noderouter.domain_update(
        "hello_item_details", det_rows[1].id,
        json.encode({
          item_id = id, description = description,
          priority = priority, due_date = due_date, tags = tags
        })
      )
    else
      noderouter.domain_insert(
        "hello_item_details",
        json.encode({
          item_id = id, description = description,
          priority = priority, due_date = due_date, tags = tags
        })
      )
    end

    noderouter.emit("item_updated", json.encode({ id = id, title = title }))
    return json.encode({ ok = true, id = id })
  end

  -- ── DELETE (soft) ─────────────────────────────────────────────────────────
  -- Soft-deletes both the item and its detail record atomically.
  if action == "delete" then
    local id = data.id
    if not id or id == "" then
      return json.encode({ ok = false, error = "id is required" })
    end

    local err = noderouter.domain_delete("hello_items", id)
    if err then return json.encode({ ok = false, error = err }) end

    -- Also soft-delete the linked detail record if it exists.
    local det_rows_json, _ = noderouter.query(
      "SELECT id FROM domain_hello_item_details WHERE deleted_at IS NULL AND payload LIKE ? LIMIT 1",
      json.encode({ '%"item_id":"' .. id .. '"%' })
    )
    local det_rows = json.decode(det_rows_json) or {}
    if #det_rows > 0 then
      noderouter.domain_delete("hello_item_details", det_rows[1].id)
    end

    noderouter.emit("item_deleted", json.encode({ id = id }))
    return json.encode({ ok = true, id = id })
  end

  return json.encode({ ok = false, error = "unknown action: " .. tostring(action) })
end

-- ── Named handlers ────────────────────────────────────────────────────────────

function ping(payload)
  noderouter.emit("pong", '{"ts":' .. tostring(noderouter.now_ms()) .. '}')
end
