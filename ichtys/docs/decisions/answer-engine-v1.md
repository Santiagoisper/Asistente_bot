# Answer Engine v1 — Decision Record

## Decision

Phase 7 implements `answerEngine`, a pure function that produces a grounded answer
using exclusively the chunks passed to it. It does not retrieve, does not call auth,
and does not make HTTP requests.

## Contract

`answerEngine()` receives:

- `question: string` — the user's question in any language
- `retrievedChunks: RetrievedChunk[]` — chunks already retrieved and tenant-filtered
  by the caller (retriever or test fixture)

It returns:

- `answer: string` — response in the same language as the question
- `confidence: Confidence` — `high | medium | low | insufficient_evidence`
- `evidences: Evidence[]` — metadata derived from the chunks cited by the LLM

`generateAnswer()` remains as the orchestrating entry point that calls
`retrieveRelevantChunks()` and then `answerEngine()`.

## Evidence invariants

1. Every `Evidence` is derived from a `RetrievedChunk` received as input.
   `documentId`, `documentVersionId`, `pageStart`, `pageEnd`, and `sectionTitle`
   are copied verbatim — never generated, inferred, or hallucinated.
2. `excerpt` is a truncated slice of `chunk.content` (max 600 chars at word boundary).
   The LLM never writes or expands the excerpt; it only selects which chunks to cite.
3. `evidences` is empty if and only if `confidence = "insufficient_evidence"`.
   Responses with `high | medium | low` confidence without evidences are degraded
   to `insufficient_evidence` before returning.
4. Evidence births with the response (rule 6 of the spec): `extractEvidences()`
   runs on the `citationIndices` returned by the same LLM call, not on a
   post-processing step.

## Threshold and fallback

Chunks with `similarityScore < MIN_SIMILARITY_THRESHOLD (0.75)` are excluded
before `assessEvidence()`. If the resulting list is empty, `answerEngine` returns
`insufficient_evidence` immediately without calling the LLM.

If the LLM returns `citationIndices` that map to zero valid chunks (out-of-bounds
or all filtered by deduplication), the response is also degraded to
`insufficient_evidence`.

## LLM integration

Provider: Anthropic via `@ai-sdk/anthropic` + `generateObject()` from the Vercel
AI SDK. The model is selected from `process.env.ANSWER_MODEL` with fallback to
`claude-sonnet-4-6`. No new provider dependency was added; both packages were
already declared in `packages/rag/package.json`.

`generateObject()` is used (not `streamText`) to enforce structured output at the
schema level (`answerSchema`). Streaming is out of scope for Phase 7 and left to
the chat route in a future phase.

## Prompt injection guard

The system prompt explicitly states that document excerpts are **evidence only**
and that any instructions embedded in document content must be ignored. This is
enforced at the prompt level; no runtime parsing of chunk content is performed.

## Language

The system prompt instructs the LLM to respond in the same language as the
question. Excerpts are passed in their original language regardless of the
question language.

## Error sanitization

LLM provider errors are caught and wrapped in `AnswerEngineError` before
propagating. The original error message (which may contain API keys, raw prompt
fragments, or provider internals) is discarded. Only a sanitized code and a
generic message are returned:

- `llm_rate_limited` — HTTP 429
- `llm_provider_error` — all other provider failures

## Logging

No full prompts, no chunk content, no question text, and no PHI are logged.
`answer-engine.ts` calls no logging primitives directly.

## Tenant isolation

`answerEngine` does not receive `orgId` or `studyId`. Tenant isolation is
delegated entirely to the retriever, which enforces `organization_id` + `study_id`
filters in the SQL WHERE clause before ordering by vector distance.

## Out of scope

- streaming (left to the chat route)
- citation persistence in the database (`conversations`, `messages`, `citations`)
- reranking
- hybrid search
- chat route integration (Phase 8)
