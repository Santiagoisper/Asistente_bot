import { describe, expect, it, vi } from 'vitest'

vi.mock('../../subjects/phi-fields', () => ({
  encryptClinicalContent: (plain: string) => `cifrado:${plain.length}`,
  decryptClinicalContent: (cipher: string) => cipher,
}))

import { DICTATION_AUDIO_RETENTION_DAYS, retentionDeadline, storeDictationAudio } from '../audio-store'
import { audioState } from '../audio-state'

/**
 * El plazo de conservación de una grabación (docs/decisions/consulta-dictada.md, D14): 30 días.
 * Lo dice el aviso que lee quien dicta y lo tiene que cumplir lo que se guarda. Cambiar el número
 * es una decisión, no un ajuste: esta prueba falla a propósito si alguien lo toca.
 */
const NOW = new Date('2026-11-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function recordingTx() {
  const saved: Array<Record<string, unknown>> = []
  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        saved.push(values)
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: 'audio-1' }] }) }
      },
    }),
  }
  return { tx: tx as unknown as Parameters<typeof storeDictationAudio>[0], saved }
}

describe('plazo de conservación de una grabación', () => {
  it('son 30 días: el número decidido', () => {
    expect(DICTATION_AUDIO_RETENTION_DAYS).toBe(30)
  })

  it('el vencimiento cae exactamente 30 días después, a la misma hora', () => {
    expect(retentionDeadline(NOW)).toEqual(new Date('2026-12-15T12:00:00Z'))
    expect(retentionDeadline(NOW).getTime() - NOW.getTime()).toBe(30 * DAY)
  })

  it('no modifica la fecha que recibe', () => {
    const from = new Date(NOW)
    retentionDeadline(from)
    expect(from).toEqual(NOW)
  })

  it('al guardar una grabación, la fila lleva ese vencimiento y es el que se devuelve', async () => {
    const { tx, saved } = recordingTx()
    const meta = await storeDictationAudio(tx, {
      orgId: 'org-1',
      studyId: 'study-1',
      subjectId: 'subj-1',
      evolutionId: 'evo-1',
      take: 1,
      actorId: 'user_1',
      mime: 'audio/webm',
      durationSec: 12,
      bytes: new Uint8Array([1, 2, 3]),
      now: NOW,
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.expiresAt).toEqual(new Date('2026-12-15T12:00:00Z'))
    expect(meta?.expiresAt).toEqual(new Date('2026-12-15T12:00:00Z'))
  })

  it('el día 30 todavía se escucha hasta el instante del vencimiento; en ese instante ya no', () => {
    const expiresAt = retentionDeadline(NOW)
    const row = { hasContent: true, expiresAt, purgedAt: null, withdrawnAt: null }
    expect(audioState(row, new Date(expiresAt.getTime() - 1))).toBe('available')
    expect(audioState(row, expiresAt)).toBe('expired')
  })
})
