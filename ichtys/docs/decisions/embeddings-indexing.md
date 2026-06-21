# Embeddings and Vector Indexing Decision

## Decision

Phase 5 uses OpenAI `text-embedding-3-small` for chunk embeddings. The model is
the project default because it provides the expected 1536 dimensions for the
existing `chunks.embedding VECTOR(1536)` schema while keeping indexing cost low
for clinical document batches.

No retrieval API is introduced in this phase. The only goal is to persist
tenant-scoped vectors so Phase 6 can implement filtered retrieval.

## Embedder

`packages/ingestion/embedder.ts` wraps the provider behind a small typed
interface. Production uses the OpenAI SDK; tests inject a mock client through
the wrapper. The embedder:

- accepts text batches
- splits requests into bounded batches
- validates every vector has 1536 dimensions
- preserves input/output order
- returns approximate token counts for chunk metadata
- converts provider failures into sanitized codes

Sanitized embedding errors are:

- `embedding_provider_error`
- `embedding_dimension_mismatch`
- `embedding_rate_limited`

The embedder does not log chunk content, prompts, patient details, or provider
payloads.

## Indexing

`packages/ingestion/indexer.ts` receives a context already authorized by the
HTTP layer:

- `userId`
- `orgId`
- `studyId`
- `documentId`
- `documentVersionId`

The indexer still revalidates `document_versions` and `documents` with
`organization_id` + `study_id` before touching chunks. It then loads only chunks
for that exact document version with `embedding IS NULL`, generates embeddings,
and updates each chunk with a `WHERE` clause that repeats:

- `chunks.id`
- `chunks.document_id`
- `chunks.document_version_id`
- `chunks.organization_id`
- `chunks.study_id`

This prevents a stale or malformed context from writing vectors onto chunks
outside the authorized tenant/study boundary.

## Status semantics

`document_versions.status = ready` now means:

1. PDF downloaded from private Blob
2. text extracted by page
3. pages persisted
4. chunks persisted with tenant metadata
5. embeddings generated and persisted

If embeddings fail, status becomes `error` with a sanitized error code. The
document is not considered searchable until embeddings complete.

## Audit

Embedding indexing writes mandatory audit logs:

- `embeddings.started`
- `embeddings.completed`
- `embeddings.failed`

Each audit row carries `organization_id`, `study_id`, `user_id`,
`resource_type = document_version`, and `resource_id = documentVersionId`.

## Out of scope

- retrieval
- answer engine
- chat
- generated citations
- reranking or hybrid search
