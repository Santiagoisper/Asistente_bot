import { describe, expect, it } from 'vitest'
import { isProviderFallbackError, isProviderQuotaError } from '../fallback'

/**
 * ai@4 expone el HTTP status en `statusCode` (APICallError); los SDK directos
 * usan `status`. Nota de reviewer en #41: el 429 real del SDK no disparaba
 * llm_rate_limited porque statusFromError solo miraba `status`.
 */
describe('isProviderQuotaError — statusCode del SDK de ai@4', () => {
  it('statusCode 429 es quota/saturación', () => {
    const err = Object.assign(new Error('API error'), { statusCode: 429 })
    expect(isProviderQuotaError(err)).toBe(true)
  })

  it('status 429 clásico sigue funcionando (retrocompatible)', () => {
    const err = Object.assign(new Error('Too many requests'), { status: 429 })
    expect(isProviderQuotaError(err)).toBe(true)
  })

  it('statusCode 200 no es quota', () => {
    const err = Object.assign(new Error('API error'), { statusCode: 200 })
    expect(isProviderQuotaError(err)).toBe(false)
  })
})

describe('isProviderFallbackError — statusCode del SDK de ai@4', () => {
  it('statusCode 401 justifica pasar al siguiente proveedor de la cadena', () => {
    const err = Object.assign(new Error('invalid x-api-key'), { statusCode: 401 })
    expect(isProviderFallbackError(err)).toBe(true)
  })

  it('statusCode 403 igual', () => {
    const err = Object.assign(new Error('forbidden'), { statusCode: 403 })
    expect(isProviderFallbackError(err)).toBe(true)
  })

  it('status 401 clásico sigue funcionando (retrocompatible)', () => {
    const err = Object.assign(new Error('invalid x-api-key'), { status: 401 })
    expect(isProviderFallbackError(err)).toBe(true)
  })
})
