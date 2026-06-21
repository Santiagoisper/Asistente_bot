# Retrieval Base Decision

## Decision

Phase 6 implements internal retrieval only. It does not expose a public endpoint,
does not call an LLM, does not generate answers, and does not persist citations.

The retriever uses the same query embedding model as indexing:
`text-embedding-3-small` with 1536 dimensions. Query embeddings are generated
through the ingestion embedder so retrieval and indexing stay dimension-compatible.

## Contract

`retrieveRelevantChunks()` receives:

- `queryText`
- `orgId`
- `studyId`
- `topK`
- optional `documentType`

It returns flattened chunk metadata:

- `chunkId`
- `documentId`
- `documentVersionId`
- `documentType`
- `pageStart`
- `pageEnd`
- `sectionTitle`
- `content`
- `similarityScore`

This is enough for Phase 7 to assemble grounded prompts and build citations
without exposing embeddings or Blob identifiers.

## Tenant isolation

Tenant isolation is enforced inside the same SQL query that orders by vector
distance. The retriever never retrieves global top-K results and filters them in
memory.

The query always includes:

- `chunks.organization_id = orgId`
- `chunks.study_id = studyId`
- `chunks.embedding IS NOT NULL`

If `documentType` is provided, the same query also includes
`chunks.document_type = documentType`.

The vector distance uses pgvector cosine distance:

```sql
chunks.embedding <=> $query_embedding::vector
```

The returned `similarityScore` is `1 - distance`.

## Query embedding failures

Provider and dimension errors are sanitized before leaving the retriever:

- `embedding_provider_error`
- `embedding_dimension_mismatch`
- `embedding_rate_limited`
- `query_embedding_failed`

The retriever does not log full query text or chunk content.

## Out of scope

- answer engine
- chat routes or UI
- generated citations
- reranking
- hybrid search
