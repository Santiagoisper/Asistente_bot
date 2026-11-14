import { describe, expect, it } from 'vitest'
import { audioState } from '../audio-state'

/**
 * En qué estado está una grabación (D14, D24). Retirada no es vencida: una vencida se borró
 * al cumplirse el plazo; una retirada salió de este sujeto porque la evolución se registró en
 * el equivocado, y su contenido sigue existiendo en el depósito.
 */
const NOW = new Date('2026-11-14T18:00:00Z')
const LATER = new Date('2026-12-01T00:00:00Z')
const BEFORE = new Date('2026-11-01T00:00:00Z')

describe('audioState', () => {
  it('con contenido y dentro del plazo: disponible', () => {
    expect(audioState({ hasContent: true, expiresAt: LATER, purgedAt: null, withdrawnAt: null }, NOW)).toBe('available')
  })

  it('borrada por vencimiento: vencida', () => {
    expect(audioState({ hasContent: false, expiresAt: BEFORE, purgedAt: BEFORE, withdrawnAt: null }, NOW)).toBe('expired')
  })

  it('pasó el plazo y la limpieza todavía no corrió: vencida igual, no se entrega', () => {
    expect(audioState({ hasContent: true, expiresAt: BEFORE, purgedAt: null, withdrawnAt: null }, NOW)).toBe('expired')
  })

  it('retirada al depósito: retirada, aunque esté vacía y dentro del plazo', () => {
    expect(audioState({ hasContent: false, expiresAt: LATER, purgedAt: null, withdrawnAt: NOW }, NOW)).toBe('withdrawn')
  })

  it('retirada pesa más que vencida: lo que pasó con ella es que se retiró', () => {
    expect(audioState({ hasContent: false, expiresAt: BEFORE, purgedAt: null, withdrawnAt: BEFORE }, NOW)).toBe('withdrawn')
    expect(audioState({ hasContent: false, expiresAt: BEFORE, purgedAt: BEFORE, withdrawnAt: NOW }, NOW)).toBe('withdrawn')
  })

  it('sin contenido y sin fechas que lo expliquen: vencida, nunca disponible', () => {
    expect(audioState({ hasContent: false, expiresAt: LATER, purgedAt: null, withdrawnAt: null }, NOW)).toBe('expired')
  })
})
