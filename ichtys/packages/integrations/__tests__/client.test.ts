import { generateKeyPairSync } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearSummaryCache, fetchModuleSummary, SUMMARY_MAX_BYTES } from '../client'
import { verifyOsToken } from '../token'

const pair = generateKeyPairSync('ed25519')
const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const validSummary = {
  module: 'queries',
  generatedAt: '2026-11-10T12:00:00.000Z',
  counters: [{ key: 'open_queries', label: 'Queries abiertas', value: 18, unit: 'count' }],
  alerts: [
    {
      id: 'Q-2756',
      severity: 'high',
      title: 'Query vencida',
      detail: 'Respuesta pendiente desde hace 3 días (SUJ-1008).',
      href: 'https://queries.example.test/casos/Q-2756',
    },
  ],
  openHref: 'https://queries.example.test/',
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void
let server: Server
let handler: Handler
let hits: number
let baseUrl: string
const ctx = { userId: 'user_1', orgId: 'org_1' }

function env(overrides: Record<string, string | undefined> = {}) {
  return { OS_QUERIES_URL: baseUrl, OS_SIGNING_PRIVATE_KEY: privateKeyPem, ...overrides }
}

function json(body: unknown, status = 200): Handler {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
}

beforeEach(async () => {
  clearSummaryCache()
  hits = 0
  handler = json(validSummary)
  server = createServer((req, res) => {
    hits += 1
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('fetchModuleSummary', () => {
  it('respuesta válida: estado ok, con token verificable y ruta del contrato', async () => {
    let seenAuth = ''
    let seenPath = ''
    handler = (req, res) => {
      seenAuth = req.headers.authorization ?? ''
      seenPath = req.url ?? ''
      json(validSummary)(req, res)
    }
    const result = await fetchModuleSummary('queries', ctx, { env: env() })
    expect(result.status).toBe('ok')
    expect(result.summary?.counters[0]?.value).toBe(18)
    expect(seenPath).toBe('/api/os/summary')
    const claims = verifyOsToken(seenAuth.replace(/^Bearer /, ''), { module: 'queries', publicKeyPem })
    expect(claims).toMatchObject({ sub: 'user_1', org: 'org_1', aud: 'queries' })
  })

  it('sin URL, sin clave o con clave inválida: not_configured y no sale ningún pedido', async () => {
    expect((await fetchModuleSummary('queries', ctx, { env: env({ OS_QUERIES_URL: undefined }) })).status).toBe('not_configured')
    expect((await fetchModuleSummary('queries', ctx, { env: env({ OS_SIGNING_PRIVATE_KEY: undefined }) })).status).toBe('not_configured')
    expect((await fetchModuleSummary('queries', ctx, { env: env({ OS_SIGNING_PRIVATE_KEY: 'basura' }) })).status).toBe('not_configured')
    expect(hits).toBe(0)
  })

  it('URL http que no es local, o con credenciales embebidas: not_configured', async () => {
    expect((await fetchModuleSummary('queries', ctx, { env: env({ OS_QUERIES_URL: 'http://queries.example.test' }) })).status).toBe('not_configured')
    expect((await fetchModuleSummary('queries', ctx, { env: env({ OS_QUERIES_URL: 'https://u:p@queries.example.test' }) })).status).toBe('not_configured')
    expect((await fetchModuleSummary('queries', ctx, { env: env({ OS_QUERIES_URL: 'no es una url' }) })).status).toBe('not_configured')
  })

  it('401 y 403: unauthorized', async () => {
    handler = json({ error: 'no' }, 401)
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('unauthorized')
    handler = json({ error: 'no' }, 403)
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('unauthorized')
  })

  it('500: unreachable', async () => {
    handler = json({ error: 'boom' }, 500)
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('unreachable')
  })

  it('conexión rechazada: unreachable', async () => {
    const result = await fetchModuleSummary('queries', ctx, { env: env({ OS_QUERIES_URL: 'http://127.0.0.1:1' }) })
    expect(result.status).toBe('unreachable')
  })

  it('satélite que no responde a tiempo: unreachable, sin colgar al que llama', async () => {
    handler = () => {
      /* nunca responde */
    }
    const started = Date.now()
    const result = await fetchModuleSummary('queries', ctx, { env: env(), timeoutMs: 150 })
    expect(result.status).toBe('unreachable')
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('redirección: unreachable (el token no se reenvía a otro destino)', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'https://otro.example.test/' })
      res.end()
    }
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('unreachable')
  })

  it('cuerpo que no es JSON, forma inválida o módulo ajeno: invalid_response', async () => {
    handler = json('<html>hola</html>')
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('invalid_response')
    handler = json({ ...validSummary, counters: [{ key: 'x', label: 'X', value: 'dieciocho', unit: 'count' }] })
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('invalid_response')
    handler = json({ ...validSummary, module: 'viaticos' })
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('invalid_response')
    handler = json({ ...validSummary, paciente: 'nombre que no debería viajar' })
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('invalid_response')
  })

  it('enlace que no es http(s): invalid_response', async () => {
    handler = json({ ...validSummary, openHref: 'javascript:alert(1)' })
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('invalid_response')
  })

  it('cuerpo más grande que el tope: invalid_response', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' })
      res.end(JSON.stringify({ ...validSummary, relleno: 'x'.repeat(SUMMARY_MAX_BYTES + 10) }))
    }
    expect((await fetchModuleSummary('queries', ctx, { env: env() })).status).toBe('invalid_response')
  })

  it('una respuesta ok se guarda 60 s por usuario; un error no se guarda', async () => {
    let clock = new Date('2026-11-10T12:00:00.000Z')
    const deps = { env: env(), now: () => clock }
    await fetchModuleSummary('queries', ctx, deps)
    await fetchModuleSummary('queries', ctx, deps)
    expect(hits).toBe(1)

    await fetchModuleSummary('queries', { ...ctx, userId: 'user_2' }, deps)
    expect(hits).toBe(2)

    clock = new Date(clock.getTime() + 61_000)
    await fetchModuleSummary('queries', ctx, deps)
    expect(hits).toBe(3)

    clearSummaryCache()
    handler = json({ error: 'boom' }, 500)
    await fetchModuleSummary('queries', ctx, deps)
    handler = json(validSummary)
    expect((await fetchModuleSummary('queries', ctx, deps)).status).toBe('ok')
  })
})
