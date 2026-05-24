import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const vector = (name: string, opts: { dimensions: number }) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${opts.dimensions})`,
    fromDriver: (v) => JSON.parse(v),
    toDriver: (v) => `[${v.join(",")}]`,
  })(name)

export const workspaces = pgTable("mdlsp_workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const documents = pgTable(
  "mdlsp_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    title: text("title"),
    lastIndexedAt: timestamp("last_indexed_at").defaultNow().notNull(),
  },
  (t) => ({
    workspacePathIdx: uniqueIndex("mdlsp_documents_workspace_path_idx").on(t.workspaceId, t.path),
  }),
)

export const sections = pgTable(
  "mdlsp_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    headingPath: text("heading_path").array().notNull(),
    anchor: text("anchor"),
    level: integer("level").notNull(),
    content: text("content").notNull(),
    charCount: integer("char_count").notNull(),
    positionStartLine: integer("position_start_line").notNull(),
    positionStartCol: integer("position_start_col").notNull(),
    positionEndLine: integer("position_end_line").notNull(),
    positionEndCol: integer("position_end_col").notNull(),
  },
  (t) => ({
    workspaceDocIdx: index("mdlsp_sections_workspace_doc_idx").on(t.workspaceId, t.documentId),
  }),
)

export const links = pgTable(
  "mdlsp_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    fromDocumentId: uuid("from_document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    fromSectionId: uuid("from_section_id").references(() => sections.id, { onDelete: "cascade" }),
    toPath: text("to_path").notNull(),
    toDocumentId: uuid("to_document_id").references(() => documents.id, { onDelete: "set null" }),
    toAnchor: text("to_anchor"),
    kind: text("kind", { enum: ["inline", "reference", "wiki", "autolink"] }).notNull(),
    textAtLink: text("text_at_link"),
  },
  (t) => ({
    workspaceToDocIdx: index("mdlsp_links_workspace_to_doc_idx").on(t.workspaceId, t.toDocumentId),
    workspaceToPathIdx: index("mdlsp_links_workspace_to_path_idx").on(t.workspaceId, t.toPath),
  }),
)

export const terms = pgTable(
  "mdlsp_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    canonicalId: text("canonical_id").notNull(),
    surfaceForms: text("surface_forms").array().notNull(),
    description: text("description"),
    embedding: vector("embedding", { dimensions: 1536 }),
    userOverridden: boolean("user_overridden").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    workspaceCanonIdx: uniqueIndex("mdlsp_terms_workspace_canon_idx").on(t.workspaceId, t.canonicalId),
  }),
)

export const termOccurrences = pgTable(
  "mdlsp_term_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    termId: uuid("term_id")
      .references(() => terms.id, { onDelete: "cascade" })
      .notNull(),
    sectionId: uuid("section_id")
      .references(() => sections.id, { onDelete: "cascade" })
      .notNull(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind", { enum: ["definition", "mention", "example"] }).notNull(),
    confidence: real("confidence").notNull().default(1.0),
    surfaceForm: text("surface_form").notNull(),
  },
  (t) => ({
    workspaceTermKindIdx: index("mdlsp_occ_workspace_term_kind_idx").on(t.workspaceId, t.termId, t.kind),
    workspaceSectionIdx: index("mdlsp_occ_workspace_section_idx").on(t.workspaceId, t.sectionId),
  }),
)

export const reindexJobs = pgTable("mdlsp_reindex_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .notNull(),
  kind: text("kind", { enum: ["full", "incremental", "glossary_only"] }).notNull(),
  status: text("status", { enum: ["pending", "running", "done", "failed"] }).notNull(),
  sectionsProcessed: integer("sections_processed").default(0).notNull(),
  llmTokensIn: integer("llm_tokens_in").default(0).notNull(),
  llmTokensOut: integer("llm_tokens_out").default(0).notNull(),
  embeddingTokens: integer("embedding_tokens").default(0).notNull(),
  costEstimateUsd: real("cost_estimate_usd").default(0).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
})

export type Workspace = typeof workspaces.$inferSelect
export type Document = typeof documents.$inferSelect
export type Section = typeof sections.$inferSelect
export type Link = typeof links.$inferSelect
export type Term = typeof terms.$inferSelect
export type TermOccurrence = typeof termOccurrences.$inferSelect
export type ReindexJob = typeof reindexJobs.$inferSelect

export const PGVECTOR_EXTENSION_SQL = sql`CREATE EXTENSION IF NOT EXISTS vector`
