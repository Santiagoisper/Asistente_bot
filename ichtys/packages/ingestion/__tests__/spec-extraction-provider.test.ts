import { describe, expect, it } from 'vitest'
import { getSpecExtractionProvider, safeProviderError } from '../spec-extractor'

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

describe('qué se registra de un error del proveedor', () => {
  it('lee el estado HTTP y el tipo de error como los expone el AI SDK', () => {
    const error = Object.assign(new Error('texto libre que no debe registrarse'), {
      name: 'AI_APICallError',
      statusCode: 400,
      data: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
    })
    expect(safeProviderError(error)).toEqual({ name: 'AI_APICallError', status: '400', code: 'invalid_request_error' })
  })

  it('nunca deja pasar texto libre: un tipo con espacios se descarta', () => {
    const error = { name: 'AI_APICallError', statusCode: 401, data: { error: { type: 'clave sk-ficticia invalida' } } }
    const details = safeProviderError(error)
    expect(details).toEqual({ name: 'AI_APICallError', status: '401', code: 'unknown' })
    expect(JSON.stringify(details)).not.toContain('sk-ficticia')
  })

  it('sin datos reconocibles informa lo mínimo', () => {
    expect(safeProviderError(new Error('x'))).toEqual({ name: 'Error', status: 'n/a', code: 'unknown' })
    expect(safeProviderError(null)).toEqual({ name: 'UnknownError', status: 'n/a', code: 'unknown' })
  })
})
