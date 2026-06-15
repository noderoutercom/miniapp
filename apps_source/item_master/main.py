# main.py — Item Master entry point
import services.items as items
import services.refs  as refs

ROUTES = {
    "list_uoms":          refs.list_uoms,
    "list_categories":    refs.list_categories,
    "insert_uom":         refs.insert_uom,
    "insert_category":    refs.insert_category,
    "list_items":         items.list_items,
    "count_items":        items.count_items,
    "get_item":           items.get_item,
    "insert_item":        items.insert_item,
    "update_item":        items.update_item,
    "change_item_status": items.change_item_status,
    "delete_item":        items.delete_item,
}


def execute(data, query=None) -> dict:
    if not isinstance(data, dict):
        return {"error": "invalid payload"}

    action  = data.get("action")
    handler = ROUTES.get(action)
    if not handler:
        return {"error": f"unknown action: {action}"}

    try:
        result = handler(query, data.get("params") or {})
        return {"data": result}
    except (ValueError, RuntimeError) as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": "internal error"}

