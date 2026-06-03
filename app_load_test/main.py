import concurrent.futures
import contextlib
import http.client
import json
import logging
import math
import os
import socket as _socket
import time

import psycopg2

log = logging.getLogger(__name__)

SLUG          = "app_load_test"
RECORDS_TABLE = "app_load_test_records"
HISTORY_TABLE = "app_load_test_history"

INTENSITY_CFG = {
    1: {"matrix_sz": 80,  "sieve_n":  80_000, "steps":  6},
    2: {"matrix_sz": 120, "sieve_n": 200_000, "steps": 10},
    3: {"matrix_sz": 160, "sieve_n": 400_000, "steps": 15},
}

_DOCKER_SOCK    = "/var/run/docker.sock"
_prev_cpu: dict = {}   # {container_id: (total_usage, system_usage)}
_prev_proc_cpu: list = []  # previous /proc/stat cpu values for delta calculation


def _dsn() -> str:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is not configured")
    return dsn


@contextlib.contextmanager
def _get_conn(conn=None):
    if conn is not None:
        yield conn
    else:
        with psycopg2.connect(_dsn()) as own:
            yield own


# ── Migration ─────────────────────────────────────────────────────────────────

def _migrate() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        log.warning("[%s] DATABASE_URL not set — skipping migration", SLUG)
        return
    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {RECORDS_TABLE} (
                    id         BIGSERIAL PRIMARY KEY,
                    first_name VARCHAR(50),
                    last_name  VARCHAR(50),
                    email      VARCHAR(100),
                    age        INTEGER,
                    score      NUMERIC(10,2),
                    notes      TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} (
                    id         BIGSERIAL PRIMARY KEY,
                    req_type   VARCHAR(10)  NOT NULL,
                    status     VARCHAR(10)  NOT NULL,
                    latency_ms INTEGER,
                    error_msg  TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_{HISTORY_TABLE}_created
                ON {HISTORY_TABLE} (created_at DESC)
            """)
        conn.commit()
    log.info("[%s] migration ok", SLUG)


_migrate()


# ── Sync insert ───────────────────────────────────────────────────────────────

def _sync_insert(data: dict, conn=None) -> dict:
    t0 = time.perf_counter()

    first_name = str(data.get("first_name", "Test"))[:50]
    last_name  = str(data.get("last_name",  "User"))[:50]
    email      = str(data.get("email", "test@example.com"))[:100]
    age        = int(data.get("age", 25))
    score      = float(data.get("score", 0.0))
    notes      = str(data.get("notes", ""))[:200]

    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute(
                f"INSERT INTO {RECORDS_TABLE} (first_name, last_name, email, age, score, notes)"
                f" VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (first_name, last_name, email, age, score, notes),
            )
            record_id  = cur.fetchone()[0]
            latency_ms = int((time.perf_counter() - t0) * 1000)
            cur.execute(
                f"INSERT INTO {HISTORY_TABLE} (req_type, status, latency_ms)"
                f" VALUES ('sync','ok',%s)",
                (latency_ms,),
            )
        c.commit()

    result = {"record_id": record_id, "latency_ms": latency_ms}
    result["_actions"] = [{"name": "sync_complete", "payload": {"record_id": record_id}}]
    return result


# ── Async heavy compute ───────────────────────────────────────────────────────

def _async_compute(data: dict) -> dict:
    job_id    = data.get("_job_id", "")
    intensity = max(1, min(int(data.get("intensity", 1)), 3))
    cfg       = INTENSITY_CFG[intensity]
    dsn       = _dsn()
    t0        = time.time()

    sz      = cfg["matrix_sz"]
    sieve_n = cfg["sieve_n"]
    steps   = cfg["steps"]

    last_reported = 0
    checksum      = 0

    for step in range(steps):
        sieve = bytearray([1]) * (sieve_n + 1)
        sieve[0] = sieve[1] = 0
        for i in range(2, int(math.isqrt(sieve_n)) + 1):
            if sieve[i]:
                sieve[i * i::i] = bytearray(len(sieve[i * i::i]))
        checksum += sum(sieve)

        a = [[float((i * j + step) % 17) for j in range(sz)] for i in range(sz)]
        b = [[float((i + j) % 13)         for j in range(sz)] for i in range(sz)]
        c_mat = [
            [sum(a[i][k] * b[k][j] for k in range(sz)) for j in range(sz)]
            for i in range(sz)
        ]
        checksum += int(c_mat[0][0]) % 1_000

        progress = int(((step + 1) / steps) * 99)
        if job_id and progress >= last_reported + 10:
            last_reported = (progress // 10) * 10
            try:
                with psycopg2.connect(dsn) as hc:
                    with hc.cursor() as cur:
                        cur.execute(
                            "UPDATE noderouter_core.job_queue"
                            " SET progress=%s, updated_at=NOW() WHERE id=%s",
                            (last_reported, job_id),
                        )
                    hc.commit()
            except Exception:
                pass

    duration_ms = int((time.time() - t0) * 1000)
    try:
        with psycopg2.connect(dsn) as hc:
            with hc.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {HISTORY_TABLE} (req_type, status, latency_ms)"
                    f" VALUES ('async','ok',%s)",
                    (duration_ms,),
                )
            hc.commit()
    except Exception:
        pass

    result = {"message": "compute done", "duration_ms": duration_ms, "intensity": intensity, "checksum": checksum}
    result["_actions"] = [{"name": "async_complete", "payload": {"duration_ms": duration_ms}}]
    return result


# ── System stats (Docker → psutil → unavailable) ──────────────────────────────

def _docker_get(path: str):
    class _UC(http.client.HTTPConnection):
        def connect(self):
            s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
            s.settimeout(3.0)
            s.connect(_DOCKER_SOCK)
            self.sock = s
    c = _UC("localhost")
    c.request("GET", path)
    r = c.getresponse()
    return json.loads(r.read())


def _one_container_stats(item):
    cid, name = item
    try:
        # one-shot=true: single fast snapshot (< 100 ms), CPU% computed from successive calls
        s = _docker_get(f"/containers/{cid}/stats?stream=false&one-shot=true")

        cur_cpu = s["cpu_stats"]["cpu_usage"]["total_usage"]
        cur_sys = s["cpu_stats"].get("system_cpu_usage", 0)
        nc      = s["cpu_stats"].get("online_cpus") or max(
                      len(s["cpu_stats"]["cpu_usage"].get("percpu_usage", [])), 1)

        cpu_pct = 0.0
        if cid in _prev_cpu:
            pc, ps = _prev_cpu[cid]
            cd, sd = cur_cpu - pc, cur_sys - ps
            if sd > 0:
                cpu_pct = round((cd / sd) * nc * 100, 1)
        _prev_cpu[cid] = (cur_cpu, cur_sys)

        ms      = s.get("memory_stats", {})
        mem_use = max(ms.get("usage", 0) - ms.get("stats", {}).get("cache", 0), 0)
        mem_lim = ms.get("limit", 1)
        return {
            "name":    name,
            "cpu_pct": cpu_pct,
            "mem_mb":  round(mem_use / 1024 / 1024, 1),
            "mem_pct": round(mem_use / mem_lim * 100, 1) if mem_lim else 0.0,
        }
    except Exception:
        return None


def _proc_fallback() -> dict:
    """Always-available stats from /proc — works in any Linux runner container."""
    global _prev_proc_cpu
    items = []

    # CPU% from /proc/stat (delta between successive calls)
    cpu_pct = 0.0
    try:
        with open("/proc/stat") as f:
            fields = f.readline().split()        # "cpu  user nice system idle iowait ..."
        curr = [int(x) for x in fields[1:]]
        if _prev_proc_cpu and len(_prev_proc_cpu) >= 5 and len(curr) >= 5:
            total_d = sum(curr) - sum(_prev_proc_cpu)
            idle_d  = (curr[3] + curr[4]) - (_prev_proc_cpu[3] + _prev_proc_cpu[4])
            if total_d > 0:
                cpu_pct = round(max(0.0, (1 - idle_d / total_d)) * 100, 1)
        _prev_proc_cpu = curr
    except Exception:
        pass

    # Memory from /proc/meminfo
    mem_mb  = 0.0
    mem_pct = 0.0
    try:
        mem: dict = {}
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    mem[parts[0].rstrip(":")] = int(parts[1])
        total   = mem.get("MemTotal", 0)
        avail   = mem.get("MemAvailable", mem.get("MemFree", 0))
        used    = max(0, total - avail)
        mem_mb  = round(used / 1024, 1)
        mem_pct = round(used / total * 100, 1) if total else 0.0
    except Exception:
        pass

    items.append({"name": "system", "cpu_pct": cpu_pct, "mem_mb": mem_mb, "mem_pct": mem_pct})

    # Python runner process RSS from /proc/self/status
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    rss_kb = int(line.split()[1])
                    items.append({
                        "name": "py-runner", "cpu_pct": 0.0,
                        "mem_mb": round(rss_kb / 1024, 1), "mem_pct": 0.0,
                    })
                    break
    except Exception:
        pass

    return {"containers": items, "source": "proc", "timestamp": time.time()}


def _get_system_stats() -> dict:
    # ── Docker socket ──────────────────────────────────────────────────
    if os.path.exists(_DOCKER_SOCK):
        try:
            ctrs  = _docker_get("/containers/json")
            items = [
                (c["Id"], (c.get("Names") or [c["Id"][:12]])[0].lstrip("/"))
                for c in ctrs[:8]
            ]
            if items:
                with concurrent.futures.ThreadPoolExecutor(max_workers=len(items)) as ex:
                    results = list(ex.map(_one_container_stats, items, timeout=4))
                return {
                    "containers": [r for r in results if r],
                    "source":     "docker",
                    "timestamp":  time.time(),
                }
        except Exception:
            pass

    # ── psutil fallback ────────────────────────────────────────────────
    try:
        import psutil  # type: ignore

        cpu_pct = psutil.cpu_percent(interval=0.1)
        mem     = psutil.virtual_memory()
        items   = [{"name": "host", "cpu_pct": round(cpu_pct, 1),
                    "mem_mb": round(mem.used / 1024 / 1024, 1),
                    "mem_pct": round(mem.percent, 1)}]

        key = {"python", "python3", "postgres", "node", "nginx", "go"}
        seen: set = set()
        for p in psutil.process_iter(["name", "cpu_percent", "memory_info"]):
            try:
                nm   = p.info["name"]
                base = nm.lower().rstrip("0123456789.-")
                if base in key and base not in seen:
                    seen.add(base)
                    items.append({
                        "name":    nm,
                        "cpu_pct": round(p.cpu_percent(interval=None), 1),
                        "mem_mb":  round(p.info["memory_info"].rss / 1024 / 1024, 1),
                        "mem_pct": 0.0,
                    })
            except Exception:
                pass
        return {"containers": items, "source": "psutil", "timestamp": time.time()}
    except ImportError:
        pass

    # ── /proc fallback (always works in Linux runner container) ───────
    return _proc_fallback()


# ── History / stats / clear ───────────────────────────────────────────────────

def _get_history(data: dict, conn=None) -> dict:
    limit    = min(int(data.get("limit", 200)), 1000)
    req_type = str(data.get("req_type", "")).strip()

    with _get_conn(conn) as c:
        with c.cursor() as cur:
            if req_type in ("sync", "async"):
                cur.execute(
                    f"SELECT id, req_type, status, latency_ms, error_msg, created_at"
                    f" FROM {HISTORY_TABLE} WHERE req_type=%s ORDER BY id DESC LIMIT %s",
                    (req_type, limit),
                )
            else:
                cur.execute(
                    f"SELECT id, req_type, status, latency_ms, error_msg, created_at"
                    f" FROM {HISTORY_TABLE} ORDER BY id DESC LIMIT %s",
                    (limit,),
                )
            rows = cur.fetchall()

    return {
        "rows": [
            {"id": r[0], "req_type": r[1], "status": r[2], "latency_ms": r[3],
             "error_msg": r[4] or "", "created_at": r[5].isoformat() if r[5] else None}
            for r in rows
        ]
    }


def _get_stats(conn=None) -> dict:
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute(f"""
                SELECT req_type,
                    COUNT(*)                                                                   AS total,
                    COUNT(*) FILTER (WHERE status='ok')                                       AS ok_count,
                    COUNT(*) FILTER (WHERE status='error')                                    AS err_count,
                    COALESCE(ROUND(AVG(latency_ms)::numeric,0),0)                             AS avg_ms,
                    COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric,0),0) AS p95_ms,
                    COALESCE(ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric,0),0) AS p99_ms
                FROM {HISTORY_TABLE} GROUP BY req_type
            """)
            rows = cur.fetchall()

    stats = {}
    for r in rows:
        stats[r[0]] = {"total": r[1], "ok": r[2], "error": r[3],
                       "avg_ms": float(r[4]), "p95_ms": float(r[5]), "p99_ms": float(r[6])}
    return {"stats": stats}


def _clear_history(conn=None) -> dict:
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute(f"TRUNCATE TABLE {HISTORY_TABLE}")
            cur.execute(f"TRUNCATE TABLE {RECORDS_TABLE}")
        c.commit()
    return {"message": "cleared"}


# ── Entry point ───────────────────────────────────────────────────────────────

def execute(data: dict, conn=None) -> dict:
    action = str(data.get("action", "")).strip()

    if action == "sync_insert":     return _sync_insert(data, conn=conn)
    if action == "async_compute":   return _async_compute(data)
    if action == "get_history":     return _get_history(data, conn=conn)
    if action == "get_stats":       return _get_stats(conn=conn)
    if action == "clear_history":   return _clear_history(conn=conn)
    if action == "get_system_stats": return _get_system_stats()

    return {"message": "ok", "app": SLUG}
