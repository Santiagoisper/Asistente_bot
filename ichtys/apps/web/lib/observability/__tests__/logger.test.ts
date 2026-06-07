import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateRequestId, log, makeRecord, sanitizeRecord } from '../logger'

describe('logger', () => {
  describe('getOrCreateRequestId', () => {
    it('generates a new requestId when no header is present', () => {
      const req = new Request('http://localhost')
      const id = getOrCreateRequestId(req)
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('preserves x-request-id header when present', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-request-id': 'my-trace-id-123' },
      })
      expect(getOrCreateRequestId(req)).toBe('my-trace-id-123')
    })

    it('preserves x-correlation-id header when present', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-correlation-id': 'corr-abc-456' },
      })
      expect(getOrCreateRequestId(req)).toBe('corr-abc-456')
    })

    it('prefers x-request-id over x-correlation-id', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-request-id': 'req-id', 'x-correlation-id': 'corr-id' },
      })
      expect(getOrCreateRequestId(req)).toBe('req-id')
    })

    it('generates new id when header value is empty', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-request-id': '   ' },
      })
      const id = getOrCreateRequestId(req)
      expect(id).not.toBe('')
      expect(id.trim()).toBeTruthy()
    })

    it('generates new id when header value exceeds 128 chars', () => {
      const long = 'a'.repeat(129)
      const req = new Request('http://localhost', {
        headers: { 'x-request-id': long },
      })
      const id = getOrCreateRequestId(req)
      expect(id).not.toBe(long)
    })
  })

  describe('sanitizeRecord', () => {
    it('passes through safe fields', () => {
      const record = { requestId: 'abc', statusCode: 200, endpoint: '/api/chat' }
      expect(sanitizeRecord(record)).toEqual(record)
    })

    it('removes forbidden fields', () => {
      const record = {
        requestId: 'abc',
        prompt: 'patient has condition X',
        answer: 'based on section 4.2...',
        question: 'what is the dose?',
        documentContent: 'full document text here',
        embedding: [0.1, 0.2],
        authorization: 'Bearer secret-token',
        cookie: 'session=abc',
        token: 'jwt-value',
        secret: 'api-key',
        password: 'hunter2',
        rawBody: '{"raw": "data"}',
        formData: 'multipart',
        chunks: ['chunk1'],
        excerpt: 'clinical excerpt text',
      }
      const safe = sanitizeRecord(record)
      expect(safe).not.toHaveProperty('prompt')
      expect(safe).not.toHaveProperty('answer')
      expect(safe).not.toHaveProperty('question')
      expect(safe).not.toHaveProperty('documentContent')
      expect(safe).not.toHaveProperty('embedding')
      expect(safe).not.toHaveProperty('authorization')
      expect(safe).not.toHaveProperty('cookie')
      expect(safe).not.toHaveProperty('token')
      expect(safe).not.toHaveProperty('secret')
      expect(safe).not.toHaveProperty('password')
      expect(safe).not.toHaveProperty('rawBody')
      expect(safe).not.toHaveProperty('formData')
      expect(safe).not.toHaveProperty('chunks')
      expect(safe).not.toHaveProperty('excerpt')
      expect(safe).toHaveProperty('requestId', 'abc')
    })
  })

  describe('log', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('outputs valid JSON to console.log', () => {
      const record = makeRecord({
        requestId: 'test-id',
        level: 'info',
        event: 'api.request.started',
        endpoint: '/api/chat',
        method: 'POST',
      })
      log(record)

      expect(console.log).toHaveBeenCalledOnce()
      const [arg] = (console.log as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      const parsed = JSON.parse(arg) as Record<string, unknown>
      expect(parsed).toHaveProperty('requestId', 'test-id')
      expect(parsed).toHaveProperty('level', 'info')
      expect(parsed).toHaveProperty('event', 'api.request.started')
      expect(parsed).toHaveProperty('endpoint', '/api/chat')
      expect(parsed).toHaveProperty('method', 'POST')
      expect(parsed).toHaveProperty('timestamp')
    })

    it('log record includes all expected safe fields', () => {
      const record = makeRecord({
        requestId: 'r1',
        level: 'warn',
        event: 'api.rate_limit.blocked',
        endpoint: '/api/documents/upload',
        method: 'POST',
        userId: 'user_123',
        organizationId: 'org_456',
        studyId: 'study-uuid',
        statusCode: 429,
        durationMs: 42,
        errorCode: 'rate_limited',
      })
      log(record)

      const [arg] = (console.log as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
      const parsed = JSON.parse(arg) as Record<string, unknown>
      expect(parsed).toHaveProperty('userId', 'user_123')
      expect(parsed).toHaveProperty('organizationId', 'org_456')
      expect(parsed).toHaveProperty('studyId', 'study-uuid')
      expect(parsed).toHaveProperty('statusCode', 429)
      expect(parsed).toHaveProperty('durationMs', 42)
      expect(parsed).toHaveProperty('errorCode', 'rate_limited')
    })
  })

  describe('makeRecord', () => {
    it('adds ISO timestamp', () => {
      const record = makeRecord({
        requestId: 'r1',
        level: 'info',
        event: 'api.request.completed',
        endpoint: '/api/conversations',
        method: 'GET',
      })
      expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })
})
