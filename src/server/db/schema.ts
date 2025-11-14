// src/server/db/schema.ts
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

/* =========================
 * Enums tipados (TS)
 * =======================*/
export const userRoles = ["admin", "store", "warehouse"] as const;
export type UserRole = (typeof userRoles)[number];

export const requestStatus = ["pending", "in_progress", "completed", "cancelled"] as const;
export type RequestStatus = (typeof requestStatus)[number];

export const itemStatus = ["pending", "partial", "delivered", "cancelled"] as const;
export type ItemStatus = (typeof itemStatus)[number];

/* =========================
 * Users
 * =======================*/
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: userRoles }).notNull().$type<UserRole>(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    emailIdx: index("idx_users_email").on(table.email),
    roleIdx: index("idx_users_role").on(table.role),
  }),
);

/* =========================
 * Products
 * =======================*/
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("UN"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    // saldo atual (para leitura rápida)
    stock: integer("stock").notNull().default(0),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

/* =========================
 * Inventory Movements (livro-razão)
 * =======================*/
export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id),
    qty: integer("qty").notNull(), // sempre POSITIVO
    type: text("type", { enum: ["in", "out", "adjust"] }).notNull(), // entrada, saída, ajuste

    // referência cruzada (para idempotência e auditoria)
    refType: text("ref_type"), // ex.: "request"
    refId: integer("ref_id"),  // ex.: id da requisição
    requestItemId: integer("request_item_id"), // ex.: id do item usado na saída

    note: text("note"),
    createdByUserId: integer("created_by_user_id"), // opcional
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    imProductIdx: index("idx_im_product").on(table.productId),
    // impede duplicar o movimento para o MESMO item de requisição
    imReqItemUnique: uniqueIndex("uq_im_req_item").on(table.refType, table.requestItemId),
    // (opcional) índice por data — útil para relatórios:
    // imCreatedAtIdx: index("idx_im_created_at").on(table.createdAt),
  }),
);

/* =========================
 * Requests (Requisições)
 * =======================*/
export const requests = sqliteTable(
  "requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),

    assignedToUserId: integer("assigned_to_user_id")
      .references(() => users.id, { onDelete: "set null", onUpdate: "cascade" }),

    status: text("status", { enum: requestStatus }).notNull().default("pending").$type<RequestStatus>(),

    note: text("note"),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index("idx_requests_status").on(table.status),
    createdByIdx: index("idx_requests_created_by").on(table.createdByUserId),
    assignedIdx: index("idx_requests_assigned_to").on(table.assignedToUserId),
    createdAtIdx: index("idx_requests_created_at").on(table.createdAt),
  }),
);

/* =========================
 * Request Items
 * =======================*/
export const requestItems = sqliteTable(
  "request_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade", onUpdate: "cascade" }),

    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict", onUpdate: "cascade" }),

    requestedQty: integer("requested_qty").notNull(),
    deliveredQty: integer("delivered_qty").notNull().default(0),

    status: text("status", { enum: itemStatus }).notNull().default("pending").$type<ItemStatus>(),

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    reqIdx: index("idx_request_items_request").on(table.requestId),
    prodIdx: index("idx_request_items_product").on(table.productId),
  }),
);

/* =========================
 * Audit Logs
 * =======================*/
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tableName: text("table_name").notNull(), // ex.: "requests", "request_items", "products", "users"
    action: text("action").notNull(), // "CREATE", "UPDATE", "DELETE", "STATUS_CHANGE", etc.
    recordId: text("record_id").notNull(), // string p/ flexibilizar
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    payload: text("payload"), // JSON serializado (string)

    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tableIdx: index("idx_audit_logs_table").on(table.tableName),
    recordIdx: index("idx_audit_logs_record").on(table.recordId),
    userIdx: index("idx_audit_logs_user").on(table.userId),
    createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
  }),
);

/* =====================================================
 * Relations  (defina SEMPRE depois de TODAS as tabelas)
 * ===================================================*/
export const usersRelations = relations(users, ({ many }) => ({
  requestsCreated: many(requests),
  requestsAssigned: many(requests, { relationName: "assignedTo" }),
  auditLogs: many(auditLogs),
}));

export const productsRelations = relations(products, ({ many }) => ({
  requestItems: many(requestItems),
  // movements: many(inventoryMovements), // ative se quiser navegar produto → movimentos
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [requests.createdByUserId],
    references: [users.id],
  }),
  assignedTo: one(users, {
    relationName: "assignedTo",
    fields: [requests.assignedToUserId],
    references: [users.id],
  }),
  items: many(requestItems),
  auditLogs: many(auditLogs),
}));

export const requestItemsRelations = relations(requestItems, ({ one }) => ({
  request: one(requests, {
    fields: [requestItems.requestId],
    references: [requests.id],
  }),
  product: one(products, {
    fields: [requestItems.productId],
    references: [products.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  product: one(products, {
    fields: [inventoryMovements.productId],
    references: [products.id],
  }),
}));
