# Permissions Audit

## Decision

Every API endpoint must derive `organization_id` from Clerk server-side auth and
must validate study or object ownership before returning tenant-scoped data.
Client-provided organization identifiers are rejected.

## Endpoint Review

| Endpoint | Auth | Tenant / object authorization | Notes |
|---|---|---|---|
| `POST /api/chat` | `validateStudyAccess(studyId)` | Study validated against active org; optional `conversationId` validated by org + study + user | Rate limited by `userId + studyId`; no client org/user fields accepted. |
| `GET /api/conversations?studyId=...` | `validateStudyAccess(studyId)` | SQL filters conversations by org + study + user | Rejects org identifiers in query. |
| `GET /api/conversations/[conversationId]/messages` | `validateConversationAccess(conversationId)` | Conversation ownership validates org + study + user; messages filtered by org + study | Rejects org identifiers in query. |
| `GET /api/citations/[messageId]` | `validateMessageAccess(messageId)` | Message validated by org + study; conversation ownership validates user; citations filtered by org + study | `citation.view` audit is mandatory. |
| `POST /api/documents/upload` | `validateStudyAccess(studyId)` | Document and version rows inherit org + study from auth context | Upload audit is mandatory; no public Blob URL returned. |
| `GET /api/documents/[id]/status` | `validateDocumentAccess(documentId)` | Document and latest version filtered by org + study | Returns sanitized processing errors only. |
| `GET /api/documents/[id]/page/[pageNumber]` | `validateDocumentPageAccess(documentId, pageNumber)` | Document page access validates org + study + page number | Endpoint remains a 501 stub after authorization; no PDF/page data is served. |
| `POST /api/ingestion/run` | `validateDocumentVersionAccess(documentVersionId)` | Document version validated by org + study before internal pipeline | Internal pipeline revalidates org + study. |
| `GET /api/document-versions/[documentVersionId]/download` | `validateDocumentVersionAccess(documentVersionId)` | Document version, document, and study validated by org + study | Serves private Blob only; no blob key/url returned. |
| `POST /api/rag/answer-test` | Feature flag plus `generateAnswerForStudy` study validation | Wrapper validates study against active org; retrieval filters org + study in SQL | Internal-only, off by default, rate limited by internal header/IP. |

## Remaining Constraints

- `GET /api/documents/[id]/page/[pageNumber]` is intentionally not implemented.
  It performs object authorization before returning `501 Not Implemented`.
- Any future endpoint that receives object ids must use the object access helpers
  rather than accepting `studyId` as the authorization boundary.
