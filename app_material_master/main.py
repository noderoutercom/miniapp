import os, logging, contextlib, json, uuid, decimal, datetime
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

# ── Serialization helper ──────────────────────────────────────────────────────

def _clean(obj):
    """Recursively convert non-JSON-serializable psycopg2 types."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    if isinstance(obj, (uuid.UUID,)):
        return str(obj)
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    return obj

# ── Migration ─────────────────────────────────────────────────────────────────

def _migrate() -> None:
    dsn = os.getenv("DATABASE_URL", "")
    if not dsn:
        log.warning("[app_material_master] DATABASE_URL not set — skipping migration")
        return
    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mm_uoms (
                    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code             VARCHAR(10)  UNIQUE NOT NULL,
                    name             VARCHAR(50)  NOT NULL,
                    allow_fractional BOOLEAN      NOT NULL DEFAULT FALSE
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mm_material_categories (
                    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    parent_id UUID REFERENCES mm_material_categories(id),
                    code      VARCHAR(20) UNIQUE NOT NULL,
                    name      VARCHAR(100) NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mm_materials (
                    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    sku_code         VARCHAR(50)  UNIQUE NOT NULL,
                    name             VARCHAR(150) NOT NULL,
                    description      TEXT,
                    category_id      UUID NOT NULL REFERENCES mm_material_categories(id),
                    base_uom_id      UUID NOT NULL REFERENCES mm_uoms(id),
                    status           VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
                                         CHECK (status IN ('DRAFT','ACTIVE','DEPRECATED','INACTIVE')),
                    tracking_profile VARCHAR(20)  NOT NULL DEFAULT 'NONE'
                                         CHECK (tracking_profile IN ('NONE','BATCH','SERIAL','BOTH')),
                    attributes       JSONB        NOT NULL DEFAULT '{}',
                    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS mm_material_uom_conversions (
                    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    material_id       UUID NOT NULL REFERENCES mm_materials(id) ON DELETE CASCADE,
                    alt_uom_id        UUID NOT NULL REFERENCES mm_uoms(id),
                    conversion_factor NUMERIC(12,4) NOT NULL,
                    UNIQUE (material_id, alt_uom_id)
                )
            """)
            # Seed a few default UoMs if empty
            cur.execute("SELECT COUNT(*) FROM mm_uoms")
            if cur.fetchone()[0] == 0:
                cur.execute("""
                    INSERT INTO mm_uoms (code, name, allow_fractional) VALUES
                        ('PCS',  'Piece',      FALSE),
                        ('KG',   'Kilogram',   TRUE),
                        ('G',    'Gram',       TRUE),
                        ('L',    'Litre',      TRUE),
                        ('M',    'Metre',      TRUE),
                        ('BOX',  'Box',        FALSE),
                        ('PALL', 'Pallet',     FALSE),
                        ('SET',  'Set',        FALSE)
                    ON CONFLICT DO NOTHING
                """)
        conn.commit()
    log.info("[app_material_master] migration ok")

_migrate()

# ── DB helper ─────────────────────────────────────────────────────────────────

@contextlib.contextmanager
def _get_conn(conn=None):
    if conn is not None:
        yield conn
    else:
        with psycopg2.connect(os.getenv("DATABASE_URL")) as own:
            yield own

# ── Entry point ───────────────────────────────────────────────────────────────

def execute(data: dict, conn=None) -> dict:
    action = str(data.get("action", "")).strip()

    if action == "list_materials":
        result = _list_materials(data, conn=conn)
    elif action == "get_material":
        result = _get_material(data, conn=conn)
    elif action == "create_material":
        result = _create_material(data, conn=conn)
    elif action == "update_material":
        result = _update_material(data, conn=conn)
    elif action == "delete_material":
        result = _delete_material(data, conn=conn)
    elif action == "check_sku":
        result = _check_sku(data, conn=conn)
    elif action == "list_uoms":
        result = _list_uoms(conn=conn)
    elif action == "create_uom":
        result = _create_uom(data, conn=conn)
    elif action == "update_uom":
        result = _update_uom(data, conn=conn)
    elif action == "delete_uom":
        result = _delete_uom(data, conn=conn)
    elif action == "list_categories":
        result = _list_categories(conn=conn)
    elif action == "create_category":
        result = _create_category(data, conn=conn)
    elif action == "update_category":
        result = _update_category(data, conn=conn)
    elif action == "delete_category":
        result = _delete_category(data, conn=conn)
    elif action == "save_conversions":
        result = _save_conversions(data, conn=conn)
    else:
        result = {"message": "ok"}

    return _clean(result)

# ── Materials ─────────────────────────────────────────────────────────────────

def _list_materials(data: dict, conn=None) -> dict:
    search   = str(data.get("search", "")).strip()
    statuses = data.get("statuses", [])
    cats     = data.get("categories", [])
    page     = max(1, int(data.get("page", 1)))
    per_page = int(data.get("per_page", 25))
    sort_col = data.get("sort", "updated_at")
    sort_dir = "ASC" if str(data.get("dir", "desc")).upper() == "ASC" else "DESC"

    allowed_cols = {"sku_code", "name", "updated_at", "status"}
    if sort_col not in allowed_cols:
        sort_col = "updated_at"

    where, params = [], []
    if search:
        where.append("(m.sku_code ILIKE %s OR m.name ILIKE %s)")
        params += [f"%{search}%", f"%{search}%"]
    if statuses:
        where.append("m.status = ANY(%s::varchar[])")
        params.append(list(statuses))
    if cats:
        where.append("m.category_id = ANY(%s::uuid[])")
        params.append([str(c) for c in cats])

    where_sql = "WHERE " + " AND ".join(where) if where else ""
    offset = (page - 1) * per_page

    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT COUNT(*) AS total FROM mm_materials m {where_sql}
            """, params)
            total = cur.fetchone()["total"]

            cur.execute(f"""
                SELECT m.id, m.sku_code, m.name, m.status, m.tracking_profile,
                       m.updated_at,
                       u.code AS base_uom_code, u.name AS base_uom_name,
                       c.name AS category_name
                FROM mm_materials m
                JOIN mm_uoms u ON u.id = m.base_uom_id
                JOIN mm_material_categories c ON c.id = m.category_id
                {where_sql}
                ORDER BY m.{sort_col} {sort_dir}
                LIMIT %s OFFSET %s
            """, params + [per_page, offset])
            rows = cur.fetchall()

    return {
        "rows": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


def _get_material(data: dict, conn=None) -> dict:
    mid = str(data.get("id", ""))
    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT m.*,
                       u.code AS base_uom_code, u.name AS base_uom_name,
                       c.name AS category_name
                FROM mm_materials m
                JOIN mm_uoms u ON u.id = m.base_uom_id
                JOIN mm_material_categories c ON c.id = m.category_id
                WHERE m.id = %s
            """, (mid,))
            mat = cur.fetchone()
            if not mat:
                return {"error": "Material not found"}

            cur.execute("""
                SELECT mc.id, mc.alt_uom_id, u.code AS uom_code, u.name AS uom_name,
                       mc.conversion_factor
                FROM mm_material_uom_conversions mc
                JOIN mm_uoms u ON u.id = mc.alt_uom_id
                WHERE mc.material_id = %s
            """, (mid,))
            convs = cur.fetchall()

    result = dict(mat)
    result["conversions"] = [dict(r) for r in convs]
    return result


def _create_material(data: dict, conn=None) -> dict:
    req = data.get("material", {})
    sku       = str(req.get("sku_code", "")).strip()
    name      = str(req.get("name", "")).strip()
    desc      = req.get("description", "")
    cat_id    = str(req.get("category_id", ""))
    uom_id    = str(req.get("base_uom_id", ""))
    status    = req.get("status", "DRAFT")
    tracking  = req.get("tracking_profile", "NONE")
    attrs     = req.get("attributes", {})

    if not sku:
        return {"error": "SKU code is required"}
    if not name:
        return {"error": "Name is required"}

    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id FROM mm_materials WHERE sku_code = %s", (sku,))
            if cur.fetchone():
                return {"error": f"SKU '{sku}' already exists"}
            cur.execute("""
                INSERT INTO mm_materials
                    (sku_code, name, description, category_id, base_uom_id,
                     status, tracking_profile, attributes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (sku, name, desc, cat_id, uom_id, status, tracking,
                  json.dumps(attrs)))
            new_id = cur.fetchone()["id"]

            convs = req.get("conversions", [])
            for cv in convs:
                cur.execute("""
                    INSERT INTO mm_material_uom_conversions
                        (material_id, alt_uom_id, conversion_factor)
                    VALUES (%s,%s,%s)
                    ON CONFLICT (material_id, alt_uom_id) DO UPDATE
                        SET conversion_factor = EXCLUDED.conversion_factor
                """, (str(new_id), str(cv["alt_uom_id"]), cv["conversion_factor"]))
        c.commit()
    return {"id": str(new_id), "message": "Material created"}


def _update_material(data: dict, conn=None) -> dict:
    mid = str(data.get("id", ""))
    req = data.get("material", {})

    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id FROM mm_materials WHERE id = %s", (mid,))
            if not cur.fetchone():
                return {"error": "Material not found"}

            fields, vals = [], []
            for col in ("sku_code","name","description","category_id",
                        "base_uom_id","status","tracking_profile"):
                if col in req:
                    fields.append(f"{col} = %s")
                    vals.append(req[col])
            if "attributes" in req:
                fields.append("attributes = %s")
                vals.append(json.dumps(req["attributes"]))
            fields.append("updated_at = NOW()")
            vals.append(mid)

            if fields:
                cur.execute(
                    f"UPDATE mm_materials SET {', '.join(fields)} WHERE id = %s",
                    vals
                )

            if "conversions" in req:
                cur.execute("DELETE FROM mm_material_uom_conversions WHERE material_id = %s", (mid,))
                for cv in req["conversions"]:
                    cur.execute("""
                        INSERT INTO mm_material_uom_conversions
                            (material_id, alt_uom_id, conversion_factor)
                        VALUES (%s,%s,%s)
                    """, (mid, str(cv["alt_uom_id"]), cv["conversion_factor"]))
        c.commit()
    return {"message": "Material updated"}


def _delete_material(data: dict, conn=None) -> dict:
    mid = str(data.get("id", ""))
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute("DELETE FROM mm_materials WHERE id = %s", (mid,))
        c.commit()
    return {"message": "Material deleted"}


def _check_sku(data: dict, conn=None) -> dict:
    sku = str(data.get("sku_code", "")).strip()
    mid = str(data.get("exclude_id", ""))
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            if mid:
                cur.execute("SELECT id FROM mm_materials WHERE sku_code=%s AND id!=%s", (sku, mid))
            else:
                cur.execute("SELECT id FROM mm_materials WHERE sku_code=%s", (sku,))
            exists = cur.fetchone() is not None
    return {"exists": exists}

# ── UoMs ──────────────────────────────────────────────────────────────────────

def _list_uoms(conn=None) -> dict:
    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM mm_uoms ORDER BY code")
            rows = cur.fetchall()
    return {"rows": [dict(r) for r in rows]}


def _create_uom(data: dict, conn=None) -> dict:
    code = str(data.get("code", "")).strip().upper()
    name = str(data.get("name", "")).strip()
    frac = bool(data.get("allow_fractional", False))
    if not code or not name:
        return {"error": "Code and name are required"}
    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO mm_uoms (code, name, allow_fractional)
                VALUES (%s,%s,%s) RETURNING id
            """, (code, name, frac))
            new_id = cur.fetchone()["id"]
        c.commit()
    return {"id": str(new_id), "message": "UoM created"}


def _update_uom(data: dict, conn=None) -> dict:
    uid  = str(data.get("id", ""))
    code = str(data.get("code", "")).strip().upper()
    name = str(data.get("name", "")).strip()
    frac = bool(data.get("allow_fractional", False))
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute("""
                UPDATE mm_uoms SET code=%s, name=%s, allow_fractional=%s WHERE id=%s
            """, (code, name, frac, uid))
        c.commit()
    return {"message": "UoM updated"}


def _delete_uom(data: dict, conn=None) -> dict:
    uid = str(data.get("id", ""))
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            try:
                cur.execute("DELETE FROM mm_uoms WHERE id=%s", (uid,))
                c.commit()
            except Exception as e:
                c.rollback()
                return {"error": str(e)}
    return {"message": "UoM deleted"}

# ── Categories ────────────────────────────────────────────────────────────────

def _list_categories(conn=None) -> dict:
    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT c.*, p.name AS parent_name
                FROM mm_material_categories c
                LEFT JOIN mm_material_categories p ON p.id = c.parent_id
                ORDER BY c.code
            """)
            rows = cur.fetchall()
    return {"rows": [dict(r) for r in rows]}


def _create_category(data: dict, conn=None) -> dict:
    code      = str(data.get("code", "")).strip().upper()
    name      = str(data.get("name", "")).strip()
    parent_id = data.get("parent_id") or None
    if not code or not name:
        return {"error": "Code and name are required"}
    with _get_conn(conn) as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO mm_material_categories (code, name, parent_id)
                VALUES (%s,%s,%s) RETURNING id
            """, (code, name, parent_id))
            new_id = cur.fetchone()["id"]
        c.commit()
    return {"id": str(new_id), "message": "Category created"}


def _update_category(data: dict, conn=None) -> dict:
    cid       = str(data.get("id", ""))
    code      = str(data.get("code", "")).strip().upper()
    name      = str(data.get("name", "")).strip()
    parent_id = data.get("parent_id") or None
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute("""
                UPDATE mm_material_categories
                SET code=%s, name=%s, parent_id=%s WHERE id=%s
            """, (code, name, parent_id, cid))
        c.commit()
    return {"message": "Category updated"}


def _delete_category(data: dict, conn=None) -> dict:
    cid = str(data.get("id", ""))
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            try:
                cur.execute("DELETE FROM mm_material_categories WHERE id=%s", (cid,))
                c.commit()
            except Exception as e:
                c.rollback()
                return {"error": str(e)}
    return {"message": "Category deleted"}


def _save_conversions(data: dict, conn=None) -> dict:
    mid   = str(data.get("material_id", ""))
    convs = data.get("conversions", [])
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute("DELETE FROM mm_material_uom_conversions WHERE material_id=%s", (mid,))
            for cv in convs:
                cur.execute("""
                    INSERT INTO mm_material_uom_conversions
                        (material_id, alt_uom_id, conversion_factor)
                    VALUES (%s,%s,%s)
                """, (mid, str(cv["alt_uom_id"]), cv["conversion_factor"]))
        c.commit()
    return {"message": "Conversions saved"}
