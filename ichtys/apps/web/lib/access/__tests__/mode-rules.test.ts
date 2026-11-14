import { describe, expect, it } from 'vitest'
import { ACCESS_OPEN_DEFAULT_DAYS, canSwitchMode, previewEnforcedImpact } from '../mode-rules'
import type { OrgMember } from '../org-members'
import type { TeamSnapshot } from '../team-service'

/**
 * Reglas del cambio de modo (docs/decisions/study-membership.md, M5/M8 y
 * «Cambio de modo»). La matriz de canSwitchMode y el preview de impacto se
 * prueban acá puros; la ruta los prueba de punta a punta con el fixture.
 */

const NOW = new Date('2026-11-13T12:00:00.000Z')
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)

describe('canSwitchMode', () => {
  it('M8: la ventana del modo abierto es la constante del doc (60 días)', () => {
    expect(ACCESS_OPEN_DEFAULT_DAYS).toBe(60)
  })

  it('pedir el modo que ya rige no cambia nada', () => {
    expect(canSwitchMode({ target: 'open', effectiveMode: 'open', openUntil: inDays(30), now: NOW })).toBe('no_change')
    expect(canSwitchMode({ target: 'enforced', effectiveMode: 'enforced', openUntil: null, now: NOW })).toBe('no_change')
  })

  it('open → enforced siempre se puede (solo quita acceso)', () => {
    for (const openUntil of [null, inDays(30), inDays(-1)]) {
      expect(canSwitchMode({ target: 'enforced', effectiveMode: 'open', openUntil, now: NOW })).toBeNull()
    }
  })

  it('enforced → open: antes del plazo sí, después no (paso 4 de la sección)', () => {
    expect(canSwitchMode({ target: 'open', effectiveMode: 'enforced', openUntil: inDays(1), now: NOW })).toBeNull()
    expect(canSwitchMode({ target: 'open', effectiveMode: 'enforced', openUntil: null, now: NOW })).toBeNull()
    expect(canSwitchMode({ target: 'open', effectiveMode: 'enforced', openUntil: inDays(-1), now: NOW })).toBe('deadline_passed')
    // Vence inclusive: el día exacto ya no se puede volver.
    expect(canSwitchMode({ target: 'open', effectiveMode: 'enforced', openUntil: NOW, now: NOW })).toBe('deadline_passed')
  })

  it('columna open vencida rige como enforced: volver se niega; pedir estricto ya es el estado vigente', () => {
    const expiredOpen = { target: 'open' as const, effectiveMode: 'enforced' as const, openUntil: inDays(-1), now: NOW }
    expect(canSwitchMode(expiredOpen)).toBe('deadline_passed')
    // El modo EFECTIVO ya es estricto: para estas reglas no hay cambio. Que la
    // columna deje de depender del reloj (oficializarla) lo resuelve la ruta.
    expect(canSwitchMode({ ...expiredOpen, target: 'enforced' })).toBe('no_change')
  })
})

const member = (userId: string, role: OrgMember['role']): OrgMember => ({
  userId,
  name: `Persona ${userId}`,
  identifier: `${userId}@centro.test`,
  role,
})

function snapshot(rows: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    functions: [],
    memberships: [],
    studies: [
      { id: 'study-1', name: 'Metabólica' },
      { id: 'study-2', name: 'Cardíaca' },
    ],
    evolutionAuthors: [],
    ...rows,
  }
}

describe('previewEnforcedImpact', () => {
  it('quien tiene alcance total no pierde nada (M10)', () => {
    const members = [member('user-1', 'read_only_monitor')]
    const snap = snapshot({
      functions: [{ userId: 'user-1', functionKey: 'operations_director', grantedBy: 'x', grantedAt: NOW }],
    })
    const [person] = previewEnforcedImpact({ members, snapshot: snap, now: NOW })
    expect(person?.losesStudies).toEqual([])
    expect(person?.losesAllStudies).toBe(false)
  })

  it('membresía vigente conserva el estudio; vencida no (M4)', () => {
    const members = [member('user-1', 'read_only_monitor'), member('user-2', 'read_only_monitor')]
    const snap = snapshot({
      functions: [
        { userId: 'user-1', functionKey: 'monitor', grantedBy: 'x', grantedAt: NOW },
        { userId: 'user-2', functionKey: 'monitor', grantedBy: 'x', grantedAt: NOW },
      ],
      memberships: [
        { userId: 'user-1', studyId: 'study-1', studyLabel: null, expiresAt: inDays(30) },
        { userId: 'user-2', studyId: 'study-1', studyLabel: null, expiresAt: inDays(-1) },
      ],
    })
    const [vigente, vencida] = previewEnforcedImpact({ members, snapshot: snap, now: NOW })
    expect(vigente?.losesStudies.map((s) => s.studyName)).toEqual(['Cardíaca'])
    expect(vencida?.losesStudies.map((s) => s.studyName)).toEqual(['Metabólica', 'Cardíaca'])
    expect(vencida?.losesAllStudies).toBe(true)
  })

  it('sin study.read no ve ninguno: hasta una membresía vigente no le abre la puerta (M12)', () => {
    const members = [member('user-1', 'org_admin')]
    const snap = snapshot({
      functions: [{ userId: 'user-1', functionKey: 'platform_admin', grantedBy: 'x', grantedAt: NOW }],
      memberships: [{ userId: 'user-1', studyId: 'study-1', studyLabel: null, expiresAt: null }],
    })
    const [person] = previewEnforcedImpact({ members, snapshot: snap, now: NOW })
    expect(person?.losesAllStudies).toBe(true)
    expect(person?.losesStudies).toHaveLength(2)
  })

  it('stopsAuthoring: quien hoy evoluciona por rol y no tiene Investigador/a (M15)', () => {
    const members = [member('user-1', 'principal_investigator'), member('user-2', 'read_only_monitor')]
    const snap = snapshot({
      functions: [{ userId: 'user-1', functionKey: 'monitor', grantedBy: 'x', grantedAt: NOW }],
    })
    const [medico, monitor] = previewEnforcedImpact({ members, snapshot: snap, now: NOW })
    // El médico evoluciona hoy por rol (canAccessPhiData) y no tiene investigator.
    expect(medico?.stopsAuthoring).toBe(true)
    // El monitor de solo lectura nunca evolucionó: no pierde la autoría.
    expect(monitor?.stopsAuthoring).toBe(false)
  })

  it('membresía sin vencimiento sigue vigente (solo el monitor la necesita)', () => {
    const members = [member('user-1', 'site_coordinator')]
    const snap = snapshot({
      functions: [{ userId: 'user-1', functionKey: 'investigator', grantedBy: 'x', grantedAt: NOW }],
      memberships: [{ userId: 'user-1', studyId: 'study-1', studyLabel: 'PI', expiresAt: null }],
    })
    const [person] = previewEnforcedImpact({ members, snapshot: snap, now: NOW })
    expect(person?.losesStudies.map((s) => s.studyName)).toEqual(['Cardíaca'])
    expect(person?.stopsAuthoring).toBe(false)
  })

  it('M18: la membresía sin fecha del monitor ya venció — el preview no puede decir que la conserva', () => {
    const members = [member('user-1', 'read_only_monitor')]
    const monitorFunctions = [{ userId: 'user-1', functionKey: 'monitor' as const, grantedBy: 'x', grantedAt: NOW }]

    // Sin fecha: en estricto esa membresía no vale (hueco de orden tapado en
    // canEnterStudy/loadStudyScope; acá el mismo criterio para no mentir).
    const noDate = previewEnforcedImpact({
      members,
      snapshot: snapshot({
        functions: monitorFunctions,
        memberships: [{ userId: 'user-1', studyId: 'study-1', studyLabel: null, expiresAt: null }],
      }),
      now: NOW,
    })
    expect(noDate[0]?.losesStudies.map((s) => s.studyName)).toEqual(['Metabólica', 'Cardíaca'])
    expect(noDate[0]?.losesAllStudies).toBe(true)

    // Con fecha vigente la conserva.
    const withDate = previewEnforcedImpact({
      members,
      snapshot: snapshot({
        functions: monitorFunctions,
        memberships: [{ userId: 'user-1', studyId: 'study-1', studyLabel: null, expiresAt: inDays(30) }],
      }),
      now: NOW,
    })
    expect(withDate[0]?.losesStudies.map((s) => s.studyName)).toEqual(['Cardíaca'])
  })
})
