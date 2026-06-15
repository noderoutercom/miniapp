# services/helpers.py — shared DB utilities


def run(query, action, params):
    """Execute a named manifest action via the runner-injected query callable."""
    rows = query(action, params)
    return rows if isinstance(rows, list) else []


def run_one(query, action, params):
    """Execute a named manifest action and return the first row or None."""
    rows = query(action, params)
    if isinstance(rows, list):
        return rows[0] if rows else None
    return rows if isinstance(rows, dict) else None


def require(params, *fields):
    for f in fields:
        if not params.get(f):
            raise ValueError(f"{f} is required")
