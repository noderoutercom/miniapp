# App Build Guide

Step-by-step instructions for authoring, testing, and deploying a Noderouter mini-app.

---

## Mandatory App Contract

When an app is opened through the admin UI (`/apps/<app_name>/`), its
`index.html` body content is **injected directly into the admin layout** — the
same page that runs `bootstrap.js` and `admin-ws.js`. Violating any rule below
causes silent breakage for every app loaded after yours.

### JavaScript

| Rule | Why |
|---|---|
| **Wrap all JS in an IIFE** `(function(){ "use strict"; … })();` | Prevents every function and variable from leaking into `window` and colliding with other apps or the admin layout. |
| **Never reference `window.X` without a namespace** | Generic names like `el`, `esc`, `showError` will be overwritten by the next app that uses the same names. |
| **Use event delegation instead of `onclick="globalFn()"`** | `onclick` attribute strings execute in global scope; functions inside an IIFE are not reachable. Use `data-action` attributes and a delegated listener. |
| **Scope `querySelectorAll` to `.nr-app`** | The shell wraps your content in `<div class="nr-app">`. Always scope to that root: `document.querySelector(".nr-app").querySelectorAll(…)`. Otherwise layout elements with the same attribute are accidentally captured. |
| **Do not call `AdminWS.showToast()` or `AdminWS.notifyConnected` at module scope** | `admin-ws.js` loads _after_ your script. Put any AdminWS usage inside event listeners or async callbacks, never at top level. |

### CSS

| Rule | Why |
|---|---|
| **Prefix every class with your app slug** e.g. `hw-`, `calc-`, `sales-` | Unprefixed names like `.btn-xs` collide with any other app that defines the same class. The last deployed app wins silently. |
| **Use Bootstrap CSS variables for all colors** `var(--bs-body-bg)`, `var(--bs-secondary-bg)`, etc. | Hardcoded hex values (`#ffffff`, `#f0f4f8`) ignore the system's light/dark theme — your cards render white on a near-black background in dark mode. |
| **Do not write rules that target `body`, `:root`, `*`, or bare HTML elements** | These selectors are global and override the admin layout's base styles for every element on the page. |

### HTML / Bootstrap

| Rule | Why |
|---|---|
| **Do not include `<script src="bootstrap.bundle.min.js">` in `index.html`** | The shell strips it automatically, but leaving it in is confusing. The layout owns Bootstrap — apps must not bundle it. |
| **Do not include `<link href="bootstrap.min.css">` inside `<body>`** | Layout loads it in `<head>`. A second load in body is a no-op but adds parse overhead. Keep it in your `<head>` only for standalone testing. |

### Quick checklist

```
✅ All JS inside one IIFE with "use strict"
✅ All CSS classes prefixed with the app slug
✅ All colors use var(--bs-*) tokens
✅ querySelectorAll scoped to document.querySelector(".nr-app")
✅ No onclick="globalFunction()" — use data-action + event delegation
✅ No <script src="bootstrap…"> in the body
✅ Vendor libraries loaded from /assets/vendor/* — never from an external CDN
```

---

## Available Frontend Libraries

Go Core embeds a suite of pre-approved, commercially licensed JavaScript libraries and serves them locally from the binary. **Never load these from an external CDN** — the platform runs in air-gapped enterprise environments with no internet access.

| Library | Script tag | License | Use for |
|---|---|---|---|
| **Apache ECharts 5** | `/assets/vendor/echarts.min.js` | Apache 2.0 | Charts — bar, line, pie, gauge, heatmap, tree |
| **Tabulator 6** | `/assets/vendor/tabulator.min.js` + `/assets/vendor/tabulator.min.css` | MIT | Sortable, filterable, editable data grids |
| **SheetJS Community** | `/assets/vendor/xlsx.full.min.js` | Apache 2.0 | Export data to `.xlsx` / `.csv` files in the browser |
| **PapaParse 5** | `/assets/vendor/papaparse.min.js` | MIT | Parse CSV uploads or CSV strings from the server |
| **Day.js 1** | `/assets/vendor/dayjs.min.js` | MIT | Lightweight date formatting and manipulation |
| **Lucide Icons** | `/assets/vendor/lucide.min.js` | ISC | SVG icon set — replaces individual inline SVG blocks |

### Loading rules

- Load only the libraries your app actually uses — do not copy-paste all six `<script>` tags into every app.
- Place `<script>` tags in `<head>` (or at the bottom of `<body>` before `index.js`) so the globals are available when your IIFE runs.
- Tabulator requires its CSS in `<head>` to render correctly.
- All globals (`echarts`, `Tabulator`, `XLSX`, `Papa`, `dayjs`, `lucide`) are available on `window` — reference them directly inside your IIFE; do not re-declare them as `const`.

---

## App Folder Structure

Every app is a self-contained directory that is zipped for deployment. Required files are marked **R**; everything else is optional.

```
app_<your_name>/               ← directory name = URL segment = app_name in manifest
│
├── manifest.json       (R)    ← app identity, version, declared actions
├── main.py             (R)    ← Python backend — must export execute(data, conn=None)
│
├── index.html          (R*)   ← frontend page structure (Bootstrap, no build tools)
├── index.js                   ← frontend logic — must be wrapped in an IIFE
├── style.css                  ← component-scoped styles — all classes must be prefixed
│
└── libs/                      ← vendored Python packages (pip install --target)
    └── <package>/
```

> **\\*`index.html`** is required only if the app has a UI. A pure backend app (one that is only called by other services) can omit all three frontend files.

### ZIP layout

The zip must contain the **contents** of the app directory directly at the root — not a wrapping folder:

```
app_<your_name>.zip
├── manifest.json
├── main.py
├── index.html
├── index.js
├── style.css
└── libs/
    └── …
```

Pack with:

```powershell
Compress-Archive -Path app_<your_name>\\* -DestinationPath app_<your_name>.zip
```

---

## Manifest Reference

`manifest.json` is the only file Go Core reads before the runner loads the app. Every field is described below.

```json
{
  "app_name":            "app_<your_name>",
  "display_name":        "Human-Readable Title",
  "version":             "1.0.0",
  "description":         "Shown in the admin UI app list.",
  "required_permission": "sales:access",
  "actions": [
    {
      "name":         "list_products",
      "display_name": "List Products",
      "description":  "Returns all rows from the products table."
    },
    {
      "name":         "run_report",
      "display_name": "Run Report",
      "description":  "Launches a long-running report job (async)."
    }
  ]
}
```

### Field reference

| Field | Required | Rules |
|---|---|---|
| `app_name` | **Yes** | Must match the directory name exactly. Pattern: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$` — start with alphanumeric, max 128 chars, no spaces. |
| `display_name` | **Yes** | Human-readable title shown in the admin UI navbar and app list. No length limit enforced, but keep it under 40 chars for readability. |
| `version` | **Yes** | Semver string (`MAJOR.MINOR.PATCH`). Go Core records it but does not enforce upgrade ordering. |
| `description` | No | Plain-text description shown in the admin app list. Markdown is not rendered. |
| `required_permission` | No | RBAC permission slug (e.g. `sales:access`). When set, Go Core checks the caller holds this permission **before** forwarding any request to the runner — both sync (`POST /api/sync/:app`) and async (`POST /api/async/:app`). Returns HTTP 403 if the permission is missing. Omit to allow any authenticated user to call the app. |
| `actions` | No | Array of action descriptors (see below). Omit entirely if the app has no named actions. |

### `actions[]` field reference

Each entry in `actions` declares a notification event the app can emit. This is **declarative metadata only** — the runner does not validate that the action name is used in `main.py`.

| Sub-field | Required | Rules |
|---|---|---|
| `name` | **Yes** | Slug emitted in `_actions` from `execute()`. Pattern: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`. |
| `display_name` | **Yes** | Human-readable label shown in notification toasts and the admin subscription UI. |
| `description` | No | One-sentence description of what the action does. Shown in the admin subscription UI. |

> **Why declare actions?** The admin UI reads `actions` to let operators subscribe to notification events the app emits. An undeclared action still fires at runtime, but it will never appear in the subscription list and its notifications will be invisible to subscribers.
>
> **Actions vs. `required_permission`:** `actions` controls *notifications* — who gets notified when the app does something. `required_permission` controls *execution* — who is allowed to call the app at all. They are independent.

> **Permission enforcement detail:** Go Core loads the app's `required_permission` from the database and checks it in the `Proxy` / `DispatchAsync` handlers before any tunnel or job work begins. The permission slug must exist in the RBAC system and be assigned to the caller's role; otherwise the call is rejected with `403 insufficient permissions: <slug> required`.

---


## Step 1 — Initialize the App Files

Create a directory named after your app, then create the five starter files below inside it. Replace every `<slug>` and `<prefix>` placeholder with your chosen app name — e.g. `app_sales_report` and `sr`.

> **Naming rule:** the directory name is the app's URL segment.
> It must match `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$` — start with alphanumeric, max 128 chars, no spaces.

---

### `manifest.json`

```json
{
  "app_name":    "<slug>",
  "display_name": "Human-Readable Title",
  "version":     "1.0.0",
  "description": "One-line description shown in the admin UI.",
  "required_permission": "",
  "actions": []
}
```

- Set `required_permission` to an RBAC slug (e.g. `"sales:access"`) to restrict execution to users who hold that permission. Leave it as `""` or remove the field entirely to allow any authenticated user.
- Add one entry to `actions` for every notification event your `main.py` will emit via `_actions`. See the [Manifest Reference](#manifest-reference) for all fields and constraints.

---

### `main.py`

```python
import os, contextlib, psycopg2

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

    if action == "my_action":
        return _my_action(data, conn=conn)

    return {"message": "ok"}

# ── Handlers ──────────────────────────────────────────────────────────────────

def _my_action(data: dict, conn=None) -> dict:
    return {"message": "hello from my_action"}
```

---

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title><slug></title>
    <!-- Bootstrap — only used when opening this file standalone for testing.
         The admin layout already loads Bootstrap; this tag is ignored there. -->
    <link rel="stylesheet" href="/static/css/bootstrap.min.css" />

    <!-- Vendor libraries — load only what this app needs.
         All served locally from the Go binary; no internet required. -->
    <!-- <link rel="stylesheet" href="/assets/vendor/tabulator.min.css" /> -->

    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <div class="container py-4">

      <div class="mb-4">
        <h1 class="h3 mb-1">Human-Readable Title</h1>
        <p class="text-muted mb-0 small">Short description of what this app does.</p>
      </div>

      <!-- Your content here -->

    </div>
    <!-- Bootstrap bundle — stripped by the shell when injected into the admin layout. -->
    <script src="/static/js/bootstrap.bundle.min.js"></script>

    <!-- Uncomment the vendor scripts your app needs (in dependency order). -->
    <!-- <script src="/assets/vendor/echarts.min.js"></script>   -->
    <!-- <script src="/assets/vendor/tabulator.min.js"></script> -->
    <!-- <script src="/assets/vendor/xlsx.full.min.js"></script> -->
    <!-- <script src="/assets/vendor/papaparse.min.js"></script> -->
    <!-- <script src="/assets/vendor/dayjs.min.js"></script>     -->
    <!-- <script src="/assets/vendor/lucide.min.js"></script>    -->

    <script src="index.js"></script>
  </body>
</html>
```

---

### `index.js`

```js
(function () {
  "use strict";

  // Scope all DOM queries to the .nr-app wrapper injected by the admin layout.
  // Falls back to document.body when opened standalone for testing.
  var root = document.querySelector(".nr-app") || document.body;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function el(id)  { return document.getElementById(id); }

  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  async function syncCall(body) {
    const res  = await fetch("/api/sync/<slug>", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error(text); }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ── Your handlers here ─────────────────────────────────────────────────────

})();
```

---

### `style.css`

```css
/*
 * <slug>/style.css
 * All classes are prefixed <prefix>- to avoid collisions with other apps.
 * All colors use Bootstrap CSS variables (var(--bs-*)) for light/dark theme support.
 */
```

---

## Step 3 — Write `main.py`

Every app exposes exactly one function:

```python
def execute(data: dict, conn=None) -> dict:
    ...
```

The runner calls `execute(data)` on the **sync channel** and `execute(data)` (no `conn`) on the **async channel** (subprocess). Declare `conn=None` to opt in to pooled connection injection for free latency reduction on the sync path.

### Database migration

If your app needs its own tables, create them automatically on deploy — **never via a button or action in the UI**. The runner executes module-level code every time it loads or hot-reloads an app, which happens on every deploy. Put your DDL there so the schema is always in place before any request arrives.

```python
import os, logging, psycopg2

log = logging.getLogger(__name__)

def _migrate() -> None:
    """
    Runs idempotent DDL on every app load / hot-reload.
    Called at module level — executes automatically on deploy.
    """
    dsn = os.getenv("DATABASE_URL", "")
    if not dsn:
        log.warning("[<slug>] DATABASE_URL not set — skipping migration")
        return
    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS <slug>_items (
                    id         SERIAL PRIMARY KEY,
                    name       TEXT        NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
        conn.commit()
    log.info("[<slug>] migration ok")

# ── Runs on every deploy / hot-reload ─────────────────────────────────────────
_migrate()
```

**Rules:**

- Every DDL statement must be **idempotent** — use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc. The function runs on every deploy, including re-deploys of the same version.
- **Never** add a `create_table` action to `execute()` or a button to the HTML that calls it. The schema must exist before the first request, not after a user clicks something.
- Table names must be unique across all apps — prefix them with your app slug (e.g. `sales_report_items`, not `items`).
- If migration fails the exception propagates and the runner logs a load error for the app — the old module version stays in service. Fix the DDL and re-deploy.

---

### Action routing

Dispatch on `data["action"]` to support multiple operations from one app:

```python
def execute(data: dict, conn=None) -> dict:
    action = str(data.get("action", "")).strip()

    if action == "list":
        return _list(conn=conn)
    if action == "create":
        return _create(data, conn=conn)
    if action == "run_report":      # long-running → send via async channel
        return _run_report(data)

    return {"message": "ok"}
```

### Sync database access

Use the runner-injected connection when available (zero handshake cost). Fall back to a fresh connection in the async subprocess:

```python
import contextlib, os, psycopg2

@contextlib.contextmanager
def _get_conn(conn=None):
    if conn is not None:
        yield conn
    else:
        with psycopg2.connect(os.getenv("DATABASE_URL")) as own:
            yield own

def _list(conn=None) -> dict:
    with _get_conn(conn) as c:
        with c.cursor() as cur:
            cur.execute("SELECT id, name FROM my_table ORDER BY id DESC")
            rows = cur.fetchall()
    return {"rows": [{"id": r[0], "name": r[1]} for r in rows]}
```

### Async job with progress milestones

Long-running operations run in an isolated `ProcessPoolExecutor` subprocess. Write progress only at 10 % milestones to prevent PostgreSQL MVCC dead-tuple bloat:

```python
import os, time, psycopg2

def _run_report(data: dict) -> dict:
    job_id        = data.get("_job_id", "")   # injected by the runner
    dsn           = os.getenv("DATABASE_URL", "")
    total         = 100
    milestone     = 10
    last_reported = 0

    for i in range(total):
        # --- your heavy compute here ---
        time.sleep(0.1)

        progress = int(((i + 1) / total) * 100)

        if job_id and dsn and progress >= last_reported + milestone:
            last_reported = (progress // milestone) * milestone
            try:
                with psycopg2.connect(dsn) as c:
                    with c.cursor() as cur:
                        cur.execute(
                            "UPDATE noderouter_core.job_queue "
                            "SET progress = %s, updated_at = NOW() WHERE id = %s",
                            (last_reported, job_id),
                        )
                    c.commit()
            except Exception:
                pass    # never crash the job over a progress write

    return {"message": "done", "processed": total}
```

**Rules:**

- No shared state with the daemon — import everything inside `execute()` or module-level.
- Hard timeout: **300 seconds**. Jobs exceeding this are marked `failed` automatically.
- `progress` goes 0 → 99 during work; the runner writes `100` on successful completion.
- Never write progress on every iteration — use fixed milestones (e.g. every 10 %).

---

## Step 4 — Write the Frontend

Three files are served by Go Core as static assets from the app directory:

| File         | Role                                        |
| ------------ | ------------------------------------------- |
| `index.html` | Page structure — Bootstrap layout, no build |
| `index.js`   | Vanilla JS — data hydration, event handlers |
| `style.css`  | Component-scoped styles                     |

**Hard constraints:**

- No build tools (no npm, Webpack, Vite, React, Vue).
- No iframes.
- Bootstrap CSS is served by Go Core at `/static/css/bootstrap.min.css`.
- Use Bootstrap data-attributes (`data-bs-toggle`, `data-bs-target`) for Modals, Dropdowns, Tabs — do not write custom JS wrappers for basic UI controls.
- Use the [available vendor libraries](#available-frontend-libraries) for charts, grids, Excel export, CSV parsing, dates, and icons. **Never point a `<script>` at an external CDN** — the platform has no internet access.

---

### Using ECharts (charts)

Add `<script src="/assets/vendor/echarts.min.js"></script>` in `index.html` before `index.js`.

```js
(function () {
  "use strict";
  var root = document.querySelector(".nr-app") || document.body;

  // ECharts needs a sized container div in your HTML:
  //   <div id="<prefix>-chart" style="height:320px"></div>
  var chart = echarts.init(root.querySelector("#<prefix>-chart"), null, {
    renderer: "canvas",
  });

  function renderChart(rows) {
    chart.setOption({
      tooltip: { trigger: "axis" },
      xAxis:   { type: "category", data: rows.map(function (r) { return r.label; }) },
      yAxis:   { type: "value" },
      series:  [{ type: "bar", data: rows.map(function (r) { return r.value; }) }],
    });
  }

  // Re-fit chart when the sidebar collapses / window resizes.
  window.addEventListener("resize", function () { chart.resize(); });
})();
```

---

### Using Tabulator (data grid)

Add both the CSS link and the JS script to `index.html`:

```html
<link rel="stylesheet" href="/assets/vendor/tabulator.min.css" />
…
<script src="/assets/vendor/tabulator.min.js"></script>
```

```js
(function () {
  "use strict";
  var root = document.querySelector(".nr-app") || document.body;

  // Container: <div id="<prefix>-grid"></div>
  var table = new Tabulator(root.querySelector("#<prefix>-grid"), {
    layout:        "fitColumns",
    responsiveLayout: "collapse",
    pagination:    "local",
    paginationSize: 20,
    columns: [
      { title: "ID",   field: "id",   width: 80  },
      { title: "Name", field: "name", widthGrow: 1 },
      { title: "Date", field: "created_at" },
    ],
  });

  function loadData(rows) { table.setData(rows); }
})();
```

---

### Using SheetJS (Excel export)

Add `<script src="/assets/vendor/xlsx.full.min.js"></script>` in `index.html`.

```js
(function () {
  "use strict";

  function exportToExcel(rows, filename) {
    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, (filename || "export") + ".xlsx");
  }

  // Wire to a button: <button data-action="export-excel">Export</button>
  var root = document.querySelector(".nr-app") || document.body;
  root.addEventListener("click", function (e) {
    if (e.target.dataset.action === "export-excel") {
      exportToExcel(currentRows, "<slug>-report");
    }
  });
})();
```

---

### Using PapaParse (CSV parsing)

Add `<script src="/assets/vendor/papaparse.min.js"></script>` in `index.html`.

```js
(function () {
  "use strict";
  var root = document.querySelector(".nr-app") || document.body;

  // File input: <input type="file" id="<prefix>-csv-input" accept=".csv" />
  root.querySelector("#<prefix>-csv-input").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header:        true,
      skipEmptyLines: true,
      complete: function (result) {
        // result.data is an array of row objects keyed by header name.
        console.log(result.data);
      },
      error: function (err) {
        console.error("CSV parse error:", err.message);
      },
    });
  });
})();
```

---

### Using Day.js (date formatting)

Add `<script src="/assets/vendor/dayjs.min.js"></script>` in `index.html`.

```js
(function () {
  "use strict";

  // Format an ISO timestamp from the server into a readable local string.
  function fmtDate(iso) {
    return dayjs(iso).format("DD/MM/YYYY HH:mm");
  }

  // Example: age in days
  function daysAgo(iso) {
    return dayjs().diff(dayjs(iso), "day");
  }
})();
```

---

### Using Lucide Icons

Add `<script src="/assets/vendor/lucide.min.js"></script>` in `index.html`, then call `lucide.createIcons()` once after the DOM is ready.

```html
<!-- Place the attribute on any element whose icon you want to replace. -->
<i data-lucide="download"></i>
<i data-lucide="refresh-cw"></i>
<i data-lucide="alert-triangle"></i>
```

```js
(function () {
  "use strict";

  // Replace all data-lucide placeholders in the page with inline SVGs.
  // Call after your HTML is rendered (or after dynamic content is injected).
  lucide.createIcons();

  // If you inject new HTML after the initial render, call it again:
  function renderRows(rows) {
    var root = document.querySelector(".nr-app") || document.body;
    root.querySelector("#<prefix>-list").innerHTML = rows
      .map(function (r) { return '<li><i data-lucide="circle-dot"></i> ' + esc(r.name) + "</li>"; })
      .join("");
    lucide.createIcons(); // re-scan for new icons
  }
})();
```

---

### Calling the sync channel from the frontend

```js
async function syncCall(action, payload = {}) {
  const res = await fetch("/api/sync/app_<your_name>", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
```

### Submitting an async job from the frontend

```js
async function asyncCall(action, payload = {}) {
  const res = await fetch("/api/async/app_<your_name>", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data; // { job_id, status: "pending", node: "..." }
}
```

### Polling job progress

```js
async function pollJob(jobId, onProgress) {
  while (true) {
    const res = await fetch(`/api/async/jobs/${jobId}`);
    const job = await res.json();
    onProgress(job.progress, job.status);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
```

---

## Step 5 — Local Dependencies (`libs/`)

If your app needs a package not already in the runner environment (`psycopg2`, `requests`, `flask`), install it into `libs/`:

```powershell
pip install <package> --target app_<your_name>/libs
```

Then inject the path at the top of `main.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "libs"))
import my_package
```

---

## Step 6 — Test Locally (runner running)

```powershell
# Default action
curl -s -X POST http://localhost:8000/api/sync/app_<your_name> `
     -H "Content-Type: application/json" `
     -d '{}'

# Named action
curl -s -X POST http://localhost:8000/api/sync/app_<your_name> `
     -H "Content-Type: application/json" `
     -d '{"action":"list"}'

# Trigger an async job
curl -s -X POST http://localhost:8000/api/async/app_<your_name> `
     -H "Content-Type: application/json" `
     -d '{"action":"run_report"}'
```

> In development (`RUNNER_SECRET` not set), requests to the runner are accepted without HMAC headers. In production, always route through Go Core — it stamps every request with the correct signature.

> If your app sets `required_permission`, Go Core returns `403 {"error": "insufficient permissions: <slug> required"}` when the JWT caller's role does not hold that permission. Test with a token that carries the role before deploying to production.

---

## Step 7 — Package and Deploy

### Pack

```powershell
Compress-Archive -Path app_<your_name>\\* -DestinationPath app_<your_name>.zip
```

### Deploy via Go Core admin UI

1. Open `/admin/apps` → **Deploy Bundle** → upload `app_<your_name>.zip`.
2. Go Core extracts to `{APPS_DIR}/app_<your_name>/` and fires `NOTIFY app_updated, 'app_<your_name>'`.
3. The runner hot-reloads the module atomically — no restart needed.

### Deploy via API

```bash
curl -X POST http://localhost:3000/admin/api/nodes/deploy \\
     -H "Authorization: Bearer <jwt>" \\
     -F "file=@app_<your_name>.zip"
```

### Manual hot-reload (dev)

```powershell
curl -s -X POST http://localhost:8000/api/reload/app_<your_name>
```

---

## Checklist

- [ ] Directory name matches `app_name` in `manifest.json`
- [ ] `execute(data, conn=None)` is defined in `main.py`
- [ ] `required_permission` set in `manifest.json` if the app should be restricted, or omitted for open access
- [ ] If `required_permission` is set, the target RBAC permission slug exists and is assigned to the relevant roles
- [ ] Async jobs use `data["_job_id"]` for progress writes
- [ ] Progress writes batched at 10 % milestones (no per-iteration writes)
- [ ] DB connections opened with `with psycopg2.connect(...) as conn:` — never left open
- [ ] Frontend calls go to `/api/sync/<app_name>` or `/api/async/<app_name>` — not directly to the runner port
- [ ] Frontend handles `403` responses from the sync/async endpoints (permission denied)
- [ ] No build tools, no iframes in the frontend
- [ ] Local deps placed under `libs/` and injected via `sys.path.insert`
- [ ] Vendor libraries loaded from `/assets/vendor/*` — no external CDN URLs anywhere in the app
- [ ] Only the vendor libraries actually used are included (no unused `<script>` tags)
- [ ] `lucide.createIcons()` called after each dynamic HTML render (if Lucide is used)
- [ ] Tabulator CSS (`/assets/vendor/tabulator.min.css`) included in `<head>` when Tabulator grid is used