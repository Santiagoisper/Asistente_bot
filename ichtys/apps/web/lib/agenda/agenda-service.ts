import { studyScopeFilter, type StudyScope } from '@ichtys/auth/study-scope'
import { agendaItems, and, asc, db, eq, gte, inArray, lt, studies, subjects, type AgendaItemKind, type AgendaItemStatus } from '@ichtys/db'
import { decryptClinicalContent, encryptClinicalContent } from '../subjects/phi-fields'
import type { CreateAgendaItemInput, UpdateAgendaItemInput } from './agenda-schema'
import { dayRange, zonedToUtc } from './agenda-time'
import type { DbExecutor } from '../audit/audited-write'

/**
 * Agenda del sitio. Regla de este archivo: toda consulta y toda escritura
 * llevan la organización (`organizationId`, `params.orgId`). El código del
 * sujeto y las notas solo se devuelven a quien puede ver datos de sujetos.
 */

export type AgendaErrorCode = 'not_found' | 'subject_mismatch'

export class AgendaError extends Error {
  constructor(readonly code: AgendaErrorCode) {
    super(`agenda: ${code}`)
    this.name = 'AgendaError'
  }
}

export interface AgendaEntry {
  id: string
  studyId: string
  studyLabel: string
  subjectId: string | null
  /** null si el turno no es de un sujeto o si quien mira no puede ver sujetos. */
  subjectCode: string | null
  title: string
  kind: AgendaItemKind
  startsAt: Date
  durationMinutes: number
  status: AgendaItemStatus
  notes: string | null
}

/**
 * `executor` es la transacción de la escritura auditada que la envuelve
 * (lib/audit/audited-write.ts): el turno y su registro de auditoría se
 * confirman juntos.
 */
export async function createAgendaItem(params: { executor: DbExecutor; orgId: string; studyId: string; userId: string; timeZone: string; input: CreateAgendaItemInput }): Promise<{ id: string }> {
  const { input, executor } = params
  if (input.subjectId !== null) {
    // El sujeto tiene que ser de este estudio y de esta organización.
    const [subject] = await executor
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.organizationId, params.orgId), eq(subjects.studyId, params.studyId), eq(subjects.id, input.subjectId)))
      .limit(1)
    if (!subject) throw new AgendaError('subject_mismatch')
  }
  const [created] = await executor
    .insert(agendaItems)
    .values({
      organizationId: params.orgId,
      studyId: params.studyId,
      subjectId: input.subjectId,
      title: input.title,
      kind: input.kind,
      startsAt: zonedToUtc(input.day, input.time, params.timeZone),
      durationMinutes: input.durationMinutes,
      notesEncrypted: input.notes === null ? null : encryptClinicalContent(input.notes),
      createdBy: params.userId,
    })
    .returning({ id: agendaItems.id })
  if (!created) throw new AgendaError('not_found')
  return created
}

export async function updateAgendaItem(params: { executor: DbExecutor; orgId: string; studyId: string; itemId: string; userId: string; timeZone: string; patch: UpdateAgendaItemInput }): Promise<{ id: string; status: AgendaItemStatus }> {
  const { patch } = params
  const moved = patch.day !== undefined && patch.time !== undefined
  const [updated] = await params.executor
    .update(agendaItems)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      // Reprogramar un turno lo vuelve a dejar programado, salvo que se pida otro estado.
      ...(moved ? { startsAt: zonedToUtc(patch.day!, patch.time!, params.timeZone), ...(patch.status === undefined ? { status: 'scheduled' as const } : {}) } : {}),
      updatedBy: params.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(agendaItems.organizationId, params.orgId), eq(agendaItems.studyId, params.studyId), eq(agendaItems.id, params.itemId)))
    .returning({ id: agendaItems.id, status: agendaItems.status })
  if (!updated) throw new AgendaError('not_found')
  return updated
}

function safeNotes(encrypted: string | null): string | null {
  if (encrypted === null) return null
  try {
    return decryptClinicalContent(encrypted)
  } catch {
    // Una nota que no se puede descifrar no tiene que tirar toda la agenda.
    return null
  }
}

/** Turnos entre dos instantes, ordenados por hora. */
export async function listAgenda(params: { orgId: string; scope: StudyScope; from: Date; to: Date; includeSubjects: boolean }): Promise<AgendaEntry[]> {
  const rows = await db
    .select()
    .from(agendaItems)
    .where(
      and(
        eq(agendaItems.organizationId, params.orgId),
        studyScopeFilter(params.scope, agendaItems.studyId),
        gte(agendaItems.startsAt, params.from),
        lt(agendaItems.startsAt, params.to),
      ),
    )
    .orderBy(asc(agendaItems.startsAt))
    .limit(500)
  if (rows.length === 0) return []

  const studyIds = [...new Set(rows.map((row) => row.studyId))]
  const subjectIds = params.includeSubjects ? [...new Set(rows.map((row) => row.subjectId).filter((id): id is string => id !== null))] : []
  const [studyRows, subjectRows] = await Promise.all([
    db
      .select({ id: studies.id, name: studies.name, protocolNumber: studies.protocolNumber })
      .from(studies)
      .where(and(eq(studies.organizationId, params.orgId), inArray(studies.id, studyIds))),
    subjectIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: subjects.id, subjectCode: subjects.subjectCode })
          .from(subjects)
          .where(and(eq(subjects.organizationId, params.orgId), inArray(subjects.id, subjectIds))),
  ])
  const studyLabel = new Map(studyRows.map((row) => [row.id, row.protocolNumber?.trim() || row.name]))
  const subjectCode = new Map(subjectRows.map((row) => [row.id, row.subjectCode]))

  return rows.map((row) => ({
    id: row.id,
    studyId: row.studyId,
    studyLabel: studyLabel.get(row.studyId) ?? 'Estudio',
    subjectId: params.includeSubjects ? row.subjectId : null,
    subjectCode: row.subjectId === null ? null : (subjectCode.get(row.subjectId) ?? null),
    title: row.title,
    kind: row.kind,
    startsAt: row.startsAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
    notes: params.includeSubjects ? safeNotes(row.notesEncrypted) : null,
  }))
}

/** Turnos de un día del sitio. */
export function listAgendaDay(params: { orgId: string; scope: StudyScope; dayKey: string; timeZone: string; includeSubjects: boolean }): Promise<AgendaEntry[]> {
  const { start, end } = dayRange(params.dayKey, params.timeZone)
  return listAgenda({ orgId: params.orgId, scope: params.scope, from: start, to: end, includeSubjects: params.includeSubjects })
}
