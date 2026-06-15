# services/refs.py — UOM and Category reference data
from .helpers import run, run_one, require


def list_uoms(query, params):
    return run(query, "list_uoms", {})


def list_categories(query, params):
    return run(query, "list_categories", {})


def insert_uom(query, params):
    require(params, "uom_code", "name")
    return run_one(query, "insert_uom", {
        "uom_code": params["uom_code"].strip().upper(),
        "name":     params["name"].strip(),
        "is_base":  bool(params.get("is_base", False)),
    })


def insert_category(query, params):
    require(params, "category_code", "name")
    return run_one(query, "insert_category", {
        "category_code": params["category_code"].strip().upper(),
        "name":          params["name"].strip(),
        "parent_id":     params.get("parent_id") or None,
    })
