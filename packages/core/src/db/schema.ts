import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const documentStatus = pgEnum("document_status", [
  "queued",
  "extracting",
  "needs_review",
  "approved",
  "failed",
]);

export type DocumentStatus = (typeof documentStatus.enumValues)[number];

export interface FieldError {
  field: string;
  message: string;
  /** Business rule that raised it; absent for schema (type/format) errors */
  rule?: string;
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    schema: jsonb("schema").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("document_types_slug_version_idx").on(t.slug, t.version)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentTypeId: uuid("document_type_id")
      .notNull()
      .references(() => documentTypes.id),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    status: documentStatus("status").notNull().default("queued"),
    pageCount: integer("page_count"),
    hasTextLayer: boolean("has_text_layer"),
    error: text("error"),
    /** Fields the score stage wants a human to check, with the reason for each */
    flags: jsonb("flags").$type<FieldError[]>().notNull().default([]),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex("documents_type_sha256_idx").on(t.documentTypeId, t.sha256),
    index("documents_status_idx").on(t.status),
    index("documents_created_at_idx").on(t.createdAt),
  ],
);

export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    runNumber: integer("run_number").notNull(),
    rawOutput: text("raw_output").notNull(),
    parsed: jsonb("parsed").$type<Record<string, unknown>>(),
    validationErrors: jsonb("validation_errors").$type<FieldError[]>().notNull().default([]),
    durationMs: integer("duration_ms").notNull(),
    ...timestamps,
  },
  (t) => [
    index("extractions_document_id_idx").on(t.documentId),
    index("extractions_parsed_gin_idx").using("gin", t.parsed),
  ],
);

export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    extractionId: uuid("extraction_id")
      .notNull()
      .references(() => extractions.id),
    documentTypeId: uuid("document_type_id")
      .notNull()
      .references(() => documentTypes.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("records_document_id_idx").on(t.documentId),
    index("records_document_type_id_idx").on(t.documentTypeId),
    index("records_data_gin_idx").using("gin", t.data),
  ],
);

export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    extractionId: uuid("extraction_id")
      .notNull()
      .references(() => extractions.id),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    reviewer: text("reviewer").notNull(),
    ...timestamps,
  },
  (t) => [index("corrections_document_id_idx").on(t.documentId)],
);
