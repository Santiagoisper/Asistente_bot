# Chat Persistence, Citations and Audit — Decision Record

## Decision

Phase 8 converts the RAG chat flow into a fully persistent, auditable backend.
A single POST to `/api/chat` validates auth, creates or resumes a conversation,
records both messages, persists citations from evidence, and writes audit logs.

## Flow

```
POST /api/chat
  → reject forbidden org fields (query + body)
  → Zod validate (.strict())
  → validateStudyAccess(studyId) → { userId, orgId }
  → getOrCreateConversation(conversationId?, orgId, studyId, userId) → conversationId
  → persistUserMessage(conversationId, question) → userMessageId
  → safeWriteAuditLog('rag.answer.requested', safe metadata)
  → generateAnswerForStudy({ studyId, question, documentType?, topK? }) → result
      (on error) → safeWriteAuditLog('rag.answer.failed') → return 500
  → persistAssistantMessageAndCitations(result) → assistantMessageId
  → safeWriteAuditLog('rag.answer.completed', safe metadata)
  → return ChatResponse
```

No transaction is held open during the LLM call.

## New audit actions

Added to `packages/db/schema/enums.ts` (text column, no DB migration needed):
- `rag.answer.requested` — after auth and before LLM call
- `rag.answer.completed` — after persistence succeeds
- `rag.answer.failed` — when wrapper or persistence fails

## Conversation validation

When `conversationId` is provided, three fields are checked against the DB:
`organizationId = orgId AND studyId = studyId AND userId = userId`.
All three must match — partial match → 404. This is a hard security boundary.

## Citation persistence

Citations are persisted inside a transaction with `persistAssistantMessageAndCitations`.
The document metadata (`documentName`, `documentType`) is fetched inside the same
transaction using the `documentId` from each evidence. If any document is not found
(org-scoped lookup), the entire TX rolls back — no silent partial citation writes.

`evidence.pageStart / pageEnd` are asserted non-null before citation insert. Real
retrieval always produces non-null values (chunks schema enforces it). A null value
is treated as a data integrity error.

## Drizzle operator re-exports

`packages/db/index.ts` now re-exports `and`, `eq`, `inArray` from `drizzle-orm`
so that `apps/web/lib/chat/persistence.ts` can import query operators from
`@ichtys/db` without declaring a direct `drizzle-orm` dependency in `apps/web`.

## Audit log safety

`safeWriteAuditLog` swallows errors after logging server-side. Audit failures
never cause a 500 for the user after a successful answer has been generated.

Audit metadata is intentionally minimal: IDs, counts, confidence, documentType,
topK, error codes. Question text, answer text, chunk content, and embeddings are
never written to audit logs.

## What this phase does NOT do

- No streaming. Response is synchronous JSON.
- No PDF viewer or UI.
- No ingestion/upload/Blob changes.
- No citation reads or history endpoint (future phase).
- No audit log dashboard (future phase).
