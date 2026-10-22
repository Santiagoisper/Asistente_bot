import { describe, expect, it } from 'vitest'
import {
  hasLegacyExtractionFailure,
  isProtocolProcessing,
  resolveExtractionFailed,
  specExtractionWarnings,
  specHasExtractionFailed,
  type ProtocolVersionStatusRow,
} from '../spec-extraction-status'

function versions(...rows: Partial<ProtocolVersionStatusRow>[]): ProtocolVersionStatusRow[] {
  return rows.map((r) => ({ status: 'ready', errorMessage: null, ...r }))
}

describe('isProtocolProcessing', () => {
  it('true si alguna versión está pending o processing', () => {
    expect(isProtocolProcessing(versions({ status: 'pending' }))).toBe(true)
    expect(isProtocolProcessing(versions({ status: 'processing' }))).toBe(true)
  })

  it('false si todas están ready o error', () => {
    expect(isProtocolProcessing(versions({ status: 'ready' }, { status: 'error' }))).toBe(false)
  })

  it('false con lista vacía', () => {
    expect(isProtocolProcessing([])).toBe(false)
  })
})

describe('hasLegacyExtractionFailure', () => {
  it('true solo con status error y el código exacto', () => {
    expect(
      hasLegacyExtractionFailure(versions({ status: 'error', errorMessage: 'spec_extraction_failed' })),
    ).toBe(true)
  })

  it('false con otro código de error', () => {
    expect(
      hasLegacyExtractionFailure(versions({ status: 'error', errorMessage: 'pdf_text_extraction_failed' })),
    ).toBe(false)
  })

  it('false si el status no es error', () => {
    expect(
      hasLegacyExtractionFailure(versions({ status: 'ready', errorMessage: 'spec_extraction_failed' })),
    ).toBe(false)
  })
})

describe('specHasExtractionFailed', () => {
  it('true solo con extractionFailed === true', () => {
    expect(specHasExtractionFailed({ extractionFailed: true })).toBe(true)
  })

  it('false sin el campo, con el campo falso, o con basura', () => {
    expect(specHasExtractionFailed({})).toBe(false)
    expect(specHasExtractionFailed({ extractionFailed: false })).toBe(false)
    expect(specHasExtractionFailed({ extractionFailed: 'true' })).toBe(false)
    expect(specHasExtractionFailed(null)).toBe(false)
    expect(specHasExtractionFailed('spec')).toBe(false)
  })
})

describe('specExtractionWarnings', () => {
  it('devuelve el array tal cual si son todos strings', () => {
    expect(specExtractionWarnings({ extractionWarnings: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('filtra entradas que no son string', () => {
    expect(specExtractionWarnings({ extractionWarnings: ['a', 1, null, 'b'] })).toEqual(['a', 'b'])
  })

  it('[] sin el campo o con spec inválido', () => {
    expect(specExtractionWarnings({})).toEqual([])
    expect(specExtractionWarnings(null)).toEqual([])
  })
})

describe('resolveExtractionFailed', () => {
  it('una versión en curso siempre gana, aunque haya fallo previo', () => {
    expect(
      resolveExtractionFailed({
        protocolProcessing: true,
        specExtractionFailed: true,
        legacyExtractionFailed: true,
      }),
    ).toBe(false)
  })

  it('el flag del spec dispara el banner cuando no hay nada en curso', () => {
    expect(
      resolveExtractionFailed({
        protocolProcessing: false,
        specExtractionFailed: true,
        legacyExtractionFailed: false,
      }),
    ).toBe(true)
  })

  it('el fallback legado dispara el banner cuando no hay spec', () => {
    expect(
      resolveExtractionFailed({
        protocolProcessing: false,
        specExtractionFailed: false,
        legacyExtractionFailed: true,
      }),
    ).toBe(true)
  })

  it('false si no hay nada en curso ni fallo', () => {
    expect(
      resolveExtractionFailed({
        protocolProcessing: false,
        specExtractionFailed: false,
        legacyExtractionFailed: false,
      }),
    ).toBe(false)
  })
})
