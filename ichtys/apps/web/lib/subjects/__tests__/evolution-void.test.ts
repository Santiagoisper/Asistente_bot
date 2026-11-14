import { describe, expect, it } from 'vitest'
import { depositRowFrom, voidEvolution, type SourceAudio, type VoidStore } from '../evolution-void'

/**
 * Anular una evolución registrada en el sujeto equivocado y retirar sus grabaciones
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, D24). O pasa todo, o no pasa nada:
 * el servicio corre dentro de una transacción y, ante cualquier tramo que no cierra, tira.
 */
const NOW = new Date('2026-11-14T18:00:00Z')
const SCOPE = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1', evolutionId: 'evo-1' }
const PARAMS = { ...SCOPE, actorId: 'user_declara', reason: 'wrong_subject' as const, now: NOW }

function audio(take: number, extra: Partial<SourceAudio> = {}): SourceAudio {
  return {
    id: `audio-${take}`,
    organizationId: 'org-1',
    studyId: 'study-1',
    evolutionId: 'evo-1',
    take,
    mime: 'audio/webm',
    sizeBytes: 1000 * take,
    durationSec: 10 * take,
    sha256: `huella-${take}`,
    contentEncrypted: `cifrado-${take}`,
    segmentsEncrypted: `tramos-${take}`,
    createdBy: 'user_autor',
    createdAt: new Date('2026-10-16T12:00:00Z'),
    expiresAt: new Date('2026-11-15T12:00:00Z'),
    purgedAt: null,
    ...extra,
  }
}

function fakeStore(options: { evolution?: 'vigente' | 'anulada' | 'inexistente'; audios?: SourceAudio[]; voidInserted?: boolean; withdrawFails?: number } = {}) {
  const log: string[] = []
  const deposits: Array<Record<string, unknown>> = []
  const audits: Array<{ action: string; resourceId: string; metadata?: Record<string, unknown> }> = []
  const store: VoidStore = {
    findEvolution: async () => {
      log.push('buscar')
      if (options.evolution === 'inexistente') return null
      return { id: 'evo-1', authorUserId: 'user_autor', voided: options.evolution === 'anulada' ? { reason: 'wrong_subject', declaredBy: 'x', declaredAt: NOW } : null }
    },
    insertVoid: async (row) => {
      log.push(`anular:${row.evolutionId}`)
      return options.voidInserted === false ? null : 'void-1'
    },
    audiosOf: async () => {
      log.push('grabaciones')
      return options.audios ?? []
    },
    insertDeposit: async (row) => {
      log.push(`depositar:${row.sourceAudioId}`)
      deposits.push(row as unknown as Record<string, unknown>)
      return `deposito-${row.take}`
    },
    withdrawAudio: async (id) => {
      log.push(`retirar:${id}`)
      return options.withdrawFails === undefined || id !== `audio-${options.withdrawFails}`
    },
    audit: async (entry) => {
      audits.push(entry as never)
    },
  }
  return { store, log, deposits, audits }
}

describe('depositRowFrom — lo que pasa al depósito', () => {
  const row = depositRowFrom(audio(2), { by: 'user_declara', at: NOW })

  it('el plazo no se reinicia: la fecha de grabación y el vencimiento se copian', () => {
    expect(row.createdAt).toEqual(new Date('2026-10-16T12:00:00Z'))
    expect(row.expiresAt).toEqual(new Date('2026-11-15T12:00:00Z'))
  })

  it('lleva el contenido y los tramos, la huella y de dónde salió', () => {
    expect(row).toMatchObject({
      organizationId: 'org-1',
      studyId: 'study-1',
      sourceAudioId: 'audio-2',
      evolutionId: 'evo-1',
      take: 2,
      mime: 'audio/webm',
      sizeBytes: 2000,
      durationSec: 20,
      sha256: 'huella-2',
      contentEncrypted: 'cifrado-2',
      segmentsEncrypted: 'tramos-2',
      createdBy: 'user_autor',
      declaredBy: 'user_declara',
      declaredAt: NOW,
    })
  })

  it('una grabación que ya venció y todavía no se borró pasa sin contenido: el depósito no la guarda de más', () => {
    const overdue = depositRowFrom(audio(1, { expiresAt: new Date('2026-11-14T17:00:00Z') }), { by: 'user_declara', at: NOW })
    expect(overdue.contentEncrypted).toBeNull()
    expect(overdue.segmentsEncrypted).toBeNull()
    expect(overdue.purgedAt).toEqual(NOW)
    // El vencimiento sigue siendo el original.
    expect(overdue.expiresAt).toEqual(new Date('2026-11-14T17:00:00Z'))
  })

  it('una que vence justo ahora ya está vencida', () => {
    expect(depositRowFrom(audio(1, { expiresAt: NOW }), { by: 'user_declara', at: NOW }).contentEncrypted).toBeNull()
  })

  it('no lleva sujeto: una grabación del depósito no es de la historia de nadie', () => {
    expect(Object.keys(row)).not.toContain('subjectId')
  })

  it('una grabación ya vencida pasa como constancia: sin contenido y con su fecha de borrado', () => {
    const purgedAt = new Date('2026-11-01T00:00:00Z')
    const expired = depositRowFrom(audio(1, { contentEncrypted: null, segmentsEncrypted: null, purgedAt }), { by: 'user_declara', at: NOW })
    expect(expired.contentEncrypted).toBeNull()
    expect(expired.purgedAt).toEqual(purgedAt)
  })
})

describe('voidEvolution', () => {
  it('anula y retira cada toma: primero al depósito, después se vacía la original', async () => {
    const { store, log, deposits } = fakeStore({ audios: [audio(1), audio(2)] })

    const result = await voidEvolution(store, PARAMS)

    expect(result).toEqual({
      status: 'voided',
      voidId: 'void-1',
      withdrawn: [
        { sourceAudioId: 'audio-1', depositId: 'deposito-1', take: 1 },
        { sourceAudioId: 'audio-2', depositId: 'deposito-2', take: 2 },
      ],
    })
    expect(log).toEqual(['buscar', 'anular:evo-1', 'grabaciones', 'depositar:audio-1', 'retirar:audio-1', 'depositar:audio-2', 'retirar:audio-2'])
    expect(deposits.map((row) => row.contentEncrypted)).toEqual(['cifrado-1', 'cifrado-2'])
  })

  it('una evolución sin grabaciones se anula igual', async () => {
    const { store, log } = fakeStore({ audios: [] })
    expect(await voidEvolution(store, PARAMS)).toEqual({ status: 'voided', voidId: 'void-1', withdrawn: [] })
    expect(log).toEqual(['buscar', 'anular:evo-1', 'grabaciones'])
  })

  it('si la evolución no es de este sujeto, no toca nada', async () => {
    const { store, log, audits } = fakeStore({ evolution: 'inexistente' })
    expect(await voidEvolution(store, PARAMS)).toEqual({ status: 'not_found' })
    expect(log).toEqual(['buscar'])
    expect(audits).toEqual([])
  })

  it('una evolución ya anulada no se anula dos veces ni se vuelve a retirar nada', async () => {
    const { store, log, audits } = fakeStore({ evolution: 'anulada', audios: [audio(1)] })
    expect(await voidEvolution(store, PARAMS)).toEqual({ status: 'already_voided' })
    expect(log).toEqual(['buscar'])
    expect(audits).toEqual([])
  })

  it('si otra persona la anuló en el mismo instante, tampoco: la fila única decide', async () => {
    const { store, log, audits } = fakeStore({ voidInserted: false, audios: [audio(1)] })
    expect(await voidEvolution(store, PARAMS)).toEqual({ status: 'already_voided' })
    expect(log).toEqual(['buscar', 'anular:evo-1'])
    expect(audits).toEqual([])
  })

  it('si una toma no se pudo retirar, tira: la transacción deshace la anulación y el depósito', async () => {
    const { store } = fakeStore({ audios: [audio(1), audio(2)], withdrawFails: 2 })
    await expect(voidEvolution(store, PARAMS)).rejects.toThrow('evolution_void_withdraw_failed')
  })

  it('deja un registro por la anulación y uno por cada grabación retirada', async () => {
    const { store, audits } = fakeStore({ audios: [audio(1), audio(2)] })

    await voidEvolution(store, { ...PARAMS, note: 'Era el sujeto de la cama de al lado' })

    expect(audits.map((entry) => [entry.action, entry.resourceId])).toEqual([
      ['evolution.audio.withdraw', 'audio-1'],
      ['evolution.audio.withdraw', 'audio-2'],
      ['evolution.void', 'evo-1'],
    ])
    expect(audits[2]!.metadata).toEqual({ subjectId: 'subject-1', reason: 'wrong_subject', audiosWithdrawn: 2, hasNote: true })
    expect(audits[0]!.metadata).toEqual({ subjectId: 'subject-1', evolutionId: 'evo-1', take: 1, depositId: 'deposito-1', reason: 'wrong_subject' })
  })

  it('si la grabación ya había vencido, el registro del retiro lo dice', async () => {
    const { store, audits } = fakeStore({ audios: [audio(1, { expiresAt: new Date('2026-11-14T17:00:00Z') }), audio(2)] })
    await voidEvolution(store, PARAMS)
    expect(audits[0]!.metadata).toMatchObject({ take: 1, contentExpired: true })
    expect(audits[1]!.metadata).not.toHaveProperty('contentExpired')
  })

  it('el registro no lleva el texto de la nota ni contenido', async () => {
    const { store, audits } = fakeStore({ audios: [audio(1)] })
    await voidEvolution(store, { ...PARAMS, note: 'Era el sujeto de la cama de al lado' })
    const text = JSON.stringify(audits)
    expect(text).not.toContain('cama de al lado')
    expect(text).not.toContain('cifrado-1')
    expect(text).not.toContain('tramos-1')
  })

  it('la nota viaja a la anulación para guardarse; sin nota, vacío', async () => {
    const seen: Array<string | null> = []
    const withNote = fakeStore()
    withNote.store.insertVoid = async (row) => {
      seen.push(row.note)
      return 'void-1'
    }
    await voidEvolution(withNote.store, { ...PARAMS, note: '  Era otro sujeto  ' })
    await voidEvolution(withNote.store, PARAMS)
    await voidEvolution(withNote.store, { ...PARAMS, note: '   ' })
    expect(seen).toEqual(['Era otro sujeto', null, null])
  })
})
