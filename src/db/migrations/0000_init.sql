-- Markdown LSP: initial schema
-- All tables prefixed with mdlsp_ to coexist with Docsbook tables in the same Neon database.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "mdlsp_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "root_path" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "mdlsp_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "mdlsp_workspaces"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "content_hash" text NOT NULL,
  "title" text,
  "last_indexed_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mdlsp_documents_workspace_path_idx" ON "mdlsp_documents" ("workspace_id", "path");

CREATE TABLE IF NOT EXISTS "mdlsp_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "mdlsp_documents"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "mdlsp_workspaces"("id") ON DELETE CASCADE,
  "heading_path" text[] NOT NULL,
  "anchor" text,
  "level" integer NOT NULL,
  "content" text NOT NULL,
  "char_count" integer NOT NULL,
  "position_start_line" integer NOT NULL,
  "position_start_col" integer NOT NULL,
  "position_end_line" integer NOT NULL,
  "position_end_col" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "mdlsp_sections_workspace_doc_idx" ON "mdlsp_sections" ("workspace_id", "document_id");

CREATE TABLE IF NOT EXISTS "mdlsp_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "mdlsp_workspaces"("id") ON DELETE CASCADE,
  "from_document_id" uuid NOT NULL REFERENCES "mdlsp_documents"("id") ON DELETE CASCADE,
  "from_section_id" uuid REFERENCES "mdlsp_sections"("id") ON DELETE CASCADE,
  "to_path" text NOT NULL,
  "to_document_id" uuid REFERENCES "mdlsp_documents"("id") ON DELETE SET NULL,
  "to_anchor" text,
  "kind" text NOT NULL CHECK ("kind" IN ('inline', 'reference', 'wiki', 'autolink')),
  "text_at_link" text
);
CREATE INDEX IF NOT EXISTS "mdlsp_links_workspace_to_doc_idx" ON "mdlsp_links" ("workspace_id", "to_document_id");
CREATE INDEX IF NOT EXISTS "mdlsp_links_workspace_to_path_idx" ON "mdlsp_links" ("workspace_id", "to_path");

CREATE TABLE IF NOT EXISTS "mdlsp_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "mdlsp_workspaces"("id") ON DELETE CASCADE,
  "canonical_id" text NOT NULL,
  "surface_forms" text[] NOT NULL,
  "description" text,
  "embedding" vector(1536),
  "user_overridden" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mdlsp_terms_workspace_canon_idx" ON "mdlsp_terms" ("workspace_id", "canonical_id");
CREATE INDEX IF NOT EXISTS "mdlsp_terms_embedding_idx" ON "mdlsp_terms" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE IF NOT EXISTS "mdlsp_term_occurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "mdlsp_workspaces"("id") ON DELETE CASCADE,
  "term_id" uuid NOT NULL REFERENCES "mdlsp_terms"("id") ON DELETE CASCADE,
  "section_id" uuid NOT NULL REFERENCES "mdlsp_sections"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "mdlsp_documents"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('definition', 'mention', 'example')),
  "confidence" real DEFAULT 1.0 NOT NULL,
  "surface_form" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "mdlsp_occ_workspace_term_kind_idx" ON "mdlsp_term_occurrences" ("workspace_id", "term_id", "kind");
CREATE INDEX IF NOT EXISTS "mdlsp_occ_workspace_section_idx" ON "mdlsp_term_occurrences" ("workspace_id", "section_id");

CREATE TABLE IF NOT EXISTS "mdlsp_reindex_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "mdlsp_workspaces"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('full', 'incremental', 'glossary_only')),
  "status" text NOT NULL CHECK ("status" IN ('pending', 'running', 'done', 'failed')),
  "sections_processed" integer DEFAULT 0 NOT NULL,
  "llm_tokens_in" integer DEFAULT 0 NOT NULL,
  "llm_tokens_out" integer DEFAULT 0 NOT NULL,
  "embedding_tokens" integer DEFAULT 0 NOT NULL,
  "cost_estimate_usd" real DEFAULT 0 NOT NULL,
  "error" text,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp
);
