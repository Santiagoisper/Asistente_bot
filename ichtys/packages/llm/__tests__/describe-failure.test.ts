import { describe, expect, it } from 'vitest'
import { describeLlmFailure } from '../fallback'

/**
 * Cuando una llamada al modelo falla, el log tiene que alcanzar para saber por
 * qué, sin copiar el mensaje del proveedor (puede repetir el texto enviado).
 * Sale el código HTTP, una categoría y, a lo sumo, palabras de una lista fija.
 */
const apiError = (statusCode: number, message: string) => Object.assign(new Error(message), { name: 'AI_APICallError', statusCode })

describe('describeLlmFailure — diagnóstico sin el mensaje del proveedor', () => {
  it('saldo o cupo agotado', () => {
    expect(describeLlmFailure(apiError(400, 'Your credit balance is too low to access the API. Please go to Plans & Billing.'))).toEqual({ name: 'AI_APICallError', status: 400, kind: 'quota_or_billing', hints: ['credit balance', 'billing'] })
    expect(describeLlmFailure(apiError(429, 'rate limit'))).toMatchObject({ status: 429, kind: 'quota_or_billing' })
  })

  it('clave inválida y modelo inexistente', () => {
    expect(describeLlmFailure(apiError(401, 'invalid x-api-key'))).toMatchObject({ kind: 'auth' })
    expect(describeLlmFailure(apiError(404, 'model: claude-x does not exist'))).toMatchObject({ kind: 'model_not_found' })
  })

  it('pedido rechazado: dice qué parámetro nombra el proveedor, no lo que dijo', () => {
    const failure = describeLlmFailure(apiError(400, 'temperature is not supported with this model. Paciente Juan Pérez, HbA1c 9,2 %'))
    expect(failure).toEqual({ name: 'AI_APICallError', status: 400, kind: 'bad_request', hints: ['temperature', 'not supported'] })
    expect(JSON.stringify(failure)).not.toContain('Juan')
    expect(JSON.stringify(failure)).not.toContain('HbA1c')
  })

  it('pedido rechazado sin pista conocida', () => {
    expect(describeLlmFailure(apiError(400, 'algo que no está en la lista'))).toEqual({ name: 'AI_APICallError', status: 400, kind: 'bad_request', hints: [] })
  })

  it('corte por tiempo y errores que no son del proveedor', () => {
    expect(describeLlmFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toMatchObject({ kind: 'timeout', status: null })
    expect(describeLlmFailure(new Error('cualquier cosa'))).toEqual({ name: 'Error', status: null, kind: 'other', hints: [] })
    expect(describeLlmFailure('texto')).toEqual({ name: 'string', status: null, kind: 'other', hints: [] })
  })
})
