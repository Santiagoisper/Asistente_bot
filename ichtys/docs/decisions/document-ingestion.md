# Document Ingestion Decision

## Decision

Ingestion processes `documentVersionId`, not `documentId`. The blob, processing
status, page count, and sanitized error message all belong to a concrete
document version. This prevents future re-uploads from mixing pages or chunks
between versions of the same logical document.

## Flow

Upload and ingestion are separate phases:

1. Upload validates auth and study access, stores the PDF in private Vercel
   Blob, creates `documents`, and creates a pending `document_versions` row.
2. Ingestion validates object-level access to the requested
   `documentVersionId`.
3. The HTTP route passes a safe context to the internal pipeline:
   `userId`, `orgId`, `studyId`, `documentId`, and `documentVersionId`.
4. The pipeline downloads the private blob, extracts text by page, creates
   pages, creates chunks with metadata, embeds those chunks, and marks the
   version `ready` or `error`.

The internal pipeline does not call Clerk. This keeps it usable from a future
worker or queue, where request-local auth is not available.

## PDF parsing

The parser uses `pdfjs-dist` because it can extract text page by page in Node.
It accepts `Buffer` or `Uint8Array` and returns ordered, 1-indexed pages:

- `pageNumber`
- `rawText`

OCR is out of scope. If a scanned PDF has no extractable text, ingestion stores
the sanitized error code `pdf_contains_no_extractable_text`.

## Chunking

Chunks use an approximate character window equivalent to the PRD target of
800-1200 tokens, with approximate overlap. There is no complex layout analysis
in this phase. A conservative heading heuristic may set `section_title`; if the
heading is not reliable, it remains `null`.

Each chunk preserves:

- `page_start`
- `page_end`
- `section_title`
- `content`
- approximate `token_count`

Embeddings are created after chunks are inserted and before the document version
can be marked `ready`.

## Tenant isolation

Every ingestion write carries tenant metadata:

- `pages.organization_id`
- `pages.study_id`
- `chunks.organization_id`
- `chunks.study_id`
- `chunks.document_id`
- `chunks.document_version_id`
- `chunks.document_type`

The pipeline revalidates `documents` and `document_versions` with the
authorized `organization_id` and `study_id` before reading Blob or writing rows.
Client-provided `organization_id` is never accepted.

## Status and audit

`document_versions.status` transitions:

- `pending` after upload
- `processing` when ingestion starts
- `ready` after pages, chunks, and embeddings are persisted
- `error` if Blob download, PDF parsing, chunking, embeddings, or ingestion
  fails

Stored error messages are sanitized codes, not stack traces. Ingestion audit logs
are created for `ingestion.started`, `ingestion.completed`, and
`ingestion.failed`. Embedding audit logs are created for `embeddings.started`,
`embeddings.completed`, and `embeddings.failed`.

## Authenticated PDF download/preview

PDF binary access uses the same version boundary as ingestion:
`documentVersionId`. The route
`GET /api/document-versions/[documentVersionId]/download` validates the version
with object-level authorization before reading the private Blob object. This is
intentional because the Blob key, status, page count, error message, pages, and
chunks all belong to a concrete `document_versions` row.

The endpoint rejects client-supplied `organization_id`/`organizationId`, derives
the active org from Clerk, validates the related document and study, reads Blob
through the stored private key, and returns `application/pdf` as an attachment.
It never returns `blob_url` or `blob_key`.

Inline preview is out of scope for this phase. A future preview endpoint or mode
must preserve the same authorization path and avoid public Blob URLs.

## Out of scope

- OCR
- retrieval
- RAG or answer generation
- UI beyond existing status polling
