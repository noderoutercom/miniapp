# Functional Requirements & Database Schema Design
## Module: Material Master Data Management

This document outlines the complete functional requirements and matching relational database schema design for the **Material Master Data Management** module. This module forms the foundational data layer for tracking, configuring, and maintaining the master register of all inventory items handled by the system.

---

## 1. Functional Requirements

### 1.1 SKU & Material Definition
* **Unique Identifier Enforcement:** The system must enforce a unique alphanumeric code (SKU/Part Number) per material record. It supports both manual user entry and automated system generation using the selected category's code as a prefix (e.g. `RM-POLY-839201`). Real-time duplicate checking fires 400 ms after the user stops typing and displays inline feedback before the form is submitted.
* **Lifecycle Status Engine:** Materials transition through an explicit lifecycle:
  * `DRAFT` → `ACTIVE` → `DEPRECATED` → `INACTIVE`
  * `DRAFT`: Under configuration; cannot be referenced in warehouse or purchasing transactions.
  * `ACTIVE`: Full transactional availability across all modules.
  * `DEPRECATED`: Blocks new purchase orders or procurement receipts; allows consumption of remaining on-hand stock.
  * `INACTIVE`: Freezes the material entirely — no physical movements, updates, or transaction logging.
* **Flexible Attribute Extensions:** Dynamic key-value pairs stored in a `JSONB` column (`attributes`) allow category-specific custom properties (e.g. dimensions, chemical composition, weight thresholds) without schema changes. The edit form renders these as an inline add/remove panel.

### 1.2 Unit of Measure (UoM) Management
* **Base UoM Isolation:** Every material is assigned exactly one Base UoM upon creation. It is the absolute unit for all ledger balances, cycle counts, and valuations. In edit mode the Base UoM selector is disabled (locked read-only) to prevent ledger corruption.
* **Alternative UoM Conversions:** Multiple alternative UoMs may be defined per material via a dynamic inline grid (alt UoM + conversion factor). Formula: `Quantity in Base UoM = Quantity in Alt UoM × conversion_factor`. Precision: `NUMERIC(12,4)`.
* **Fractional vs. Integer Guardrails:** The `allow_fractional` flag on the UoM record signals whether decimal quantities are valid for that unit. Enforced at the transaction layer by consuming modules.

### 1.3 Batch/Lot & Serial Tracking Profiles
* **Traceability Policy Assignment:** Every material carries an explicit tracking profile: `NONE`, `BATCH`, `SERIAL`, or `BOTH`.
* **Enforced Data Capture:** If a profile requires `BATCH` or `SERIAL`, downstream transaction modules must reject movements that omit the corresponding tracking numbers.
* **Shelf-Life Integration:** For `BATCH`-tracked materials, manufacturing date, goods receipt date, and expiration date fields support FEFO (First Expired, First Out) rotation in the warehouse layer.

---

## 2. Database Schema

> All tables are prefixed `mm_` to avoid collisions with other apps in the shared PostgreSQL schema.
> Migration runs automatically on every app deploy via module-level `_migrate()`.

### 2.1 Entity Relationship Layout

```
   [mm_material_categories] ◄───┐ (self-referencing parent_id)
              │
              ▼
         [mm_materials] ◄──────── [mm_uoms]
              │                       │
              ▼                       ▼
  [mm_material_uom_conversions] ──────┘
```

### 2.2 Table Definitions

#### `mm_uoms`
Global dictionary of valid units of measure.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, `gen_random_uuid()` | |
| `code` | VARCHAR(10) | UNIQUE NOT NULL | e.g. `KG`, `PCS`, `BOX` |
| `name` | VARCHAR(50) | NOT NULL | e.g. `Kilogram`, `Piece` |
| `allow_fractional` | BOOLEAN | NOT NULL, default `FALSE` | Decimal guard flag |

Seeded on first deploy with: `PCS`, `KG`, `G`, `L`, `M`, `BOX`, `PALL`, `SET`.

#### `mm_material_categories`
Hierarchical tree for classifying items and driving SKU prefix auto-generation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, `gen_random_uuid()` | |
| `parent_id` | UUID | FK → `mm_material_categories(id)`, nullable | Self-reference for nesting |
| `code` | VARCHAR(20) | UNIQUE NOT NULL | e.g. `RM-POLY` |
| `name` | VARCHAR(100) | NOT NULL | |

#### `mm_materials`
Primary master ledger — one row per unique SKU.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, `gen_random_uuid()` | |
| `sku_code` | VARCHAR(50) | UNIQUE NOT NULL | |
| `name` | VARCHAR(150) | NOT NULL | |
| `description` | TEXT | nullable | |
| `category_id` | UUID | FK → `mm_material_categories(id)` NOT NULL | |
| `base_uom_id` | UUID | FK → `mm_uoms(id)` NOT NULL | Immutable after stock exists |
| `status` | VARCHAR(20) | NOT NULL, CHECK IN (`DRAFT`,`ACTIVE`,`DEPRECATED`,`INACTIVE`) | |
| `tracking_profile` | VARCHAR(20) | NOT NULL, CHECK IN (`NONE`,`BATCH`,`SERIAL`,`BOTH`) | |
| `attributes` | JSONB | NOT NULL, default `'{}'` | Free-form key-value properties |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Updated on every write |

#### `mm_material_uom_conversions`
High-precision conversion factors for alternative transaction units.

`Qty in Base UoM = Qty in Alt UoM × conversion_factor`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, `gen_random_uuid()` | |
| `material_id` | UUID | FK → `mm_materials(id)` NOT NULL, ON DELETE CASCADE | |
| `alt_uom_id` | UUID | FK → `mm_uoms(id)` NOT NULL | |
| `conversion_factor` | NUMERIC(12,4) | NOT NULL | |
| — | — | UNIQUE (`material_id`, `alt_uom_id`) | One factor per alt UoM per material |

---

## 3. Backend API (`main.py`)

Single `execute(data, conn=None)` entry point. All responses pass through `_clean()` to convert `uuid.UUID`, `datetime`, and `Decimal` to JSON-safe types before the runner serializes the response.

| `action` | Description |
|---|---|
| `list_materials` | Paginated, filtered, sorted list. Params: `search`, `statuses[]`, `categories[]` (UUID array, cast to `uuid[]`), `page`, `per_page`, `sort`, `dir` |
| `get_material` | Full material record including conversions array |
| `create_material` | Insert material + conversions in one transaction |
| `update_material` | Partial update; replaces conversions array atomically |
| `delete_material` | Hard delete |
| `check_sku` | Real-time duplicate check; supports `exclude_id` for edit mode |
| `list_uoms` | All UoM records ordered by code |
| `create_uom` / `update_uom` / `delete_uom` | CRUD for global UoM catalog |
| `list_categories` | All categories with `parent_name` joined |
| `create_category` / `update_category` / `delete_category` | CRUD for category tree |
| `save_conversions` | Replace full conversions set for a material |

**SQL type cast note:** Array filters use explicit casts (`%s::varchar[]`, `%s::uuid[]`) to avoid the `operator does not exist: uuid = text` Postgres error when passing Python string lists via psycopg2.

---

## 4. Frontend Screens

### Screen 1 — Material Master List

**Control bar (left to right):**
- Text search box — matches `sku_code` or `name` (ILIKE); triggers on Enter key
- **Status** dropdown button — Bootstrap dropdown with checkbox items (`DRAFT`, `ACTIVE`, `DEPRECATED`, `INACTIVE`); shows a count badge when any are selected; uses `data-bs-auto-close="outside"` to stay open while checking
- **Category** dropdown button — same pattern, populated dynamically from `list_categories`; scrollable list (max-height 260 px)
- **Filter** button (primary) — sends checked values to `list_materials`
- **Reset** button (outline) — clears all checkboxes and the search field, reloads

**Data grid:** Standard Bootstrap `table table-hover table-bordered`. Columns: SKU/Part #, Material Name, Category, Base UoM, Tracking, Status (color-coded badge), Last Modified. Column headers with `data-col` attribute are clickable for sort (asc/desc toggle, icon updates via Lucide).

Status badge colors: `DRAFT` → `bg-secondary`, `ACTIVE` → `bg-success`, `DEPRECATED` → `bg-warning`, `INACTIVE` → `bg-danger`.

**Pagination footer:** Rows-per-page selector (25 / 50 / 100), page info label, prev/next buttons.

Whole-row click navigates to Screen 3 (Detail).

---

### Screen 2 — Material Creation / Edit Form

Breadcrumb navigation. Sticky Save Changes + Cancel buttons in the header row.

**Section 1 — Core Identification:**
- SKU input with inline "Auto" checkbox — when checked, generates `{category.code}-{timestamp_suffix}` and locks the field read-only
- Real-time SKU duplicate check (400 ms debounce) with inline ✓/✗ feedback
- Material Name (required)
- Description textarea

**Section 2 — Governance & Control:**
- Category selector (flat list of `code – name`)
- Base UoM selector — disabled in edit mode
- Lifecycle Status dropdown
- Tracking Profile dropdown

**Section 3 — Alternative Unit Conversions:**
- Dynamic inline table; Add Row / Remove Row per entry
- Each row: Alt UoM selector + Conversion Factor numeric input

**Section 4 — Custom Attributes:**
- Inline key-value editor; Add / Remove rows
- Values saved to `attributes` JSONB column

---

### Screen 3 — Material Detail View (Read-Only)

Profile header card: material name, SKU code, status badge, Edit Profile button.

Three-tab layout:
- **Specifications** — key-value card grid (all core fields + JSONB attribute keys)
- **UoM Rules Matrix** — table of alt UoM conversions with formula column
- **Change Log** — vertical timeline showing `created_at` and `updated_at` timestamps (audit trail placeholder; full per-field history requires a dedicated audit table)

---

### Screen 4 — Auxiliary Configuration Overlays

**Overlay A — UoM Manager (centered modal):**
Inline list of existing UoMs (code, name, fractional flag) with Edit / Delete buttons. Inline add/edit form below: Code (max 10), Name, Allow Fractional checkbox.

**Overlay B — Category Tree Editor (right offcanvas drawer):**
Inline table of all categories with parent reference. Add/edit form: Code (max 20), Name, Parent Category selector (self-referencing, excludes the record being edited).

Both overlays refresh their lists immediately after a save and push updated data to all dependent selectors in the main form and filter bar.
