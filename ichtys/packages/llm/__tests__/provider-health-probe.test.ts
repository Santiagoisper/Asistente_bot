import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkProviderHealth, fetchOpenAiUsageSummary, redactProviderMessage } from '../provider-health'

/**
 * «Probar proveedores» en Ajustes (auditoría 19/11, H-10 y H-18): sin clave no se llama a
 * nadie; la respuesta del proveedor se clasifica; y el texto que vuelve a la pantalla nunca
 * repite una clave.
 */
const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
  vi.stubEnv('GOOGLE_API_KEY', '')
  vi.stubEnv('GROQ_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const reply = (status: number, body = '') => new Response(body, { status })

describe('checkProviderHealth', () => {
  it('sin clave: not_configured y no se llama a la red', async () => {
    const r = await checkProviderHealth('anthropic', null)
    expect(r).toMatchObject({ provider: 'anthropic', status: 'not_configured', modelId: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con la clave de la organización: ok, y la clave va solo en el encabezado', async () => {
    fetchMock.mockResolvedValue(reply(200, '{}'))
    const r = await checkProviderHealth('anthropic', { anthropic: 'sk-ant-de-la-org-1234567890' })
    expect(r.status).toBe('ok')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-ant-de-la-org-1234567890')
  })

  it.each([
    [429, 'rate limit exceeded', 'quota_exceeded'],
    [400, 'insufficient_quota', 'quota_exceeded'],
    [401, 'invalid x-api-key', 'invalid_key'],
    [500, 'upstream exploded', 'error'],
  ])('HTTP %i (%s): %s', async (status, body, expected) => {
    fetchMock.mockResolvedValue(reply(status, body))
    expect((await checkProviderHealth('openai', { openai: 'sk-proj-abcdef123456' })).status).toBe(expected)
  })

  it('el mensaje que vuelve a Ajustes no repite la clave aunque el proveedor la cite', async () => {
    fetchMock.mockResolvedValue(reply(401, 'Incorrect API key provided: sk-proj-abcdEFGH1234****wxyz. You can find your API key'))
    const r = await checkProviderHealth('openai', { openai: 'sk-proj-abcdEFGH1234zzzzwxyz' })
    expect(r.status).toBe('invalid_key')
    expect(r.message).not.toMatch(/abcdEFGH|wxyz/)
    expect(r.message).toContain('sk-proj-[clave]')
  })

  it('una caída de red se informa como error, sin tirar la pantalla', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    expect(await checkProviderHealth('groq', { groq: 'gsk_1234567890abcdef' })).toMatchObject({ status: 'error', message: 'fetch failed' })
  })
})

describe('redactProviderMessage', () => {
  it.each([
    ['clave de Google en una URL', 'GET https://x/models?key=AIzaSyA-123_456&alt=json', 'key=[clave]'],
    ['clave de Groq', 'bad key gsk_ABCDEFGH12345678', 'gsk_[clave]'],
    ['clave de Anthropic', 'x-api-key sk-ant-api03-AAAA-BBBB', 'sk-ant-[clave]'],
  ])('%s', (_n, text, expected) => {
    expect(redactProviderMessage(text)).toContain(expected)
  })
  it('un texto sin claves no cambia', () => {
    expect(redactProviderMessage('rate limit exceeded')).toBe('rate limit exceeded')
  })
})

describe('fetchOpenAiUsageSummary', () => {
  it('suma el gasto de todos los tramos del mes', async () => {
    fetchMock.mockResolvedValue(reply(200, JSON.stringify({ data: [{ results: [{ amount: { value: 1.5 } }, { amount: { value: 2 } }] }, { results: [{}] }] })))
    expect(await fetchOpenAiUsageSummary('sk-proj-x')).toMatchObject({ available: true, monthToDateUsd: 3.5 })
  })
  it('sin permiso para leer costos: no disponible, con el código', async () => {
    fetchMock.mockResolvedValue(reply(403, 'forbidden'))
    expect(await fetchOpenAiUsageSummary('sk-proj-x')).toMatchObject({ available: false, monthToDateUsd: null, message: expect.stringContaining('403') })
  })
  it('un error de red no muestra la clave', async () => {
    fetchMock.mockRejectedValue(new Error('boom with sk-proj-SECRETO123456'))
    const r = await fetchOpenAiUsageSummary('sk-proj-SECRETO123456')
    expect(r.message).not.toContain('SECRETO')
  })
})
