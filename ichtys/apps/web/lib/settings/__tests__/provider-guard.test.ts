import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProviderChoiceSupported, mergeOrgKeys } from '../provider-guard'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mergeOrgKeys — claves vigentes + patch del mismo request', () => {
  it('la clave que viene en el mismo PATCH habilita al proveedor (cargar clave y elegir glm juntos)', () => {
    const merged = mergeOrgKeys({}, { openrouter: 'sk-or-12345678' })
    expect(merged.openrouter).toBe('sk-or-12345678')
  })

  it('null borra la clave existente de la org', () => {
    const merged = mergeOrgKeys({ openrouter: 'sk-or-12345678' }, { openrouter: null })
    expect(merged.openrouter).toBeUndefined()
  })

  it('sin patch conserva las claves existentes', () => {
    const merged = mergeOrgKeys({ anthropic: 'sk-ant' }, undefined)
    expect(merged.anthropic).toBe('sk-ant')
  })
})

describe('isProviderChoiceSupported — guard server-side (E2E 2026-10-22)', () => {
  it('glm sin clave ni de org ni de plataforma → no soportado (el caso de INNOVA TRIALS)', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(isProviderChoiceSupported('glm', {})).toBe(false)
  })

  it('glm con clave de la org → soportado', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(isProviderChoiceSupported('glm', { openrouter: 'sk-or-12345678' })).toBe(true)
  })

  it('clave de plataforma en env → soportado', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-platform')
    expect(isProviderChoiceSupported('anthropic', {})).toBe(true)
  })

  it('auto siempre soportado', () => {
    expect(isProviderChoiceSupported('auto', {})).toBe(true)
  })
})
