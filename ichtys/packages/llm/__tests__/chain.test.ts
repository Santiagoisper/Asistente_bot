import { describe, expect, it } from 'vitest'
import { AUTO_PROVIDER_CHAIN, PATIENT_DATA_PURPOSES, PROVIDERS_BY_PURPOSE, type LlmPurpose } from '../types'
import { getDefaultProviderPreference, isOpenAiConfigured, resolveProviderChain } from '../provider'

describe('LLM provider chain', () => {
  it('AUTO_PROVIDER_CHAIN es un solo proveedor: no hay respaldo entre proveedores', () => {
    expect(AUTO_PROVIDER_CHAIN).toEqual(['anthropic'])
  })

  it('isProviderConfigured respects org keys over env', () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    expect(isOpenAiConfigured({ openai: 'sk-org-only-12345678' })).toBe(true)
    expect(isOpenAiConfigured({})).toBe(false)
    process.env.OPENAI_API_KEY = prev
  })
})

describe('resolveKeyForProvider', () => {
  it('prefers org openai key', async () => {
    const { resolveKeyForProvider } = await import('../keys')
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-env-12345678'
    expect(resolveKeyForProvider('openai', { openai: 'sk-org-12345678' })).toBe('sk-org-12345678')
    process.env.OPENAI_API_KEY = prev
  })
})

describe('resolveProviderChain — Anthropic primario (anti-cuelgue de 300 s)', () => {
  it('preferencia explícita anthropic queda como cadena de 1', () => {
    expect(resolveProviderChain('anthropic')).toEqual(['anthropic'])
  })

  it('toda preferencia explícita no-auto es cadena de 1 sin respaldo', () => {
    for (const pref of ['anthropic', 'openai', 'google', 'groq'] as const) {
      expect(resolveProviderChain(pref)).toEqual([pref])
    }
  })

  it("'auto' devuelve los proveedores aprobados para esa clase de dato", () => {
    expect(resolveProviderChain('auto')).toEqual(['anthropic'])
    for (const purpose of Object.keys(PROVIDERS_BY_PURPOSE) as LlmPurpose[]) {
      expect(resolveProviderChain('auto', purpose)).toEqual([...PROVIDERS_BY_PURPOSE[purpose]])
    }
  })

  it('LLM_PROVIDER=glm legado (el que colgó prod) → default anthropic, GLM no revive', () => {
    const prev = process.env.LLM_PROVIDER
    process.env.LLM_PROVIDER = 'glm'
    expect(getDefaultProviderPreference()).toBe('anthropic')
    process.env.LLM_PROVIDER = prev
  })

  it('sin preferencia, default auto (cadena completa con anthropic primero)', () => {
    const prev = process.env.LLM_PROVIDER
    delete process.env.LLM_PROVIDER
    expect(getDefaultProviderPreference()).toBe('auto')
    process.env.LLM_PROVIDER = prev
  })
})

describe('destino por clase de dato', () => {
  // Esta tabla es lo que la página de confianza publica. Ampliarla es agregar
  // un destino para datos del centro: se cambia acá a propósito, junto con la
  // página y el registro de proveedores, nunca como efecto de otro cambio.
  it('cada clase de dato va a un solo proveedor', () => {
    expect(PROVIDERS_BY_PURPOSE).toEqual({
      'clinical-extract': ['anthropic'],
      'lab-read': ['anthropic'],
      'lab-read-control': ['anthropic'],
      answer: ['anthropic'],
      title: ['anthropic'],
      spec: ['anthropic'],
    })
  })

  it('los datos de sujetos no siguen ninguna preferencia', () => {
    expect([...PATIENT_DATA_PURPOSES].sort()).toEqual(['clinical-extract', 'lab-read', 'lab-read-control'])
    for (const purpose of PATIENT_DATA_PURPOSES) {
      for (const preference of ['auto', 'openai', 'google', 'groq', 'glm'] as const) {
        expect(resolveProviderChain(preference, purpose)).toEqual(['anthropic'])
      }
    }
  })

  it('la preferencia de la instalación tampoco mueve los datos de sujetos', () => {
    const prev = process.env.LLM_PROVIDER
    process.env.LLM_PROVIDER = 'openai'
    expect(resolveProviderChain(undefined, 'lab-read')).toEqual(['anthropic'])
    expect(resolveProviderChain(undefined, 'clinical-extract')).toEqual(['anthropic'])
    // Para lo demás, una elección explícita sigue siendo cadena de uno.
    expect(resolveProviderChain(undefined, 'answer')).toEqual(['openai'])
    if (prev === undefined) delete process.env.LLM_PROVIDER
    else process.env.LLM_PROVIDER = prev
  })

  it('la lectura de control usa otro modelo que la lectura principal', async () => {
    const { getModelId } = await import('../provider')
    const prevMain = process.env.LAB_READ_MODEL
    const prevControl = process.env.LAB_READ_CONTROL_MODEL
    delete process.env.LAB_READ_MODEL
    delete process.env.LAB_READ_CONTROL_MODEL
    expect(getModelId('anthropic', 'lab-read-control')).not.toBe(getModelId('anthropic', 'lab-read'))
    if (prevMain !== undefined) process.env.LAB_READ_MODEL = prevMain
    if (prevControl !== undefined) process.env.LAB_READ_CONTROL_MODEL = prevControl
  })
})
