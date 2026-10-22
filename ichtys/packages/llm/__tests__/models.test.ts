import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelId } from '../provider'
import type { LlmPurpose } from '../types'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getModelId — mapa de modelos Anthropic por propósito', () => {
  it('answer (chat) usa claude-sonnet-4-6 por defecto', () => {
    expect(getModelId('anthropic', 'answer')).toBe('claude-sonnet-4-6')
  })

  it('title usa claude-haiku-4-5 por defecto', () => {
    expect(getModelId('anthropic', 'title')).toBe('claude-haiku-4-5')
  })

  it('clinical-extract usa claude-sonnet-4-6 por defecto (brief: clinical → sonnet)', () => {
    expect(getModelId('anthropic', 'clinical-extract')).toBe('claude-sonnet-4-6')
  })

  it('spec usa claude-opus-4-6 por defecto (decisión Foreman, coordinado con sicario; overridable por env)', () => {
    expect(getModelId('anthropic', 'spec')).toBe('claude-opus-4-6')
  })

  it('ningún default usa claude-*-5-5 (rechazan temperature y tool_choice que manda ai@4)', () => {
    const purposes: LlmPurpose[] = ['answer', 'title', 'spec', 'clinical-extract']
    for (const purpose of purposes) {
      const id = getModelId('anthropic', purpose)
      expect(id).not.toMatch(/-5-5$/)
    }
  })

  it('los env de override siguen mandando sobre el default', () => {
    vi.stubEnv('ANSWER_MODEL', 'claude-opus-5-5')
    vi.stubEnv('TITLE_MODEL', 'claude-haiku-5-5')
    vi.stubEnv('SPEC_EXTRACTION_MODEL', 'claude-opus-5-5')
    vi.stubEnv('CLINICAL_EXTRACTION_MODEL', 'claude-opus-5-5')
    expect(getModelId('anthropic', 'answer')).toBe('claude-opus-5-5')
    expect(getModelId('anthropic', 'title')).toBe('claude-haiku-5-5')
    expect(getModelId('anthropic', 'spec')).toBe('claude-opus-5-5')
    expect(getModelId('anthropic', 'clinical-extract')).toBe('claude-opus-5-5')
  })

  it('clinical-extract ya no depende de TITLE_MODEL (tiene env propio)', () => {
    vi.stubEnv('TITLE_MODEL', 'claude-haiku-5-5')
    expect(getModelId('anthropic', 'clinical-extract')).toBe('claude-sonnet-4-6')
  })

  it('regresión mínima: otros proveedores no cambian', () => {
    expect(getModelId('openai', 'answer')).toBe('gpt-4o')
    expect(getModelId('openai', 'title')).toBe('gpt-4o-mini')
    expect(getModelId('groq', 'answer')).toBe('llama-3.3-70b-versatile')
  })
})
