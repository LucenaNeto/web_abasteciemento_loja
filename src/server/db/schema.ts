// src/server/db/schema.ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* =======================
 * Enums tipados (TS)
 * =======================*/
export const userRoles = ["admin", "store", "warehouse"] as const;
export type UserRole = (typeof userRoles)[number];

export const requestStatus = ["pending", "in_progress", "completed", "cancelled"] as const;
export type RequestStatus = (typeof requestStatus)[number];

export const itemStatus = ["pending", "partial", "delivered", "cancelled"] as const;
export type ItemStatus = (typeof itemStatus)[number];

export const criticalityLevels = ["cashier", "service", "restock"] as const;
export type CriticalityLevel = (typeof criticalityLevels)[number];

export const movementTypes = ["in", "out", "adjust"] as const;
export type MovementType = (typeof movementTypes)[number];

/* =========================
 * Users
 * =======================*/
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: userRoles }).notNull().$type<UserRole>(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index("idx_users_email").on(table.email),
    roleIdx: index("idx_users_role").on(table.role),
  }),
);

/* =========================
 * Units (UNIDADES)  ✅ antes de products/requests
 * =======================*/
export const units = pgTable(
  "units",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(), // ex: 24603
    name: text("name").notNull(), // ex: VD Garanhuns
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUq: uniqueIndex("units_code_uq").on(t.code),
  }),
);

/* =========================
 * Products ✅ unitId obrigatório
 * =======================*/
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),

    sku: text("sku").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("UN"),
    isActive: boolean("is_active").notNull().default(true),
    stock: integer("stock").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => ({
    unitSkuUq: uniqueIndex("products_unit_sku_uq").on(t.unitId, t.sku),
  }),
);

/* =========================
 * User Units (vínculo usuário ↔ unidade)
 * =======================*/
export const userUnits = pgTable(
  "user_units",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),

    isPrimary: boolean("is_primary").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.unitId] }),
  }),
);

/* =========================
 * Requests (Requisições) ✅ unitId obrigatório
 * =======================*/
export const requests = pgTable(
  "requests",
  {
    id: serial("id").primaryKey(),

    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),

    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),

    assignedToUserId: integer("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    status: text("status", { enum: requestStatus })
      .notNull()
      .default("pending")
      .$type<RequestStatus>(),

    criticality: text("criticality", { enum: criticalityLevels })
      .notNull()
      .default("restock")
      .$type<CriticalityLevel>(),

    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    unitIdx: index("idx_requests_unit").on(table.unitId),
    statusIdx: index("idx_requests_status").on(table.status),
    createdByIdx: index("idx_requests_created_by").on(table.createdByUserId),
    assignedIdx: index("idx_requests_assigned_to").on(table.assignedToUserId),
    createdAtIdx: index("idx_requests_created_at").on(table.createdAt),
  }),
);

/* =========================
 * Request Items
 * =======================*/
export const requestItems = pgTable(
  "request_items",
  {
    id: serial("id").primaryKey(),

    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade", onUpdate: "cascade" }),

    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict", onUpdate: "cascade" }),

    requestedQty: integer("requested_qty").notNull(),
    deliveredQty: integer("delivered_qty").notNull().default(0),

    status: text("status", { enum: itemStatus })
      .notNull()
      .default("pending")
      .$type<ItemStatus>(),

    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    reqIdx: index("idx_request_items_request").on(table.requestId),
    prodIdx: index("idx_request_items_product").on(table.productId),
  }),
);

/* =========================
 * Inventory Movements
 * =======================*/
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: serial("id").primaryKey(),

    productId: integer("product_id")
      .notNull()
      .references(() => products.id),

    qty: integer("qty").notNull(), // sempre POSITIVO
    type: text("type", { enum: movementTypes }).notNull().$type<MovementType>(),

    refType: text("ref_type"),
    refId: integer("ref_id"),
    requestItemId: integer("request_item_id"),

    note: text("note"),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    imProductIdx: index("idx_im_product").on(table.productId),
    imReqItemUnique: uniqueIndex("uq_im_req_item").on(table.refType, table.requestItemId),
  }),
);

/* =========================
 * Audit Logs
 * =======================*/
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    tableName: text("table_name").notNull(),
    action: text("action").notNull(),
    recordId: text("record_id").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null", onUpdate: "cascade" }),
    payload: text("payload"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    tableIdx: index("idx_audit_logs_table").on(table.tableName),
    recordIdx: index("idx_audit_logs_record").on(table.recordId),
    userIdx: index("idx_audit_logs_user").on(table.userId),
    createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
  }),
);

/* =========================
 * Relations (somente FKs reais)
 * =======================*/
export const usersRelations = relations(users, ({ many }) => ({
  requestsCreated: many(requests),
  requestsAssigned: many(requests, { relationName: "assignedTo" }),
  auditLogs: many(auditLogs),
  userUnits: many(userUnits),
}));

export const unitsRelations = relations(units, ({ many }) => ({
  products: many(products),
  requests: many(requests),
  userUnits: many(userUnits),
}));

export const productsRelations = relations(products, ({ many, one }) => ({
  unit: one(units, { fields: [products.unitId], references: [units.id] }),
  requestItems: many(requestItems),
  inventoryMovements: many(inventoryMovements),
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  unit: one(units, { fields: [requests.unitId], references: [units.id] }),
  createdBy: one(users, { fields: [requests.createdByUserId], references: [users.id] }),
  assignedTo: one(users, { relationName: "assignedTo", fields: [requests.assignedToUserId], references: [users.id] }),
  items: many(requestItems),
}));

export const requestItemsRelations = relations(requestItems, ({ one }) => ({
  request: one(requests, { fields: [requestItems.requestId], references: [requests.id] }),
  product: one(products, { fields: [requestItems.productId], references: [products.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  product: one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
}));

export const userUnitsRelations = relations(userUnits, ({ one }) => ({
  user: one(users, { fields: [userUnits.userId], references: [users.id] }),
  unit: one(units, { fields: [userUnits.unitId], references: [units.id] }),
}));
