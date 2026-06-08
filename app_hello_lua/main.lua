-- app_hello_lua/main.lua  v4
-- CRUD demo on domain_hello_items.
-- domain_hello_items is created automatically on install — no DDL needed here.
-- Create uses domain_insert (queues for Central upstream).
-- Update / delete use exec directly on the local SQLite domain table.

noderouter.log("info", "app_hello_lua v4 loaded")

function execute(payload_json)
  local data   = json.decode(payload_json) or {}
  local action = data.action or "list"

  -- ── LIST ──────────────────────────────────────────────────────────────────
  -- Return id + payload (JSON string) + timestamps. Frontend parses payload.
  -- Avoids json_extract which is not available in the pure-Go SQLite driver.
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

  -- ── CREATE ────────────────────────────────────────────────────────────────
  -- domain_insert stores locally AND queues for Central upstream delivery.
  if action == "create" then
    local title  = (data.title  and data.title  ~= "") and data.title  or "Untitled"
    local status = (data.status and data.status ~= "") and data.status or "open"
    local note   = data.note or ""

    local id, err = noderouter.domain_insert(
      "hello_items",
      json.encode({ title = title, status = status, note = note })
    )
    if err then return json.encode({ ok = false, error = err }) end

    noderouter.emit("item_created", json.encode({ id = id, title = title }))
    return json.encode({ ok = true, id = id })
  end

  -- ── UPDATE ────────────────────────────────────────────────────────────────
  -- domain_update: updates locally AND queues for Central upstream.
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

    noderouter.emit("item_updated", json.encode({ id = id, title = title }))
    return json.encode({ ok = true, id = id })
  end

  -- ── DELETE (soft) ─────────────────────────────────────────────────────────
  -- domain_delete: soft-deletes locally AND queues for Central upstream.
  if action == "delete" then
    local id = data.id
    if not id or id == "" then
      return json.encode({ ok = false, error = "id is required" })
    end

    local err = noderouter.domain_delete("hello_items", id)
    if err then return json.encode({ ok = false, error = err }) end

    noderouter.emit("item_deleted", json.encode({ id = id }))
    return json.encode({ ok = true, id = id })
  end

  return json.encode({ ok = false, error = "unknown action: " .. tostring(action) })
end

-- ── Named handlers ────────────────────────────────────────────────────────────

function ping(payload)
  noderouter.emit("pong", '{"ts":' .. tostring(noderouter.now_ms()) .. '}')
end
