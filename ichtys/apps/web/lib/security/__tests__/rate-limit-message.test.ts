import { describe, expect, it } from 'vitest'
import { rateLimitedSaveMessage, rateLimitedText } from '../rate-limit-message'

/** Lo que lee quien quiso guardar una evolución y chocó con el límite de pedidos. */
describe('rateLimitedSaveMessage', () => {
  it('dice que no se guardó, que lo escrito sigue ahí y cuánto esperar', () => {
    expect(rateLimitedSaveMessage(30)).toBe(
      'Se hicieron demasiados pedidos seguidos. Esta evolución no se guardó, pero lo escrito sigue acá. Esperá 30 segundos y tocá «Guardar evolución» otra vez.',
    )
  })

  it('con un segundo, en singular', () => {
    expect(rateLimitedSaveMessage(1)).toContain('Esperá 1 segundo y tocá «Guardar evolución» otra vez.')
  })

  it('sin un tiempo usable no inventa uno', () => {
    for (const value of [undefined, null, 0, -5, Number.NaN, '30', 4000]) {
      expect(rateLimitedSaveMessage(value)).toBe(
        'Se hicieron demasiados pedidos seguidos. Esta evolución no se guardó, pero lo escrito sigue acá. Esperá un momento y tocá «Guardar evolución» otra vez.',
      )
    }
  })

  it('redondea hacia arriba: nunca dice que espere menos de lo que hace falta', () => {
    expect(rateLimitedSaveMessage(12.2)).toContain('Esperá 13 segundos')
  })
})


describe('rateLimitedText (ajustes, equipo, modo)', () => {
  it('dice que no se guardó y cuánto esperar', () => {
    expect(rateLimitedText({ error: 'rate_limited', retryAfterSeconds: 12 })).toBe('Se hicieron demasiados pedidos seguidos. El cambio no se guardó. Esperá 12 segundos y probá otra vez.')
    expect(rateLimitedText({ error: 'rate_limited', retryAfterSeconds: 1 })).toContain('1 segundo y')
  })
  it('sin una espera razonable, no inventa un número', () => {
    expect(rateLimitedText({ error: 'rate_limited', retryAfterSeconds: 99999 })).toBe('Se hicieron demasiados pedidos seguidos. El cambio no se guardó. Esperá un momento y probá otra vez.')
    expect(rateLimitedText({ error: 'rate_limited' })).toContain('Esperá un momento')
  })
  it('otra respuesta: null', () => {
    expect(rateLimitedText({ error: 'invalid_input' })).toBeNull()
    expect(rateLimitedText(null)).toBeNull()
    expect(rateLimitedText('rate_limited')).toBeNull()
  })
})
