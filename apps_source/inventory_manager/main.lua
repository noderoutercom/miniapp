-- main.lua — Inventory Manager entry point
local H = require("handlers.inventory")

local routes = {
  list_items  = H.list_items,
  insert_item = H.insert_item,
}

function execute(payload_str)
  local ok, payload = pcall(json.decode, payload_str)
  if not ok or type(payload) ~= "table" then
    return json.encode({ error = "invalid payload" })
  end
  local handler = routes[payload.action]
  if not handler then
    return json.encode({ error = "unknown action: " .. tostring(payload.action) })
  end
  local result, err = handler(payload.params or {})
  if err then return json.encode({ error = err }) end
  return json.encode({ data = result })
end
