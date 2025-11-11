import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// --- Enums (tipados) ---
export const userRoles = ["admin", "store", "warehouse"] as const;
export type UserRole = typeof userRoles[number];

export const requestStatus = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type RequestStatus = typeof requestStatus[number];

export const itemStatus = [
  "pending",
  "partial",
  "delivered",
  "cancelled",
] as const;
export type ItemStatus = typeof itemStatus[number];

// --- Users ---
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    // hash de senha (bcrypt)
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: userRoles })
      .notNull()
      .$type<UserRole>(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    emailIdx: index("idx_users_email").on(table.email),
    roleIdx: index("idx_users_role").on(table.role),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  requestsCreated: many(requests),
  requestsAssigned: many(requests, { relationName: "assignedTo" }),
  auditLogs: many(auditLogs),
}));

// --- Products ---
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("UN"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    skuIdx: index("idx_products_sku").on(table.sku),
    nameIdx: index("idx_products_name").on(table.name),
  }),
);

export const productsRelations = relations(products, ({ many }) => ({
  requestItems: many(requestItems),
}));

// --- Requests (Requisição de Reposição) ---
export const requests = sqliteTable(
  "requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // quem criou (normalmente "Store Staff")
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),

    // opcional: responsável atual (normalmente "Warehouse Staff")
    assignedToUserId: integer("assigned_to_user_id")
      .references(() => users.id, { onDelete: "set null", onUpdate: "cascade" }),

    status: text("status", { enum: requestStatus })
      .notNull()
      .default("pending")
      .$type<RequestStatus>(),

    // campo livre para observações
    note: text("note"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index("idx_requests_status").on(table.status),
    createdByIdx: index("idx_requests_created_by").on(table.createdByUserId),
    assignedIdx: index("idx_requests_assigned_to").on(table.assignedToUserId),
    createdAtIdx: index("idx_requests_created_at").on(table.createdAt),
  }),
);

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

// --- Request Items (Itens da Requisição) ---
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

    status: text("status", { enum: itemStatus })
      .notNull()
      .default("pending")
      .$type<ItemStatus>(),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    reqIdx: index("idx_request_items_request").on(table.requestId),
    prodIdx: index("idx_request_items_product").on(table.productId),
  }),
);

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

// --- Audit Logs (Rastreabilidade) ---
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tableName: text("table_name").notNull(), // ex.: "requests", "request_items", "products", "users"
    action: text("action").notNull(), // ex.: "CREATE", "UPDATE", "DELETE", "STATUS_CHANGE"
    recordId: text("record_id").notNull(), // id do registro afetado (string para flexibilizar)
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    // payload JSON serializado (antes/depois, diffs, etc.)
    payload: text("payload"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tableIdx: index("idx_audit_logs_table").on(table.tableName),
    recordIdx: index("idx_audit_logs_record").on(table.recordId),
    userIdx: index("idx_audit_logs_user").on(table.userId),
    createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
  }),
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

// --- Observações ---
// - updatedAt: atualizaremos na aplicação (trigger pode ser adicionado depois).
// - status: simplificado p/ MVP; podemos normalizar depois (tabelas de domínio).
// - payload em audit_logs: string JSON (SQLite não tem tipo JSON nativo).
