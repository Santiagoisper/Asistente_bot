# ADR — Rate Limiting and Structured Observability

**Status:** Accepted  
**Date:** 2026-06-07  
**Phase:** 9.x

---

## Objective

Add effective rate limiting and minimal structured observability to the five production API endpoints without touching RAG, retrieval, answer engine, ingestion, or UI. Provide a machine-readable audit trail for operational monitoring while maintaining strict PHI/secrets protection.

---

## Endpoints covered

| Endpoint | Method | Rate limit key | Default limit |
|---|---|---|---|
| `/api/chat` | POST | `chat:{userId}:{studyId}` | 30 req/min |
| `/api/documents/upload` | POST | `upload:{userId}:{orgId}` | 10 req/min |
| `/api/conversations` | GET | `history:{userId}:{orgId}` | 100 req/min |
| `/api/conversations/[id]/messages` | GET | `history:{userId}:{orgId}` | 100 req/min |
| `/api/citations/[messageId]` | GET | `citations:{userId}:{orgId}` | 100 req/min |

All rate limit keys are built server-side from Clerk-resolved identifiers. `organizationId` and `userId` are never accepted from the client.

---

## Rate limiter decision

**Chosen:** Extend the existing sliding window implementation in `apps/web/lib/security/rate-limit.ts` using Upstash Redis REST API (Lua EVAL).

**Why:** Infrastructure already existed (Upstash Redis REST env vars were already wired for the internal answer-test endpoint). No new dependencies introduced.

**Fail-open design:** When Redis is not configured or returns an error, `enforceSlidingWindowRateLimit` returns `{ limited: false }`. This prevents Redis outages from blocking production traffic, at the cost of rate limiting being ineffective during outages.

**In-memory limitation:** The sliding window state lives entirely in Redis. There is no in-memory fallback counter. If Redis is unavailable, no counting occurs.

**RATE_LIMIT_ENABLED=false:** Bypasses rate limiting entirely without touching Redis. Intended for test environments and local development.

---

## Configurable limits via env vars

| Env var | Default | Endpoint(s) |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | All endpoints |
| `RATE_LIMIT_CHAT_PER_MINUTE` | `30` | `/api/chat` |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | `10` | `/api/documents/upload` |
| `RATE_LIMIT_HISTORY_PER_MINUTE` | `100` | `/api/conversations` + messages |
| `RATE_LIMIT_CITATIONS_PER_MINUTE` | `100` | `/api/citations/[messageId]` |

Non-positive integer values fall back to the documented defaults.

---

## 429 response format

All rate-limited responses return:

```json
{ "error": "rate_limited", "message": "Too many requests, please try again later." }
```

With HTTP header `Retry-After: <seconds>`. No information about the specific limit or remaining quota is exposed to avoid timing-based user enumeration.

---

## Logging format

Logs are emitted as `console.log(JSON.stringify(logRecord))`, compatible with any structured log collector (Vercel Logs, Datadog, CloudWatch, etc.).

### Log events

| Event | When |
|---|---|
| `api.request.started` | First line of every handler, before auth |
| `api.request.completed` | Before the success response return |
| `api.request.failed` | In every catch/error handler |
| `api.rate_limit.blocked` | When rate limit denies a request |

### Allowed log fields

`requestId`, `timestamp`, `level`, `event`, `endpoint`, `method`, `userId`, `organizationId`, `studyId`, `conversationId`, `messageId`, `documentId`, `documentVersionId`, `statusCode`, `durationMs`, `errorCode`

### requestId / correlationId

The `requestId` is taken from the `x-request-id` or `x-correlation-id` request header if present and ≤128 chars; otherwise generated via `crypto.randomUUID()`. This allows distributed tracing correlation with upstream systems.

---

## Security constraints (non-negotiable)

The following fields are **never** logged. The sanitizer in `logger.ts` enforces this as a runtime safety net in addition to the type system:

- `prompt`, `question`, `answer` — may contain PHI from user questions and LLM responses
- `documentContent`, `content`, `chunks`, `excerpt` — clinical document text (PHI)
- `embedding` — vector data from document chunks
- `authorization`, `cookie`, `token`, `secret`, `password` — credentials and secrets
- `rawBody`, `formData` — unstructured request payloads

Stack traces are never included in client responses (existing behavior unchanged).

---

## Future considerations

- Redis `remaining` counter: the current Lua script returns `{1, 0}` for allowed requests. To expose `X-RateLimit-Remaining`, the script would need to return the current ZCARD. Deferred — headers are optional per this spec.
- Per-study limits: the chat endpoint already uses `userId + studyId` as the key, giving per-study granularity. Other endpoints use `userId + orgId` for org-level limits.
- Distributed tracing: `requestId` is the seed for future OpenTelemetry span propagation.
