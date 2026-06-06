# Answer Test Endpoint — Decision Record

## Decision

Phase 7.2 implements `POST /api/rag/answer-test`, a thin HTTP adapter over the
Phase 7.1 orchestration wrapper (`generateAnswerForStudy`). It exists solely for
internal integration testing of the RAG pipeline. It is not the production chat
endpoint.

## Pattern

```
POST /api/rag/answer-test
  → feature-flag guard
  → reject forbidden org fields from query + body
  → Zod parse (.strict())
  → generateAnswerForStudy(parsed.data)
  → Response.json(result, { status: 200 })
```

The route contains no RAG logic. All retrieval, auth resolution, and answer
generation happen in the wrapper.

## Feature flag

`ENABLE_INTERNAL_RAG_ANSWER_TEST=true` must be set explicitly. Without it, the
route returns 404. `NODE_ENV !== 'production'` is not used as the sole guard —
the env var is required in all environments.

## orgId rejection

`orgId`, `organizationId`, and `organization_id` are rejected from both query
params and body before Zod validation, mirroring the upload and ingestion routes.
The Zod schema also uses `.strict()` as defense-in-depth.

## Error mapping

| Wrapper error code | HTTP status | Body |
|---|---|---|
| `access_denied` | 403 | `Study not found or access denied` |
| `retrieval_error` | 500 | `Internal Server Error` |
| `answer_generation_error` | 500 | `Internal Server Error` |
| Unrecognized | delegated to `handleApiError` | per convention |

Internal error details never reach the response body.

## Response

`200` always when the wrapper returns, including `insufficient_evidence` cases.
The body is `GenerateAnswerForStudyResult`:

```ts
{
  answer: string
  confidence: 'high' | 'medium' | 'low' | 'insufficient_evidence'
  evidences: Evidence[]
  retrievalCount: number
}
```

No extra fields. No raw prompts, embeddings, or chunk content.

## DocumentType enum in the route

The Zod schema for `documentType` is defined locally in the route file to avoid
loading the DB client (which throws without `DATABASE_URL`) during test module
resolution. The values are kept in sync with `packages/db/schema/enums.ts`.

## Out of scope

- Persistence of messages or citations
- Streaming
- Production chat UI
- Audit logging for this test endpoint
