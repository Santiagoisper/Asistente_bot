import { describe, expect, it } from 'vitest'
import { getSpecExtractionProvider } from '../spec-extractor'

describe('proveedor de la extracción de especificaciones', () => {
  it('por defecto es Claude', () => {
    expect(getSpecExtractionProvider({})).toBe('anthropic')
    expect(getSpecExtractionProvider({ SPEC_EXTRACTION_PROVIDER: '' })).toBe('anthropic')
  })

  it('una instalación puede elegir otro proveedor conocido', () => {
    expect(getSpecExtractionProvider({ SPEC_EXTRACTION_PROVIDER: 'openai' })).toBe('openai')
    expect(getSpecExtractionProvider({ SPEC_EXTRACTION_PROVIDER: ' Groq ' })).toBe('groq')
    expect(getSpecExtractionProvider({ SPEC_EXTRACTION_PROVIDER: 'auto' })).toBe('auto')
  })

  it('un valor desconocido no cambia el proveedor: vuelve a Claude', () => {
    expect(getSpecExtractionProvider({ SPEC_EXTRACTION_PROVIDER: 'opnai' })).toBe('anthropic')
    expect(getSpecExtractionProvider({ SPEC_EXTRACTION_PROVIDER: 'gpt-4o' })).toBe('anthropic')
  })
})
