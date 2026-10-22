import { describe, expect, it } from 'vitest'
import {
  PROVIDER_OPTIONS,
  PROVIDER_KEY_FIELD,
  isProviderSelectable,
  providerUnavailableHint,
  type LlmKeyProvider,
  type LlmProvider,
} from '../provider-options'

const key = (provider: LlmKeyProvider, configured: boolean) => ({
  provider,
  configured,
  source: 'org' as const,
  hint: null,
})

describe('PROVIDER_OPTIONS — descripciones reflejan el mapa real de modelos', () => {
  it('anthropic describe el mapa por propósito vigente (sin versiones muertas)', () => {
    const anthropic = PROVIDER_OPTIONS.find((o) => o.value === 'anthropic')
    expect(anthropic?.description).toContain('Sonnet')
    expect(anthropic?.description).toContain('Haiku')
    expect(anthropic?.description).toContain('Opus')
    expect(anthropic?.description).not.toContain('4.5.') // la string vieja "Solo Claude Sonnet 4.5."
  })

  it('ninguna descripción contiene las strings muertas previas', () => {
    const all = PROVIDER_OPTIONS.map((o) => o.description).join(' ')
    expect(all).not.toContain('Solo Claude Sonnet 4.5')
    expect(all).not.toContain('Solo Gemini 2.0 Flash.')
    expect(all).not.toContain('GLM 5.2 (OpenRouter)')
  })
})

describe('isProviderSelectable — sin clave disponible, no seleccionable (E2E 2026-10-22)', () => {
  it('auto siempre seleccionable (la cadena prueba a todos)', () => {
    expect(isProviderSelectable('auto', [])).toBe(true)
  })

  it('glm ya no es opción (salió del producto, E2E 2026-10-22)', () => {
    expect(PROVIDER_OPTIONS.find((o) => o.value === 'glm')).toBeUndefined()
  })

  it('groq sin clave cargada → no seleccionable; con clave → sí', () => {
    expect(isProviderSelectable('groq', [key('anthropic', true)])).toBe(false)
    expect(isProviderSelectable('groq', [key('anthropic', true), key('groq', true)])).toBe(true)
  })

  it('proveedor sin estado de clave conocido → no seleccionable', () => {
    expect(isProviderSelectable('groq', [])).toBe(false)
  })

  it('la opción auto describe la cadena real sin GLM', () => {
    const auto = PROVIDER_OPTIONS.find((o) => o.value === 'auto')
    expect(auto?.description).toContain('Groq')
    expect(auto?.description).not.toContain('GLM')
  })

  it('el hint de no disponible explica cómo habilitarlo', () => {
    const hint = providerUnavailableHint()
    expect(hint).toContain('clave')
    expect(hint).toContain('abajo')
  })

  it('cada proveedor no-auto tiene su key field mapeada', () => {
    for (const opt of PROVIDER_OPTIONS) {
      if (opt.value === 'auto') continue
      expect(PROVIDER_KEY_FIELD[opt.value as Exclude<LlmProvider, 'auto' | 'glm'>]).toBeDefined()
    }
  })
})
