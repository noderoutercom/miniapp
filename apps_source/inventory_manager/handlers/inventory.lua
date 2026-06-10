-- handlers/inventory.lua — Inventory Manager handlers
local M = {}

function M.list_items(params)
  local resp, err = noderouter.query("list_items", json.encode({
    status = params.status or nil
  }))
  if err then return nil, err end
  local decoded = json.decode(resp)
  return decoded.rows or {}
end

function M.insert_item(params)
  if not params.item_code or params.item_code == "" then
    return nil, "item_code is required"
  end
  if type(params.quantity) ~= "number" then
    return nil, "quantity must be a number"
  end
  local status = params.status or "active"
  local resp, err = noderouter.mutate("insert_item", json.encode({
    item_code = params.item_code,
    quantity  = params.quantity,
    status    = status,
  }))
  if err then return nil, err end
  local decoded = json.decode(resp)
  local row = (decoded.rows or {})[1]
  noderouter.log("info", "inserted item: " .. tostring(params.item_code))
  return row
end

return M
