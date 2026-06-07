# SECURITY - Ichtys

Reglas de seguridad expandidas. Complementa las reglas no negociables de
`CLAUDE.md` y la seccion Seguridad de `ARCHITECTURE.md`. Ichtys opera en
entornos clinicos regulados (ICH E6 GCP, FDA 21 CFR, ANMAT/ANVISA): un fallo de
aislamiento es un incidente, no un bug menor.

---

## 1. Modelo de tenancy

```
organization (Clerk Org) -> studies -> documents -> chunks
                         -> conversations / messages / citations
```

- El tenant raiz es la **organizacion**. Su identidad llega SIEMPRE desde el
  token de Clerk (`auth().orgId`), nunca desde el body, query o headers del
  request.
- La unidad de aislamiento de contenido es el **study**. Ninguna respuesta
  mezcla documentos de estudios distintos.

---

## 2. Reglas no negociables

1. **Todo acceso a datos se valida server-side.** Nunca confiar en parametros
   del cliente para determinar permisos.
2. **`organization_id` siempre desde el token de Clerk.** Se resuelve el UUID
   interno a partir de `clerk_org_id`; el cliente nunca lo provee.
3. **`study_id` validado contra la org del token** antes de cualquier operacion
   (`validateStudyAccess`).
4. **Retrieval filtra por `organization_id` + `study_id` en el WHERE**, antes
   del ordenamiento por distancia vectorial. Sin excepciones, ni "para testing".
5. **PDFs servidos solo por endpoints autenticados.** Blob privado; nunca URLs
   publicas directas al cliente.
6. **Audit log en toda accion sensible**, incluyendo accesos denegados.
7. **Errores internos nunca se exponen al cliente.** Log server-side; mensaje
   generico (401/403/404/500) al cliente.

---

## 3. Capas de defensa

| Capa | Control |
|---|---|
| Edge | `middleware.ts` (Clerk) protege todo salvo rutas publicas de auth |
| API route | `validateStudyAccess()` + validacion Zod del body |
| Query | filtro `organization_id` + `study_id` obligatorio en toda lectura |
| Storage | Vercel Blob privado; acceso binario por endpoint autenticado |
| Observabilidad | `audit_logs` append-only |

El aislamiento no depende de una sola capa: el filtro de tenant en la query es
la ultima linea y la mas importante.

---

## 4. Manejo de PDFs

- Los blobs se almacenan con key derivada (no adivinable) en Vercel Blob.
- El acceso al binario pasa por
  `GET /api/document-versions/[documentVersionId]/download`, que valida
  autenticacion y object-level authorization antes de leer Blob privado.
- Nunca se exponen URLs publicas de Blob en el cliente.
- Nunca se exponen `blob_url` ni `blob_key` en respuestas de descarga.

---

## 5. Tests de seguridad (bloqueantes)

- **Cross-tenant leakage**: un usuario de org A nunca recupera chunks/citas de
  org B. Target 0%.
- **Cross-study leakage**: dentro de una org, una pregunta sobre study X nunca
  trae evidencia de study Y. Target 0%.
- **Auth guards**: toda API route rechaza requests sin sesion/org activa.

`pnpm test:leakage` debe pasar para mergear. Ver `docs/EVALS.md`.

---

## 6. Secretos

- Nunca commitear `.env*` (solo `.env.example`).
- Claves: Clerk, Neon (`DATABASE_URL`/`_UNPOOLED`), Vercel Blob, Anthropic,
  OpenAI. Rotables sin cambios de codigo.

---

## 7. Object-level authorization

Validar `study_id` no alcanza cuando una ruta recibe un id de objeto. Todo
`documentId`, `messageId`, `citationId` o acceso a pagina debe validarse en DB
contra la organizacion activa y el study real del objeto antes de devolver datos.

Reglas:

- `organization_id` sigue viniendo solo del token de Clerk y se resuelve al UUID
  interno de `organizations`.
- `documentId` se busca con `documents.id` + `documents.organization_id`; luego
  `documents.study_id` se cruza contra `studies.organization_id`.
- `documentVersionId` se busca con `document_versions.id` +
  `document_versions.organization_id`; luego se verifica el `document` y el
  `study` asociados.
- `messageId` se busca con `messages.id` + `messages.organization_id`; luego
  `messages.study_id` se cruza contra `studies.organization_id`.
- Las citas se leen solo con `citations.message_id` +
  `citations.organization_id` + `citations.study_id` derivados del mensaje
  validado.
- Las paginas se autorizan despues de validar el documento y se buscan con
  `pages.organization_id` + `pages.study_id` + la version documental validada.
- Objetos fuera de la org/study activa devuelven `404 Not Found`, no `403`, para
  evitar enumeration leakage.

Estos tests son bloqueantes para release junto con cross-tenant y cross-study
leakage.

---

## 8. Document upload and private Blob storage

`POST /api/documents/upload` accepts only PDF uploads for a `studyId` that has
already been validated with `validateStudyAccess()`. `organization_id` is
rejected if it appears in body/FormData or query params; the internal org UUID is
always derived from Clerk server-side auth.

Storage and registry rules:

- PDFs are uploaded to Vercel Blob with `access: 'private'`.
- Upload responses never expose Blob URLs or download URLs.
- PDF reads/downloads go through
  `GET /api/document-versions/[documentVersionId]/download`, which revalidates
  object access before reading private Blob.
- `documents` and `document_versions` both persist the same
  `organization_id` and `study_id` so every later read can enforce tenant
  isolation without joining through client-provided ids.
- Document status reads the latest `document_versions` row only after
  validating the `documentId` against the active org and the document study.
- `document.upload` audit logs are mandatory. If the audit insert fails, the
  upload request fails with a generic 500.

This phase keeps the existing server route handler upload pattern and enforces a
conservative 4 MiB application limit. It intentionally does not claim robust
50MB support. Supporting 50MB+ PDFs safely should move to a direct/client Blob
upload or presigned flow, with document registration after server-side
validation of the completed private blob.

---

## 9. Document ingestion

Upload and ingestion are separate security boundaries. Upload registers a
private blob and a pending `document_version`; ingestion later processes one
authorized `documentVersionId`.

Ingestion rules:

- The HTTP route validates Clerk auth and object-level access to
  `document_versions.id` before calling the internal pipeline.
- The internal pipeline receives `userId`, `orgId`, `studyId`, `documentId`, and
  `documentVersionId` from that validated context; it does not call Clerk.
- The pipeline revalidates `documents` and `document_versions` against
  `organization_id` + `study_id` before reading Blob or writing rows.
- `pages` and `chunks` persist `organization_id` and `study_id` from the
  authorized context. No page or chunk may be inserted without both boundaries.
- Chunks are embedded before a document version can become `ready`; retrieval
  and RAG remain out of scope until the retrieval layer is implemented.
- OCR is out of scope. PDFs with no extractable text are marked `error` with a
  sanitized code.
- Ingestion errors stored on `document_versions.error_message` are sanitized
  codes, never stack traces or provider internals.

---

## 10. Embeddings and vector indexing

Embeddings are generated only for chunks that already carry tenant metadata.
The indexer receives an authorized context from the HTTP-triggered ingestion
route and revalidates `documents` and `document_versions` against
`organization_id` + `study_id` before reading chunks.

Indexing rules:

- The model is `text-embedding-3-small` with 1536 dimensions, matching the
  `chunks.embedding VECTOR(1536)` schema.
- Chunks are selected with `document_id`, `document_version_id`,
  `organization_id`, `study_id`, and `embedding IS NULL`.
- Each update repeats the same object and tenant filters before writing the
  vector.
- Embedding provider failures are stored as sanitized codes:
  `embedding_provider_error`, `embedding_dimension_mismatch`,
  `embedding_rate_limited`, or `embedding_internal_error`.
- `document_versions.status = ready` means the PDF has been parsed, pages and
  chunks have been persisted, and chunks have embeddings.
- If embeddings fail, the document version remains `error` and is not
  considered searchable.
- `embeddings.started`, `embeddings.completed`, and `embeddings.failed` audit
  logs are mandatory.

No retrieval, answer generation, chat, or generated citations are exposed in
this phase.

---

## 11. Retrieval base

Retrieval is an internal module that receives `orgId` and `studyId` from an
already-authorized caller. It does not call Clerk and does not accept
`organization_id` from client input.

Retrieval rules:

- Query embeddings use the same `text-embedding-3-small` model and 1536
  dimensions as indexing.
- The pgvector query includes `chunks.organization_id = orgId` and
  `chunks.study_id = studyId` in the SQL `WHERE` clause before ordering by
  vector distance.
- The query also requires `chunks.embedding IS NOT NULL`.
- Optional filters such as `document_type` are applied in the same SQL query.
- The retriever returns chunk metadata for future citations but does not create
  answers, chat messages, or citation rows.
- Cross-org and cross-study leakage tests for retrieval are release-blocking.

---

## 12. Authenticated PDF download/preview

PDF download uses `documentVersionId` as the access unit, matching ingestion and
version status. The route validates the requested version with
`validateDocumentVersionAccess()`, which resolves the active Clerk organization
to the internal `organization_id`, filters `document_versions` by that org, then
verifies the related document and study.

Download rules:

- `organization_id` and `organizationId` in query params are rejected before
  auth or storage work.
- The route reads Blob through the stored private `blob_key` only after
  authorization succeeds.
- The HTTP response is `application/pdf` with attachment disposition and
  `Cache-Control: private, no-store`.
- The response never includes `blob_url`, `blob_key`, or Blob download URLs.
- `document.download` audit logs are mandatory and carry `organization_id`,
  `study_id`, `user_id`, `resource_type = document_version`, and
  `resource_id = documentVersionId`.

Inline preview is a future extension and must use the same authenticated,
object-authorized path or an equivalent server-controlled mechanism.

---

## 13. Answer engine

`answerEngine` is a pure module: it receives `question` and `retrievedChunks` as
input and returns a structured answer. It does not call Clerk, does not access the
database, and does not perform retrieval. All tenant isolation is delegated to the
retriever.

Logging rules:
- No full prompt text may be logged — it may contain the user's question (PHI).
- No chunk content may be logged — it may contain PHI from clinical documents.
- No LLM completion text may be logged — it may reflect PHI from document excerpts.
- Errors from the LLM provider are sanitized before propagating; raw provider
  messages are discarded. Only `AnswerEngineError` with a sanitized code surfaces.

Prompt injection:
- Document chunks are passed to the LLM as evidence, never as trusted instructions.
- The system prompt explicitly instructs the LLM to ignore any instructions or
  directives embedded in document content.
- No server-side filtering or sanitization of chunk content is performed; the
  constraint is enforced entirely at the prompt level.

Evidence integrity:
- `Evidence.documentId`, `Evidence.documentVersionId`, `Evidence.pageStart`,
  `Evidence.pageEnd`, and `Evidence.sectionTitle` are copied verbatim from the
  corresponding `RetrievedChunk`. They are never generated or inferred.
- A response with `confidence = high | medium | low` without `evidences` is
  an invariant violation. The engine degrades to `insufficient_evidence` in
  this case rather than returning an ungrounded answer.
- `Evidence.excerpt` is a truncated slice of `chunk.content` (≤ 600 chars).
  The LLM does not write or expand the excerpt.

`orgId` and `studyId` are not accepted as inputs to `answerEngine`. Attempts to
pass tenant identifiers at this layer do not affect retrieval scope; isolation
is enforced upstream in the SQL query.

---

## 14. Internal test endpoint — `/api/rag/answer-test`

`POST /api/rag/answer-test` is an internal-only route protected by a feature
flag. It is not part of the production UI surface.

This internal endpoint is rate limited by `x-internal-client-id`, `x-forwarded-for`,
or `x-real-ip` when Upstash Redis / Vercel KV REST env vars are configured.

Feature flag:
- `ENABLE_INTERNAL_RAG_ANSWER_TEST=true` must be set explicitly in the
  environment. Without it, the route returns 404.
- `NODE_ENV` alone is not a sufficient gate.

Forbidden client-controlled fields:
- `orgId`, `organizationId`, and `organization_id` are rejected from query
  params and body before any business logic runs, following the same pattern as
  `POST /api/documents/upload` and `POST /api/ingestion/run`.
- The Zod schema uses `.strict()` as an additional layer of defense.

Error handling:
- Auth failures and study access denials return 403 with the generic message
  `Study not found or access denied`. Internal codes never reach the body.
- Retrieval and LLM failures return 500 with `Internal Server Error`.
- No stack traces or provider details are exposed.

No persistence:
- This endpoint does not write to `messages`, `citations`, or `audit_logs`.
- It is intended for pipeline integration testing only.

---

## 15. Chat persistence and audit logging — `/api/chat`

`POST /api/chat` is the production chat endpoint. It persists every turn (user
question + assistant answer + citations) and writes audit logs.

Audit log rules:
- `rag.answer.requested` is written after auth/study validation and before the LLM
  call. Metadata: `documentType`, `topK`, `conversationId`. Never includes the
  question text, answer text, chunk content, prompts, or embeddings.
- `rag.answer.completed` is written after persistence succeeds. Metadata:
  `confidence`, `evidenceCount`, `retrievalCount`.
- `rag.answer.failed` is written when the wrapper or persistence fails. Metadata:
  a sanitized error code string (`wrapper_error`, `persistence_error`). Never
  includes raw error messages, stack traces, or provider details.
- `rag.answer.*` audit log writes are mandatory. If an audit row cannot be
  written, the route returns a generic 500 rather than presenting an unaudited
  chat success.
- `/api/chat` is rate limited by `userId + studyId` with a 20 requests/minute
  sliding window when Upstash Redis / Vercel KV REST env vars are configured.
  Limited requests return 429 with `Retry-After`.

Citation integrity rules:
- Citations are derived exclusively from `evidences` returned by `generateAnswerForStudy`.
  They are never reconstructed after the fact.
- Document metadata (`documentName`, `documentType`) is fetched inside the same DB
  transaction that inserts citations. If a document is not found, the transaction
  rolls back — no partial citation writes.
- `pageStart` and `pageEnd` are asserted non-null before insert. A null value
  triggers a transaction rollback.

Conversation security:
- `orgId` is always resolved from the Clerk token. It is never accepted from the
  body or query params.
- When `conversationId` is provided by the client, it is validated against three
  fields: `organizationId = orgId`, `studyId`, and `userId`. All three must match.
  A mismatch returns 404 (not 403) to avoid enumeration leakage.

Error handling:
- All internal errors (auth, persistence, LLM) return generic HTTP responses. No
  stack traces, provider details, or internal codes reach the client.
- No partial success: if `persistAssistantMessageAndCitations` fails, the route
  returns 500 and the client sees an error rather than a response that appears
  successful but has no citations.

---

## 16. Read-only history and citations endpoints — `/api/conversations*`

`GET /api/conversations`, `GET /api/conversations/[conversationId]/messages`, and
`GET /api/citations/[messageId]` are read-only endpoints exposing chat history and
evidence with strict authorization and no data leakage.

Authorization chain:

1. **Conversations list** — `/api/conversations?studyId=...`
   - Validates `studyId` against active org (validateStudyAccess)
   - Filters by `organizationId + studyId + userId` in SQL
   - Returns only conversations owned by the active user within the active org/study

2. **Messages from conversation** — `/api/conversations/[conversationId]/messages`
   - Validates conversation ownership: `organizationId + studyId + userId` all match
   - Uses `validateConversationAccess` to check three-field security boundary
   - Filters messages by `conversationId + organizationId + studyId` in SQL
   - Returns messages in ascending `createdAt` order (conversation natural order)

3. **Citations from message** — `/api/citations/[messageId]`
   - Validates message ownership via message table lookup (validateMessageAccess)
   - Additional check: conversation table lookup ensures `userId` matches conversation owner
   - Security: the chain `messageId → conversationId → userId` is validated explicitly
   - Filters citations by `messageId + organizationId + studyId` in SQL
   - Writes mandatory `citation.view` audit log before returning citations

Query filtering:
- All filtering applied in SQL before returning to client — no in-memory filtering
- `orgId` never accepted from body or query params — always from Clerk token
- `studyId` validated against active org before any data query
- `userId` implicitly from Clerk — never from client params

Response shape:
- No `orgId`, `organizationId`, or `userId` fields exposed
- No embeddings, full chunks, or raw prompts
- Citation excerpts present (bounded text, not full chunk content)
- Conversation list ordered by `updatedAt` descending (most recent first)

Error handling:
- Auth failures → 401/403 with generic message
- Invalid studyId/conversationId/messageId → 400 (validation) or 404 (not found/access denied)
- DB errors → 500 generic, no stack trace
- Missing resource across org/study/user boundary → 404 (not 403 to prevent enumeration)

---

## 17. Rate limiting and structured observability

All five production API endpoints enforce a per-user sliding window rate limit via
Upstash Redis REST API. Rate limit keys are built server-side from Clerk-resolved
identifiers; `organizationId` is never accepted from the client.

Rate limiting:
- Implementation: Redis sliding window (Lua EVAL), `apps/web/lib/security/rate-limit.ts`
- Fail-open: when Redis is unavailable, requests are allowed (not blocked)
- `RATE_LIMIT_ENABLED=false` disables rate limiting for tests and local development
- 429 response body is always `{ "error": "rate_limited", "message": "Too many requests, please try again later." }`
- `Retry-After` header is included; no other quota headers are exposed to clients
- Rate limiting does not reveal resource existence — blocked requests return the same 429 shape for any key

Structured logging (`apps/web/lib/observability/logger.ts`):
- All log records are emitted as `console.log(JSON.stringify(record))`
- `requestId` is taken from `x-request-id` or `x-correlation-id` header (≤128 chars), or generated via `crypto.randomUUID()`
- Allowed fields: `requestId`, `timestamp`, `level`, `event`, `endpoint`, `method`, `userId`, `organizationId`, `studyId`, `conversationId`, `messageId`, `documentId`, `documentVersionId`, `statusCode`, `durationMs`, `errorCode`

Fields **never** logged (PHI and secrets protection):
- `prompt`, `question`, `answer` — may contain PHI
- `documentContent`, `content`, `chunks`, `excerpt` — clinical document text
- `embedding` — vector data
- `authorization`, `cookie`, `token`, `secret`, `password` — credentials
- `rawBody`, `formData` — unstructured payloads
- Stack traces are never included in client responses
