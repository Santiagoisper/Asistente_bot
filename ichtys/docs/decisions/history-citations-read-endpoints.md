# History and Citations Read Endpoints — Decision Record

## Decision

Phase 8.1 implements three read-only GET endpoints for accessing conversation history,
messages, and citations with full tenant isolation, authorization, and audit logging.

## Endpoints

```
GET /api/conversations?studyId=...
  ↓ Returns list of conversations for active user within authorized study

GET /api/conversations/[conversationId]/messages
  ↓ Returns messages from an authorized conversation in ascending order

GET /api/citations/[messageId]
  ↓ Returns citations associated with an authorized assistant message
```

## Authorization chain

### Conversations list

```
Clerk token → orgId
         ↓
validateStudyAccess(studyId) → userId
         ↓
listConversationsForStudy(orgId, studyId, userId)
         ↓
SQL: WHERE organizationId = orgId AND studyId = studyId AND userId = userId
```

### Messages from conversation

```
Clerk token → orgId + userId
         ↓
validateConversationAccess(conversationId)
  - checks conversations table: organizationId, studyId, userId all match
         ↓
getConversationMessages(conversationId, orgId, studyId)
         ↓
SQL: WHERE conversationId = id AND organizationId = orgId AND studyId = studyId
```

### Citations from message

```
Clerk token → orgId + userId
         ↓
validateMessageAccess(messageId) → orgId, studyId
         ↓
db.query.conversations.findFirst({
  where: conversationId = message.conversationId
      AND userId = active_userId
      AND organizationId = active_orgId
})
  - SECURITY: ensures userId can only read citations from own conversations
         ↓
getMessageCitations(messageId, orgId, studyId)
         ↓
SQL: WHERE messageId = id AND organizationId = orgId AND studyId = studyId
```

## New auth helper

`validateConversationAccess(conversationId)` added to `packages/auth/object-access.ts`:
- Resolves active organization from Clerk token
- Checks three-field match: orgId + studyId + userId
- Returns `{ userId, orgId, studyId, conversation, study }`
- Throws 404 on mismatch (no enumeration leak)

## Query optimization

All filtering happens **in SQL**, never in memory:
- `listConversationsForStudy` uses `WHERE organizationId, studyId, userId`
- `getConversationMessages` uses `WHERE conversationId, organizationId, studyId`
- `getMessageCitations` uses `WHERE messageId, organizationId, studyId`

No N+1 queries introduced. `citationCount` field (optional per spec) not implemented
in Phase 8.1 — deferred until UI requires it.

## Input validation

Query/path params:
- Reject `orgId`, `organizationId`, `organization_id` from body and query (400)
- UUID validation via Zod on path params
- `studyId` required in query for /conversations list (400 if missing)

## Response contracts

**Conversations list**
```ts
{ conversations: ConversationListItem[] }
```

**Messages**
```ts
{
  conversationId: string
  studyId: string
  messages: MessageItem[]
}
```

**Citations**
```ts
{
  messageId: string
  citations: CitationItem[]
}
```

No `orgId`, `organizationId`, or `userId` exposed in any response.
No embeddings, full chunks, or raw prompts exposed.

## Audit logging

Citations read generates `citation.view` audit log (best-effort).

Metadata: `{ citationCount: number }`.

No question, answer, or excerpt content in audit logs.

## What this phase does NOT do

- No streaming.
- No pagination or limits on conversation list.
- No `lastMessagePreview` field (optional per spec).
- No `citationCount` in messages (optional per spec).
- No UI.
- No changes to answer engine, retrieval, ingestion, upload, or Blob.
- No schema changes.
