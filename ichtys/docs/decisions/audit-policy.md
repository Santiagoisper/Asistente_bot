# Audit Policy

## Decision

Audit writes are split into two categories:

- Mandatory: the request must fail with a generic 500 if the audit row cannot be written.
- Best-effort: the audit failure is logged with a sanitized code and the primary request may continue.

## Mandatory Events

- `document.upload`: mandatory inside the upload transaction.
- `document.download`: mandatory before serving the private PDF response.
- `rag.answer.requested`: mandatory before retrieval/LLM work starts.
- `rag.answer.completed`: mandatory after assistant message and citations are persisted.
- `rag.answer.failed`: mandatory when answer generation fails after the request is accepted.
- `citation.view`: mandatory before returning citations to the client.
- `ingestion.started`, `ingestion.completed`, `ingestion.failed`: mandatory in the ingestion pipeline.
- `embeddings.started`, `embeddings.completed`, `embeddings.failed`: mandatory in indexing.

## Best-Effort Events

`safeWriteAuditLog` remains available only for explicitly non-critical future events.
It must not be used for regulated document access, answer generation, citation reads,
or ingestion/indexing state transitions.

## Failure Behavior

Mandatory audit failures return `Internal Server Error` without stack traces, DB details,
question text, answers, excerpts, prompts, chunks, tokens, or connection strings.

For `/api/chat`, this means an answer may be generated only after
`rag.answer.requested` has been written. If `rag.answer.completed` cannot be written,
the route returns 500 rather than presenting an unaudited success to the user.
