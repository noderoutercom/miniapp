# Technical Design Document: Item Category Master

The Item Category Master is a standalone reference data management module that allows users to define, organise, and maintain the hierarchical classification tree used by the Item Master. Categories support a single-level parent–child hierarchy (e.g., **Electronics → Semiconductors**), giving manufacturing teams full control over how materials are classified.

---

## 1. Domain Model

```
+------------------------------+
|       ItemCategory           |  ← Aggregate Root
+------------------------------+
| id          UUID  PK         |
| category_code  VARCHAR(20)   |
| name           VARCHAR(100)  |
| parent_id      UUID FK→self  |
+------------------------------+
          ▲ 0..1 (parent)
          |
          | 0..* (children)
+------------------------------+
|       ItemCategory           |  ← Sub-Category
+------------------------------+
```

### Relationship to Other Modules

| Module | Relationship |
| --- | --- |
| `item_master` | `items.category_id` → FK to `item_category.item_categories.id` |
| Future MES modules | Any module needing item classification can join `item_category.item_categories` |

### Business Rules

* A category **cannot reference itself** as its own parent.
* A category **cannot be deleted** while it has child categories.
* A category **cannot be deleted** while any Item Master record is assigned to it.
* `category_code` is globally unique and immutable after use in production items.

---

## 2. Database Design

Categories reside in their own dedicated `item_category` schema.

### `item_category.item_categories`

| Column | Data Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY DEFAULT gen_random_uuid() | Unique identifier |
| `category_code` | VARCHAR(20) | UNIQUE, NOT NULL | Uppercase alphanumeric code (e.g., `ELEC`, `SEMI`) |
| `name` | VARCHAR(100) | NOT NULL | Human-readable full name |
| `parent_id` | UUID | FK → self, NULLABLE | NULL = top-level; set to parent UUID for sub-categories |

### Seed Data (installed on first deploy)

| Code | Name | Parent |
| --- | --- | --- |
| `RAW` | Raw Materials | — |
| `ELEC` | Electronics | — |
| `MECH` | Mechanical Parts | — |
| `CHEM` | Chemicals | — |
| `PKG` | Packaging | — |
| `FG` | Finished Goods | — |

---

## 3. Actions & API Specifications

All actions are invoked via `POST /api/sync/item_category` with `{ "action": "<name>", "params": { … } }`.

### `list_categories`

Paginated, searchable list of all categories. Returns `child_count` per row.

**Params:** `search` (nullable text), `page_size` (integer), `offset` (integer)

**Response row:**
```json
{
  "id": "uuid",
  "category_code": "ELEC",
  "name": "Electronics",
  "parent_id": null,
  "parent_name": null,
  "child_count": 2
}
```

### `count_categories`

Returns the total row count matching the current `search` filter (used for pagination).

**Params:** `search` (nullable text)

### `get_category`

Fetch a single category by UUID, including resolved `parent_name`.

**Params:** `id` (uuid)

### `list_parent_options`

Returns all categories **excluding** the specified `exclude_id` (the category being edited, to prevent self-referencing). Used to populate the Parent dropdown in the form.

**Params:** `exclude_id` (nullable text)

### `insert_category`

Creates a new category record.

**Request Body:**
```json
{
  "action": "insert_category",
  "params": {
    "category_code": "SEMI",
    "name": "Semiconductors",
    "parent_id": "4a7b9c32-1122-3344-5566-778899aabbcc"
  }
}
```

**Success Response:**
```json
{ "data": { "id": "...", "category_code": "SEMI", "name": "Semiconductors" } }
```

### `update_category`

Updates `category_code`, `name`, and `parent_id` for an existing category.

**Guards (Python layer):**
* Validates `parent_id ≠ id` (prevents self-reference).

**Params:** `id` (uuid), `category_code`, `name`, `parent_id` (nullable text)

### `delete_category`

Hard-deletes a category.

**Guards (Python layer, in order):**
1. Check `child_count > 0` → raise `ValueError("Cannot delete: category has sub-categories. Remove them first.")`
2. Check `item_count > 0` (items assigned) → raise `ValueError("Cannot delete: items are assigned to this category. Reassign them first.")`
3. Execute DELETE — database FK constraint provides a final safety net.

---

## 4. UI/UX Design

All CSS classes and element IDs are prefixed with `ic-` to avoid collisions with other miniapps.

### 4.1 List Screen (Data Grid Layout)

```
+------------------------------------------------------------------------+
|  Item Category Master                         [+ New Category]         |
+------------------------------------------------------------------------+
|  [ Search code or name…                       ] [Search] [↺ Refresh]  |
+------------------------------------------------------------------------+
|  Code   | Name               | Parent          | Sub-cats | Actions   |
|---------|--------------------|-----------------|---------:| --------- |
|  RAW    | Raw Materials      | —               |        0 | [Edit][✕] |
|  ELEC   | Electronics        | —               |        2 | [Edit][✕] |
|  SEMI   | Semiconductors     | Electronics     |        0 | [Edit][✕] |
+------------------------------------------------------------------------+
|  Page 1 of 1 (3 categories)                    [‹ Prev]   [Next ›]   |
+------------------------------------------------------------------------+
```

### 4.2 Create / Edit Form

```
+------------------------------------------------------------------------+
| ← Back  |  New Category / Edit Category           [Save]  [Cancel]    |
+------------------------------------------------------------------------+
|                                                                        |
|  * Category Code:                  * Category Name:                   |
|  [ SEMI                 ]          [ Semiconductors                  ]|
|  Uppercase A–Z, 0–9, _  Max 20.    Max 100 chars.                     |
|                                                                        |
|  Parent Category (optional):                                           |
|  [ Electronics                  ▼ ]                                   |
|  Leave blank to create a top-level category.                          |
|                                                                        |
+------------------------------------------------------------------------+
```

### 4.3 Validation Rules

| Field | Rule | Trigger |
| --- | --- | --- |
| Category Code | `^[A-Z0-9_]{1,20}$` — normalised to uppercase on blur | `onBlur` |
| Name | Required, max 100 chars | `onSave` |
| Parent | Cannot equal self; optional | `onSave` |

### 4.4 Delete Guard

Before sending a delete request, the UI shows a confirmation modal. If the server returns an error (children exist or items assigned), a toast notification is displayed with the exact reason. The row is **not** removed from the grid unless the server confirms success.

### 4.5 Status / Feedback

* All async operations (load, save, delete) show a spinner or toast.
* Toast types: `success` (green), `error` (red), `warning` (amber), `info` (blue).
* Uses `AdminWS.showToast()` from the host shell when available.

---

## 5. File Structure

```
apps_source/item_category/
├── manifest.json             ← DB schema, seed data, SQL actions
├── main.py                   ← Entry point: routes actions → service handlers
├── index.html                ← Single-page shell
├── css/
│   └── style.css             ← All styles prefixed ic-
├── js/
│   ├── api.js                ← sync() wrapper targeting item_category
│   ├── router.js             ← Hash-based screen router
│   ├── app.js                ← Boot: register screens
│   └── components/
│       ├── dashboard.html    ← List screen markup
│       ├── dashboard.js      ← List screen logic
│       ├── form.html         ← Create/edit form markup
│       └── form.js           ← Create/edit form logic
└── services/
    ├── helpers.py            ← run / run_one / require utilities
    └── categories.py         ← All category business logic handlers
```

---

## 6. Dependencies & Deployment Notes

* **Shared schema:** `item_master` schema is created with `CREATE SCHEMA IF NOT EXISTS`, so `item_category` can be deployed independently.
* **Deployment order (recommended):** `item_category` first, then `item_master` — or both simultaneously. Both use `IF NOT EXISTS` DDL.
* **item_master integration:** After deploying `item_category`, the `item_master` app continues to call its own `list_categories` action (which reads the same table). No changes to `item_master` are required.
