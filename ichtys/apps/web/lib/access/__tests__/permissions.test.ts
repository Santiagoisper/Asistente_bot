import { describe, expect, it } from 'vitest'
import type { AccessSubject } from '@ichtys/auth/functions'
import { ROLES, type Role } from '@ichtys/auth/roles'
import type { MemberFunction } from '@ichtys/db'
import {
  MONITOR_MEMBERSHIP_MAX_DAYS,
  canManageOrgAccess,
  checkMembershipExpiry,
  couldManageStudyAccess,
} from '../permissions'

/**
 * permissions.ts decide con las funciones y el modo; de dónde salen esos datos
 * (sesión, base) lo prueban las suites de las rutas. Acá los subjects se
 * construyen a mano, como los entregaría `loadAccessSubject`.
 */

const subject = (mode: 'open' | 'enforced', role: Role, functions: readonly MemberFunction[] = []): AccessSubject => ({
  mode,
  role,
  functions,
})

const DAY = 24 * 60 * 60 * 1000

describe('canManageOrgAccess — quién administra el equipo y sus accesos (M11 a M14)', () => {
  it('modo open: decide el rol histórico, y solo el administrador de la organización', () => {
    expect(canManageOrgAccess(subject('open', ROLES.ORG_ADMIN))).toBe(true)
    // Igualdad estricta, no jerarquía: study_admin administra estudios, no el equipo.
    expect(canManageOrgAccess(subject('open', ROLES.STUDY_ADMIN))).toBe(false)
    expect(canManageOrgAccess(subject('open', ROLES.PRINCIPAL_INVESTIGATOR))).toBe(false)
    expect(canManageOrgAccess(subject('open', ROLES.READ_ONLY_MONITOR))).toBe(false)
  })

  it('modo open: las funciones cargadas no restringen ni amplían nada', () => {
    expect(canManageOrgAccess(subject('open', ROLES.ORG_ADMIN, ['monitor']))).toBe(true)
    expect(canManageOrgAccess(subject('open', ROLES.READ_ONLY_MONITOR, ['operations_director', 'platform_admin']))).toBe(false)
  })

  it('modo enforced: deciden las funciones; el rol histórico no cuenta', () => {
    expect(canManageOrgAccess(subject('enforced', ROLES.READ_ONLY_MONITOR, ['operations_director']))).toBe(true)
    expect(canManageOrgAccess(subject('enforced', ROLES.READ_ONLY_MONITOR, ['platform_admin']))).toBe(true)
    expect(canManageOrgAccess(subject('enforced', ROLES.ORG_ADMIN, ['investigator']))).toBe(false)
    // El Study Coordinator da acceso a SUS estudios (M11); el equipo lo administra Operaciones.
    expect(canManageOrgAccess(subject('enforced', ROLES.STUDY_ADMIN, ['study_coordinator']))).toBe(false)
    expect(canManageOrgAccess(subject('enforced', ROLES.PRINCIPAL_INVESTIGATOR, ['investigator']))).toBe(false)
    expect(canManageOrgAccess(subject('enforced', ROLES.PRINCIPAL_INVESTIGATOR, ['monitor']))).toBe(false)
  })

  it('M14: el administrador de la organización conserva la administración vía platform_admin', () => {
    // La inyección de platform_admin para el org_admin vive en loadAccessSubject
    // (packages/auth/access-subject.ts), no acá: este módulo ve el subject ya
    // armado. Con la función inyectada administra; sin funciones no — nadie más
    // que loadAccessSubject lo protege, y la suite de la ruta lo comprueba de
    // punta a punta.
    expect(canManageOrgAccess(subject('enforced', ROLES.ORG_ADMIN, ['platform_admin']))).toBe(true)
    expect(canManageOrgAccess(subject('enforced', ROLES.ORG_ADMIN, []))).toBe(false)
  })
})

describe('couldManageStudyAccess — requisito histórico para dar acceso a un estudio', () => {
  it('en modo open alcanzaba con administrar el estudio', () => {
    expect(couldManageStudyAccess(ROLES.STUDY_ADMIN)).toBe(true)
    expect(couldManageStudyAccess(ROLES.ORG_ADMIN)).toBe(true)
    expect(couldManageStudyAccess(ROLES.PRINCIPAL_INVESTIGATOR)).toBe(false)
    expect(couldManageStudyAccess(ROLES.SITE_COORDINATOR)).toBe(false)
    expect(couldManageStudyAccess(ROLES.READ_ONLY_MONITOR)).toBe(false)
  })
})

describe('checkMembershipExpiry — vencimiento de la membresía del monitor (M4)', () => {
  const now = new Date('2026-11-13T12:00:00.000Z')
  const expiry = (days: number): Date => new Date(now.getTime() + days * DAY)

  it('una fecha en el pasado se rechaza para cualquiera, monitor o no', () => {
    expect(checkMembershipExpiry({ targetFunctions: ['monitor'], expiresAt: expiry(-1), now })).toBe('expiry_in_past')
    expect(checkMembershipExpiry({ targetFunctions: ['study_coordinator'], expiresAt: expiry(-1), now })).toBe('expiry_in_past')
  })

  it('con fecha, el tope máximo también aplica a cualquiera (precisión M4)', () => {
    // «Toda membresía con vencimiento»: quien no es monitor no necesita fecha,
    // pero si la carga, esa fecha vale entera — nada de vencimientos eternos
    // con etiqueta de fecha.
    expect(checkMembershipExpiry({ targetFunctions: ['investigator'], expiresAt: expiry(400), now })).toBe('monitor_expiry_too_far')
    expect(checkMembershipExpiry({ targetFunctions: [], expiresAt: expiry(400), now })).toBe('monitor_expiry_too_far')
    expect(checkMembershipExpiry({ targetFunctions: ['study_coordinator'], expiresAt: expiry(30), now })).toBeNull()
  })

  it('quien es solo monitor necesita fecha de vencimiento', () => {
    expect(checkMembershipExpiry({ targetFunctions: ['monitor'], expiresAt: null, now })).toBe('monitor_requires_expiry')
    // platform_admin no da entrada a estudios (M12), pero con M18 da igual:
    // mientras tenga la función monitor, la membresía vence.
    expect(checkMembershipExpiry({ targetFunctions: ['monitor', 'platform_admin'], expiresAt: null, now })).toBe(
      'monitor_requires_expiry',
    )
  })

  it('el tope es el máximo provisorio, inclusive', () => {
    // PROVISORIO (M4: «máximo configurable»): MONITOR_MEMBERSHIP_MAX_DAYS es un
    // resguardo hasta que Santiago fije el número y dónde se configura. El test
    // usa la constante, no el 365, para seguir valiendo cuando cambie.
    expect(checkMembershipExpiry({ targetFunctions: ['monitor'], expiresAt: expiry(MONITOR_MEMBERSHIP_MAX_DAYS), now })).toBeNull()
    expect(checkMembershipExpiry({ targetFunctions: ['monitor'], expiresAt: expiry(MONITOR_MEMBERSHIP_MAX_DAYS + 1), now })).toBe(
      'monitor_expiry_too_far',
    )
  })

  it('M18: el vencimiento se exige aunque el monitor tenga otras funciones', () => {
    // Lectura estricta de M4, definida por Santiago el 13/11/2026: una función
    // extra no puede usarse de puerta de servicio para saltear el control —
    // y el caso monitor+coordinador es justo el que más conviene que venza.
    for (const extra of ['study_coordinator', 'investigator', 'lab_assistant', 'operations_director'] as const) {
      expect(checkMembershipExpiry({ targetFunctions: ['monitor', extra], expiresAt: null, now })).toBe('monitor_requires_expiry')
    }
    // Con fecha válida sí: el requisito es que venza, no que no exista.
    expect(checkMembershipExpiry({ targetFunctions: ['monitor', 'study_coordinator'], expiresAt: expiry(30), now })).toBeNull()
  })

  it('sin la función monitor la fecha es opcional', () => {
    expect(checkMembershipExpiry({ targetFunctions: ['study_coordinator'], expiresAt: null, now })).toBeNull()
    expect(checkMembershipExpiry({ targetFunctions: [], expiresAt: null, now })).toBeNull()
  })
})
