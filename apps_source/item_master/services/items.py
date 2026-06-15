# services/items.py — Item Master CRUD
from .helpers import run, run_one, require


def list_items(query, params):
    page      = max(int(params.get("page", 1)), 1)
    page_size = min(int(params.get("page_size", 25)), 100)
    offset    = (page - 1) * page_size
    return run(query, "list_items", {
        "status":      params.get("status")      or None,
        "item_type":   params.get("item_type")   or None,
        "category_id": params.get("category_id") or None,
        "search":      params.get("search")      or None,
        "page_size":   page_size,
        "offset":      offset,
    })


def count_items(query, params):
    rows = run(query, "count_items", {
        "status":      params.get("status")      or None,
        "item_type":   params.get("item_type")   or None,
        "category_id": params.get("category_id") or None,
        "search":      params.get("search")      or None,
    })
    return rows[0] if rows else {"total": 0}


def get_item(query, params):
    require(params, "id")
    rows = run(query, "get_item", {"id": params["id"]})
    return rows[0] if rows else None


def insert_item(query, params):
    require(params, "item_code", "name", "item_type", "category_id", "base_uom_id")
    item = run_one(query, "insert_item", {
        "item_code":      params["item_code"].strip().upper(),
        "name":           params["name"].strip(),
        "description":    params.get("description") or None,
        "item_type":      params["item_type"],
        "category_id":    params["category_id"],
        "base_uom_id":    params["base_uom_id"],
        "is_lot_tracked": bool(params.get("is_lot_tracked", False)),
    })
    if not item:
        raise RuntimeError("insert failed")
    item_id = item["id"]
    run_one(query, "upsert_item_planning", {
        "item_id":        item_id,
        "safety_stock":   float(params.get("safety_stock",  0)),
        "reorder_point":  float(params.get("reorder_point", 0)),
        "lead_time_days": int(params.get("lead_time_days",  0)),
        "min_order_qty":  float(params.get("min_order_qty", 1)),
    })
    run_one(query, "upsert_item_costing", {
        "item_id":        item_id,
        "costing_method": params.get("costing_method", "STANDARD"),
        "standard_cost":  float(params.get("standard_cost", 0)),
        "avg_cost":       float(params.get("avg_cost",       0)),
        "currency":       params.get("currency", "USD"),
    })
    return item


def update_item(query, params):
    require(params, "id", "item_code", "name", "item_type", "category_id", "base_uom_id", "version")
    item = run_one(query, "update_item", {
        "id":             params["id"],
        "item_code":      params["item_code"].strip().upper(),
        "name":           params["name"].strip(),
        "description":    params.get("description") or None,
        "item_type":      params["item_type"],
        "category_id":    params["category_id"],
        "base_uom_id":    params["base_uom_id"],
        "is_lot_tracked": bool(params.get("is_lot_tracked", False)),
        "version":        int(params["version"]),
    })
    if not item:
        raise RuntimeError("optimistic lock conflict — record was modified by another user")
    item_id = params["id"]
    run_one(query, "upsert_item_planning", {
        "item_id":        item_id,
        "safety_stock":   float(params.get("safety_stock",  0)),
        "reorder_point":  float(params.get("reorder_point", 0)),
        "lead_time_days": int(params.get("lead_time_days",  0)),
        "min_order_qty":  float(params.get("min_order_qty", 1)),
    })
    run_one(query, "upsert_item_costing", {
        "item_id":        item_id,
        "costing_method": params.get("costing_method", "STANDARD"),
        "standard_cost":  float(params.get("standard_cost", 0)),
        "avg_cost":       float(params.get("avg_cost",       0)),
        "currency":       params.get("currency", "USD"),
    })
    return item


def change_item_status(query, params):
    require(params, "id", "status")
    VALID = {"DRAFT", "ACTIVE", "PHASE_OUT", "OBSOLETE"}
    if params["status"] not in VALID:
        raise ValueError(f"invalid status: {params['status']}")
    return run_one(query, "change_item_status", {
        "id":     params["id"],
        "status": params["status"],
    })


def delete_item(query, params):
    require(params, "id")
    return run_one(query, "delete_item", {"id": params["id"]})
