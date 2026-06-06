# Chat Persistence, Citations and Audit - Decision Record

## Decision

Phase 8 converts the RAG chat flow into a fully persistent, auditable backend.
A single POST to `/api/chat` validates auth, creates or resumes a conversation,
records both messages, persists citations from evidence, and writes audit logs.

Phase 9 makes `rag.answer.*` audit events mandatory.

## Flow

```
POST /api/chat
  -> reject forbidden org fields (query + body)
  -> Zod validate (.strict())
  -> validateStudyAccess(studyId) -> { userId, orgId }
  -> rate limit by userId + studyId
  -> getOrCreateConversation(conversationId?, orgId, studyId, userId) -> conversationId
  -> persistUserMessage(conversationId, question) -> userMessageId
  -> writeAuditLog('rag.answer.requested', safe metadata)
  -> generateAnswerForStudy({ studyId, question, documentType?, topK? }) -> result
      (on error) -> writeAuditLog('rag.answer.failed') -> return 500
  -> persistAssistantMessageAndCitations(result) -> assistantMessageId
  -> writeAuditLog('rag.answer.completed', safe metadata)
  -> return ChatResponse
```

No transaction is held open during the LLM call.

## Audit actions

- `rag.answer.requested`: after auth, rate limit, and persistence of the user message;
  before retrieval and LLM work.
- `rag.answer.completed`: after assistant message and citations persist.
- `rag.answer.failed`: when answer generation fails after the request is accepted.

These events are mandatory. Audit failures return a generic 500 instead of
allowing an unaudited chat success.

## Conversation validation

When `conversationId` is provided, three fields are checked against the DB:
`organizationId = orgId AND studyId = studyId AND userId = userId`.
All three must match. A partial match returns 404 to avoid enumeration leakage.

## Citation persistence

Citations are persisted inside a transaction with `persistAssistantMessageAndCitations`.
The document metadata (`documentName`, `documentType`) is fetched inside the same
transaction using the `documentId` from each evidence. If any document is not found
with the org-scoped lookup, the entire transaction rolls back.

`evidence.pageStart / pageEnd` are asserted non-null before citation insert.
Real retrieval always produces non-null values. A null value is treated as a
data integrity error.

## Audit metadata safety

Audit metadata is intentionally minimal: IDs, counts, confidence, documentType,
topK, and sanitized error codes. Question text, answer text, chunk content,
prompts, excerpts, PHI, and embeddings are never written to audit logs.

## What this phase does NOT do

- No streaming.
- No PDF viewer.
- No ingestion/upload/Blob changes.
- No audit log dashboard.
