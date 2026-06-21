export type LogLevel = 'info' | 'warn' | 'error'

export type LogEventName =
  | 'api.request.started'
  | 'api.request.completed'
  | 'api.request.failed'
  | 'api.rate_limit.allowed'
  | 'api.rate_limit.blocked'
  | 'api.validation_error'
  | 'api.internal_error'

export interface LogRecord {
  requestId: string
  timestamp: string
  level: LogLevel
  event: LogEventName
  endpoint: string
  method: string
  userId?: string
  organizationId?: string
  studyId?: string
  conversationId?: string
  messageId?: string
  documentId?: string
  documentVersionId?: string
  statusCode?: number
  durationMs?: number
  errorCode?: string
}

// Fields whose values must never appear in log output — PHI, secrets, raw content.
const FORBIDDEN_FIELDS = new Set([
  'prompt',
  'answer',
  'question',
  'documentcontent',
  'content',
  'embedding',
  'authorization',
  'cookie',
  'token',
  'secret',
  'password',
  'rawbody',
  'formdata',
  'chunks',
  'excerpt',
])

export function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!FORBIDDEN_FIELDS.has(key.toLowerCase())) {
      safe[key] = value
    }
  }
  return safe
}

export function getOrCreateRequestId(req: Request): string {
  const fromHeader =
    req.headers.get('x-request-id')?.trim() ||
    req.headers.get('x-correlation-id')?.trim()
  if (fromHeader && fromHeader.length > 0 && fromHeader.length <= 128) {
    return fromHeader
  }
  return crypto.randomUUID()
}

export function log(record: LogRecord): void {
  // Sanitize as a safety net — LogRecord type already excludes forbidden fields.
  const safe = sanitizeRecord(record as unknown as Record<string, unknown>)
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ...safe, timestamp: record.timestamp }))
}

export function makeRecord(
  base: Omit<LogRecord, 'timestamp'>,
): LogRecord {
  return { ...base, timestamp: new Date().toISOString() }
}
