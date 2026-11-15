import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import type { DbTransaction } from '../../audit/audited-write'
import { purgeExpiredDictationAudios, purgeExpiredUnassignedAudios } from '../audio-store'

/**
 * La tarea diaria que borra las grabaciones vencidas (D14, D24). Lo que borra lo decide una
 * consulta, y un error ahí no se ve: borrar de más se lleva grabaciones vigentes de todos los
 * estudios, y borrar de menos deja guardado lo que se dijo que se borraba a los 30 días.
 *
 * No hay base en estas pruebas: la consulta se arma con el esquema real y se captura el SQL y
 * los parámetros que saldrían hacia la base. No prueba que la base haga lo que el SQL dice;
 * prueba que el SQL pide lo que la decisión dice.
 */
interface Sent {
  sql: string
  params: unknown[]
}

function capture(rows: unknown[][] = []) {
  const sent: Sent[] = []
  const tx = drizzle(async (sql, params) => {
    sent.push({ sql, params })
    return { rows }
  }) as unknown as DbTransaction
  return { tx, sent }
}

const NOW = new Date('2026-12-15T06:17:00.000Z')
const where = (sql: string) => sql.slice(sql.indexOf(' where '), sql.indexOf(' returning '))
const set = (sql: string) => sql.slice(sql.indexOf(' set '), sql.indexOf(' where '))

describe('purgeExpiredDictationAudios — qué grabaciones de sujetos se borran', () => {
  it('hace una sola escritura, sobre la tabla de grabaciones', async () => {
    const { tx, sent } = capture()
    await purgeExpiredDictationAudios(tx, NOW)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.sql).toMatch(/^update "dictation_audios" set /)
  })

  it('solo las vencidas: la fecha de vencimiento anterior a la hora de la corrida', async () => {
    const { tx, sent } = capture()
    await purgeExpiredDictationAudios(tx, NOW)
    const clause = where(sent[0]!.sql)
    expect(clause).toMatch(/"dictation_audios"\."expires_at" < \$\d+/)
    expect(clause).not.toMatch(/"expires_at" >/)
  })

  it('solo las que todavía tienen contenido, y no las retiradas al depósito', async () => {
    const { tx, sent } = capture()
    await purgeExpiredDictationAudios(tx, NOW)
    const clause = where(sent[0]!.sql)
    expect(clause).toContain('"dictation_audios"."content_encrypted" is not null')
    expect(clause).toContain('"dictation_audios"."withdrawn_at" is null')
    // Las tres condiciones van juntas: con un «o» se borraría lo vigente.
    expect(clause).not.toMatch(/ or /i)
    expect(clause.match(/ and /g)).toHaveLength(2)
  })

  it('borra la grabación y sus tramos, y deja la fecha del borrado; no toca nada más', async () => {
    const { tx, sent } = capture()
    await purgeExpiredDictationAudios(tx, NOW)
    const clause = set(sent[0]!.sql)
    expect(clause).toMatch(/"content_encrypted" = \$\d+/)
    expect(clause).toMatch(/"segments_encrypted" = \$\d+/)
    expect(clause).toMatch(/"purged_at" = \$\d+/)
    expect(clause.match(/ = \$\d+/g)).toHaveLength(3)
    // Dos nulos (contenido y tramos), la fecha del borrado y la misma hora para comparar el vencimiento.
    expect(sent[0]!.params.filter((value) => value === null)).toHaveLength(2)
    expect(sent[0]!.params.filter((value) => value !== null)).toHaveLength(2)
  })

  it('devuelve qué borró, con organización y estudio, para dejar un registro por cada una', async () => {
    const { tx, sent } = capture([['audio-1', 'org-1', 'study-1']])
    const purged = await purgeExpiredDictationAudios(tx, NOW)
    expect(sent[0]!.sql).toMatch(/ returning "id", "organization_id", "study_id"$/)
    expect(purged).toEqual([{ id: 'audio-1', organizationId: 'org-1', studyId: 'study-1' }])
  })
})

describe('purgeExpiredUnassignedAudios — el depósito de grabaciones sin sujeto vence igual', () => {
  it('misma regla de vencimiento y de contenido, sobre la tabla del depósito', async () => {
    const { tx, sent } = capture()
    await purgeExpiredUnassignedAudios(tx, NOW)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.sql).toMatch(/^update "unassigned_dictation_audios" set /)
    const clause = where(sent[0]!.sql)
    expect(clause).toMatch(/"unassigned_dictation_audios"\."expires_at" < \$\d+/)
    expect(clause).toContain('"unassigned_dictation_audios"."content_encrypted" is not null')
    expect(clause).not.toMatch(/ or /i)
    expect(clause.match(/ and /g)).toHaveLength(1)
  })

  it('borra la grabación y sus tramos, y deja la fecha del borrado', async () => {
    const { tx, sent } = capture()
    await purgeExpiredUnassignedAudios(tx, NOW)
    const clause = set(sent[0]!.sql)
    expect(clause).toMatch(/"content_encrypted" = \$\d+/)
    expect(clause).toMatch(/"segments_encrypted" = \$\d+/)
    expect(clause).toMatch(/"purged_at" = \$\d+/)
    expect(clause.match(/ = \$\d+/g)).toHaveLength(3)
  })
})
