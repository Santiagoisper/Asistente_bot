import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPromptCachingEnabled, withAnthropicPromptCache } from '../anthropic-cache'

afterEach(() => {
  vi.unstubAllEnvs()
})

const RESPONSE = new Response('{}', { status: 200 })

function lastBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)
  return JSON.parse((call?.[1] as RequestInit).body as string) as Record<string, unknown>
}

describe('isPromptCachingEnabled', () => {
  it('default: activado', () => {
    expect(isPromptCachingEnabled()).toBe(true)
  })

  it('ANTHROPIC_PROMPT_CACHING=0 lo apaga', () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHING', '0')
    expect(isPromptCachingEnabled()).toBe(false)
  })

  it('ANTHROPIC_PROMPT_CACHING=false lo apaga', () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHING', 'false')
    expect(isPromptCachingEnabled()).toBe(false)
  })
})

describe('withAnthropicPromptCache — inyecta cache_control en el system de /v1/messages', () => {
  it('system string → array de un block con cache_control ephemeral', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESPONSE)
    const wrapped = withAnthropicPromptCache(fetchMock as unknown as typeof fetch)
    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ model: 'claude-sonnet-5-5', system: 'SYSTEM LARGO', messages: [] }),
    })
    expect(lastBody(fetchMock).system).toEqual([
      { type: 'text', text: 'SYSTEM LARGO', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('system array → agrega cache_control al último block que no lo tenga', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESPONSE)
    const wrapped = withAnthropicPromptCache(fetchMock as unknown as typeof fetch)
    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({
        system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
        messages: [],
      }),
    })
    const system = lastBody(fetchMock).system as Array<Record<string, unknown>>
    expect(system[0]?.cache_control).toBeUndefined()
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('no pisa un cache_control existente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESPONSE)
    const wrapped = withAnthropicPromptCache(fetchMock as unknown as typeof fetch)
    const existing = { type: 'text', text: 'a', cache_control: { type: 'ephemeral', ttl: '1h' } }
    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ system: [existing], messages: [] }),
    })
    const system = lastBody(fetchMock).system as Array<Record<string, unknown>>
    expect(system[0]).toEqual(existing)
  })

  it('URL que no es /v1/messages pasa intacta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESPONSE)
    const wrapped = withAnthropicPromptCache(fetchMock as unknown as typeof fetch)
    const body = JSON.stringify({ system: 'SYSTEM', messages: [] })
    await wrapped('https://api.anthropic.com/v1/complete', {
      method: 'POST',
      headers: {},
      body,
    })
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(body)
  })

  it('body no-JSON pasa intacto (fail-open, nunca rompe la llamada)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESPONSE)
    const wrapped = withAnthropicPromptCache(fetchMock as unknown as typeof fetch)
    await wrapped('https://api.anthropic.com/v1/messages', { method: 'POST', headers: {}, body: 'no-json' })
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe('no-json')
  })

  it('con el feature apagado no transforma el body', async () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHING', '0')
    const fetchMock = vi.fn().mockResolvedValue(RESPONSE)
    const wrapped = withAnthropicPromptCache(fetchMock as unknown as typeof fetch)
    const body = JSON.stringify({ system: 'SYSTEM', messages: [] })
    await wrapped('https://api.anthropic.com/v1/messages', { method: 'POST', headers: {}, body })
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(body)
  })
})
