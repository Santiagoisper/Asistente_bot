import { describe, expect, it } from 'vitest'
import { describeHistoryEntry, FUNCTION_LABELS, HISTORY_TEXTS, type HistoryEntryView } from '../team-ui'

/** Cada acción del historial en una frase: quién, a quién y qué. */

const names = new Map([
  ['u-ana', 'Ana Admin'],
  ['u-beto', 'Beto Médico'],
])
const studies = new Map([['s-1', 'Metabólica']])

const base: HistoryEntryView = {
  action: 'access.function.grant',
  at: '2026-11-12T13:00:00.000Z',
  actorUserId: 'u-ana',
  memberUserId: 'u-beto',
  functionKey: 'investigator',
  studyId: null,
  self: false,
  hasExpiry: null,
  modeTo: null,
  openUntil: null,
}
const say = (over: Partial<HistoryEntryView>) => describeHistoryEntry({ ...base, ...over }, names, studies, 'America/Argentina/Buenos_Aires')
const inv = `«${FUNCTION_LABELS.investigator}»`

describe('describeHistoryEntry', () => {
  it.each([
    [{}, `Ana Admin le asignó a Beto Médico la función ${inv}.`],
    [{ self: true, memberUserId: 'u-ana' }, `Ana Admin se asignó la función ${inv}.`],
    [{ action: 'access.function.revoke' }, `Ana Admin le quitó a Beto Médico la función ${inv}.`],
    [{ action: 'access.function.revoke', self: true }, `Ana Admin se quitó la función ${inv}.`],
    [{ action: 'access.membership.grant', studyId: 's-1', hasExpiry: true }, 'Ana Admin le dio a Beto Médico acceso al estudio Metabólica, con vencimiento.'],
    [{ action: 'access.membership.grant', studyId: 's-1', hasExpiry: false }, 'Ana Admin le dio a Beto Médico acceso al estudio Metabólica.'],
    [{ action: 'access.membership.update', studyId: 's-1' }, 'Ana Admin cambió el acceso de Beto Médico al estudio Metabólica.'],
    [{ action: 'access.membership.revoke', studyId: 's-1' }, 'Ana Admin le quitó a Beto Médico el acceso al estudio Metabólica.'],
    [{ action: 'org.access_mode.update', modeTo: 'enforced' }, 'Ana Admin pasó la organización a modo estricto.'],
    [{ action: 'org.access_mode.update', modeTo: 'open' }, 'Ana Admin pasó la organización a modo abierto.'],
  ] as const)('%o', (over, expected) => {
    expect(say(over as Partial<HistoryEntryView>)).toBe(expected)
  })

  it('la fecha del plazo es la del centro, no la del navegador', () => {
    // 02:00 UTC del 11/01 es todavía 10/01 en Buenos Aires.
    expect(say({ action: 'org.access_mode.deadline_set', openUntil: '2027-01-11T02:00:00.000Z' })).toContain('10/01/2027')
  })

  it('el plazo del modo abierto dice hasta cuándo', () => {
    const text = say({ action: 'org.access_mode.deadline_set', openUntil: '2027-01-11T12:00:00.000Z' })
    expect(text).toContain('Ana Admin abrió esta pantalla por primera vez')
    expect(text).toContain('11/01/2027')
  })

  it('quien ya no está, un estudio borrado o una función desconocida no se inventan', () => {
    expect(say({ memberUserId: 'u-otro' })).toContain(HISTORY_TEXTS.unknownPerson)
    expect(say({ actorUserId: 'u-otro' }).startsWith(HISTORY_TEXTS.unknownPerson)).toBe(true)
    expect(say({ functionKey: null })).toContain(HISTORY_TEXTS.unknownFunction)
    expect(say({ action: 'access.membership.revoke', studyId: 's-9' })).toContain(HISTORY_TEXTS.unknownStudy)
    expect(say({ actorUserId: null }).startsWith(HISTORY_TEXTS.system)).toBe(true)
  })
})
