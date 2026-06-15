# Technical Design Document: Item Master Feature (Manufacturing ERP/MES)

The Item Master is the core foundation of a Manufacturing Execution System (MES) or Enterprise Resource Planning (ERP) system. It serves as the single source of truth for all items, including raw materials, work-in-progress (WIP), finished goods, and packaging materials.

---

## 1. Domain Model

The domain model follows Domain-Driven Design (DDD) principles. `Item` acts as the **Aggregate Root**.

```
                           +-------------------+
                           |   ItemCategory    |
                           +-------------------+
                                     | 1
                                     |
                                     | *
+-------------------+      * +---------------+ * +-------------------+
|   UnitOfMeasure   |--------|     Item      |--------|   ItemSupplier    |
+-------------------+        +---------------+        +-------------------+
                               | 1       1 |
            +------------------+           +------------------+
            |                                                 |
            v 1                                               v 1
+-------------------+                               +-------------------+
|   ItemPlanning    |                               |    ItemCosting    |
+-------------------+                               +-------------------+

```

### Entities & Value Objects

* **Item (Aggregate Root):** Defines the core identity, code, type, and operational status of a material.
* **UnitOfMeasure (Reference Entity):** Standardized units (e.g., kg, pcs, liters) with conversion factors.
* **ItemCategory (Reference Entity):** Hierarchical classification (e.g., Electronics -> Semiconductors).
* **ItemPlanning (Value Object / Child Entity):** Contains material requirements planning (MRP) data like lead times and safety stock levels.
* **ItemCosting (Value Object / Child Entity):** Financial data tracking standard and moving average costs.
* **ItemSupplier (Association Entity):** Manages the many-to-many relationship between items and approved vendors, including vendor-specific part numbers.

### Core Enums

* **ItemType:** `RAW_MATERIAL`, `WORK_IN_PROGRESS`, `FINISHED_GOOD`, `PACKAGING`, `CONSUMABLE`.
* **ItemStatus:** `DRAFT`, `ACTIVE`, `PHASE_OUT`, `OBSOLETE`.
* **CostingMethod:** `FIFO`, `LIFO`, `STANDARD`, `MOVING_AVERAGE`.

---

## 2. Database Design

A relational schema optimized for high read performance, transactional integrity, and comprehensive auditing.

### `unit_of_measures`

| Column Name | Data Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `uom_code` | VARCHAR(10) | UNIQUE, NOT NULL | Standard code (e.g., KG, LTR, PCS) |
| `name` | VARCHAR(50) | NOT NULL | Readable name |
| `is_base` | BOOLEAN | DEFAULT FALSE | Is it a base unit for conversions? |

### `item_categories`

| Column Name | Data Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `category_code` | VARCHAR(20) | UNIQUE, NOT NULL | Unique category code |
| `name` | VARCHAR(100) | NOT NULL | Category name |
| `parent_id` | UUID | FOREIGN KEY | Self-referencing link for hierarchy |

### `items`

| Column Name | Data Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `item_code` | VARCHAR(50) | UNIQUE, NOT NULL | SKU / Internal Part Number |
| `name` | VARCHAR(255) | NOT NULL | Item name |
| `description` | TEXT | NULL | Detailed technical description |
| `item_type` | VARCHAR(30) | NOT NULL | RAW_MATERIAL, FINISHED_GOOD, etc. |
| `status` | VARCHAR(20) | NOT NULL DEFAULT 'DRAFT' | DRAFT, ACTIVE, OBSOLETE, etc. |
| `category_id` | UUID | FOREIGN KEY, NOT NULL | Link to `item_categories` |
| `base_uom_id` | UUID | FOREIGN KEY, NOT NULL | Link to `unit_of_measures` |
| `is_lot_tracked` | BOOLEAN | DEFAULT FALSE | Enables traceability for expiration/batches |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | Audit trail |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT NOW() | Audit trail |
| `version` | INT | NOT NULL DEFAULT 1 | Optimistic locking counter |

### `item_planning`

| Column Name | Data Type | Constraints | Description |
| --- | --- | --- | --- |
| `item_id` | UUID | PRIMARY KEY, FOREIGN KEY | 1:1 relationship with `items` |
| `safety_stock` | NUMERIC(12,4) | DEFAULT 0.0000 | Minimum threshold before reorder |
| `reorder_point` | NUMERIC(12,4) | DEFAULT 0.0000 | Stock level that triggers order |
| `lead_time_days` | INT | DEFAULT 0 | Days required to receive item |
| `min_order_qty` | NUMERIC(12,4) | DEFAULT 1.0000 | Minimum order constraints |

### `item_costing`

| Column Name | Data Type | Constraints | Description |
| --- | --- | --- | --- |
| `item_id` | UUID | PRIMARY KEY, FOREIGN KEY | 1:1 relationship with `items` |
| `costing_method` | VARCHAR(20) | NOT NULL | STANDARD, MOVING_AVERAGE |
| `standard_cost` | NUMERIC(15,4) | DEFAULT 0.0000 | Fixed standard accounting cost |
| `avg_cost` | NUMERIC(15,4) | DEFAULT 0.0000 | Dynamic moving average cost |
| `currency` | VARCHAR(3) | DEFAULT 'USD' | Currency code |

### Database Indexes

```sql
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_type ON items(item_type);
CREATE TEXT SEARCH INDEX idx_items_search ON items(item_code, name);

```

---

## 3. Actions & API Specifications

### Create Item

* **Description:** Creates a new item master record in `DRAFT` or `ACTIVE` status.

#### Request Body

```json
{
  "itemCode": "MAT-STEEL-001",
  "name": "Stainless Steel Plate 10mm",
  "description": "Grade 316 stainless steel plate, 10mm thickness",
  "itemType": "RAW_MATERIAL",
  "categoryId": "4a7b9c32-1122-3344-5566-778899aabbcc",
  "baseUomId": "1f2e3d4c-5566-7788-99aa-bbccddeeff00",
  "isLotTracked": true,
  "planning": {
    "safetyStock": 50.00,
    "reorderPoint": 150.00,
    "leadTimeDays": 14,
    "minOrderQty": 10.00
  },
  "costing": {
    "costingMethod": "STANDARD",
    "standardCost": 120.50,
    "currency": "USD"
  }
}

```

#### Success Response (`201 Created`)

```json
{
  "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "itemCode": "MAT-STEEL-001",
  "status": "DRAFT",
  "version": 1,
  "createdAt": "2026-06-15T02:40:00Z"
}

```

### Update Item

* **Description:** Updates an existing item. Utilizes optimistic locking (`version`) to prevent concurrent overwrite issues.

### Change Item Status

* **Description:** Transition item lifecycle states (e.g., activating a draft, or marking a part as obsolete).

#### Request Body

```json
{
  "status": "ACTIVE",
  "reason": "Initial engineering release sign-off"
}

```

### List / Filter Items

* **Query Parameters:** `page`, `size`, `search`, `itemType`, `status`, `categoryId`

---

## 4. UI/UX Design (Production Grade)

The UI follows a clean, highly functional, enterprise-grade layouts engineered for data-dense manufacturing configurations.

### 4.1. List & View Workspace (Data Grid Layout)

The main workspace features a top utility action bar, an advanced multi-parameter filter panel, and a server-side paginated data grid.


### 4.2. Create / Edit Layout (Tabbed Form Configuration)

To manage data density without overwhelming the user, fields are separated into distinct domain-specific tabs.

```
+--------------------------------------------------------------------------------------------------+
| Back to List | New Item Setup                                                    [Save] [Cancel] |
+--------------------------------------------------------------------------------------------------+
|  (X) General Info   ( ) Logistics & Planning   ( ) Costing & Financials   ( ) Quality & Controls |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|  * Item Code:                         * Item Name:                                               |
|  [ MAT-STEEL-001                ]     [ Stainless Steel Plate 10mm                             ] |
|                                                                                                  |
|  * Item Type:                         * Category:                                                |
|  [ RAW_MATERIAL               v ]     [ Metals > Ferrous Alloys                              v ] |
|                                                                                                  |
|  * Base Unit of Measure (UOM):          Description:                                             |
|  [ KG                         v ]     [ Grade 316 stainless steel plate, 10mm thickness        ] |
|                                       [                                                        ] |
|                                                                                                  |
|  Inventory Controls:                                                                             |
|  [X] Enable Lot/Batch Control (Required for raw material traceability)                           |
|  [ ] Serial Number Profile Tracked                                                               |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+

```

### 4.3. UI Verification Rules

* **Inline Validation:** `Item Code` must not contain spaces or special characters except hyphens and underscores. Max length 50 characters. Checked via `onBlur` async uniqueness API rule.
* **Status Indicators:** Visually distinguished by semantic color tags:
* `ACTIVE`: Green badge
* `DRAFT`: Gray badge
* `PHASE_OUT`: Amber/Orange badge
* `OBSOLETE`: Red badge


* **Dirty State Guard:** A confirmation modal prompts the user if they attempt to navigate away from the form with unsaved changes.