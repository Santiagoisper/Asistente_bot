import {
  and,
  auditLogs,
  count,
  db,
  desc,
  documents,
  documentVersions,
  eq,
  inArray,
  labReports,
  patientProfiles,
  sql,
  studies,
  studySpecs,
  subjects,
} from '@ichtys/db'
import type { ModuleAlert } from '@ichtys/integrations'
import { sortPriorityItems, type PriorityItem } from './priority'

/**
 * Datos del Inicio. Regla de este archivo: toda consulta filtra por la
 * organización (`organizationId`, `orgId`) en cada tabla que toca, y ninguna
 * descifra PHI. tests/leakage/os-org-filter.test.ts lo vigila.
 */

function studyLabel(row: { protocolNumber: string | null; studyName: string }): string {
  return row.protocolNumber?.trim() || row.studyName
}

export async function countActiveStudies(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(studies)
    .where(and(eq(studies.organizationId, orgId), eq(studies.status, 'active')))
  return row?.value ?? 0
}

export async function countPendingLabReviews(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(patientProfiles)
    .where(and(eq(patientProfiles.organizationId, orgId), eq(patientProfiles.labReviewPending, true)))
  return row?.value ?? 0
}

/** Informes de laboratorio subidos que esperan revisión (Carga de laboratorios). */
export async function countPendingLabReports(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(labReports)
    .where(and(eq(labReports.organizationId, orgId), eq(labReports.status, 'pending_review')))
  return row?.value ?? 0
}

/** Todo lo de laboratorio que espera a una persona: revisiones del perfil e informes subidos. */
export async function countPendingLabWork(orgId: string): Promise<number> {
  const [reviews, reports] = await Promise.all([countPendingLabReviews(orgId), countPendingLabReports(orgId)])
  return reviews + reports
}

export interface PendingLabReportRow {
  reportId: string
  subjectId: string
  subjectCode: string
  studyId: string
  studyLabel: string
  rowCount: number
  since: Date
}

export async function listPendingLabReports(orgId: string, limit: number): Promise<PendingLabReportRow[]> {
  const rows = await db
    .select({
      reportId: labReports.id,
      subjectId: subjects.id,
      subjectCode: subjects.subjectCode,
      studyId: studies.id,
      studyName: studies.name,
      protocolNumber: studies.protocolNumber,
      rowCount: labReports.rowCount,
      since: labReports.createdAt,
    })
    .from(labReports)
    .innerJoin(subjects, and(eq(subjects.id, labReports.subjectId), eq(subjects.organizationId, orgId)))
    .innerJoin(studies, and(eq(studies.id, labReports.studyId), eq(studies.organizationId, orgId)))
    .where(and(eq(labReports.organizationId, orgId), eq(labReports.status, 'pending_review')))
    .orderBy(labReports.createdAt)
    .limit(limit)
  return rows.map((row) => ({
    reportId: row.reportId,
    subjectId: row.subjectId,
    subjectCode: row.subjectCode,
    studyId: row.studyId,
    studyLabel: studyLabel(row),
    rowCount: row.rowCount,
    since: row.since,
  }))
}

/** Estudios activos de la organización, para elegir dónde cargar un informe. */
export async function listActiveStudies(orgId: string): Promise<StudyOption[]> {
  const rows = await db
    .select({ id: studies.id, name: studies.name, protocolNumber: studies.protocolNumber })
    .from(studies)
    .where(and(eq(studies.organizationId, orgId), eq(studies.status, 'active')))
    .orderBy(studies.name)
    .limit(200)
  return rows.map((row) => ({
    id: row.id,
    label: row.protocolNumber?.trim() ? `${row.protocolNumber.trim()} · ${row.name}` : row.name,
  }))
}

export interface PendingLabReviewRow {
  subjectId: string
  subjectCode: string
  studyId: string
  studyLabel: string
  since: Date | null
}

export async function listPendingLabReviews(orgId: string, limit: number): Promise<PendingLabReviewRow[]> {
  const rows = await db
    .select({
      subjectId: subjects.id,
      subjectCode: subjects.subjectCode,
      studyId: studies.id,
      studyName: studies.name,
      protocolNumber: studies.protocolNumber,
      since: patientProfiles.labReviewPendingSince,
    })
    .from(patientProfiles)
    .innerJoin(subjects, and(eq(subjects.id, patientProfiles.subjectId), eq(subjects.organizationId, orgId)))
    .innerJoin(studies, and(eq(studies.id, patientProfiles.studyId), eq(studies.organizationId, orgId)))
    .where(and(eq(patientProfiles.organizationId, orgId), eq(patientProfiles.labReviewPending, true)))
    .orderBy(sql`${patientProfiles.labReviewPendingSince} ASC NULLS LAST`)
    .limit(limit)
  return rows.map((row) => ({
    subjectId: row.subjectId,
    subjectCode: row.subjectCode,
    studyId: row.studyId,
    studyLabel: studyLabel(row),
    since: row.since,
  }))
}

export interface LabOutcomes {
  confirmed: number
  rejected: number
}

/** Confirmaciones y rechazos de laboratorio de los últimos 30 días, desde el registro de auditoría. */
export async function labOutcomes30d(orgId: string, now: Date): Promise<LabOutcomes> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const rows = await db
    .select({ action: auditLogs.action, value: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, orgId),
        inArray(auditLogs.action, ['lab.confirm', 'lab.reject']),
        sql`${auditLogs.createdAt} >= ${since}::timestamptz`,
      ),
    )
    .groupBy(auditLogs.action)
  const of = (action: string) => rows.find((row) => row.action === action)?.value ?? 0
  return { confirmed: of('lab.confirm'), rejected: of('lab.reject') }
}

interface FailedIngestionRow {
  versionId: string
  documentName: string
  studyId: string
  studyLabel: string
  createdAt: Date
}

/** Versiones con ingesta en error que no fueron reemplazadas por una versión posterior. */
async function listFailedIngestions(orgId: string, limit: number): Promise<FailedIngestionRow[]> {
  const rows = await db
    .select({
      versionId: documentVersions.id,
      documentName: documents.name,
      studyId: studies.id,
      studyName: studies.name,
      protocolNumber: studies.protocolNumber,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .innerJoin(documents, and(eq(documents.id, documentVersions.documentId), eq(documents.organizationId, orgId)))
    .innerJoin(studies, and(eq(studies.id, documentVersions.studyId), eq(studies.organizationId, orgId)))
    .where(
      and(
        eq(documentVersions.organizationId, orgId),
        eq(documentVersions.status, 'error'),
        sql`NOT EXISTS (
          SELECT 1 FROM document_versions newer
          WHERE newer.document_id = ${documentVersions.documentId}
            AND newer.version_number > ${documentVersions.versionNumber}
        )`,
      ),
    )
    .orderBy(desc(documentVersions.createdAt))
    .limit(limit)
  return rows.map((row) => ({
    versionId: row.versionId,
    documentName: row.documentName,
    studyId: row.studyId,
    studyLabel: studyLabel(row),
    createdAt: row.createdAt,
  }))
}

interface DraftSpecRow {
  specId: string
  studyId: string
  studyLabel: string
  version: number
  createdAt: Date
}

async function listDraftSpecs(orgId: string, limit: number): Promise<DraftSpecRow[]> {
  const rows = await db
    .select({
      specId: studySpecs.id,
      studyId: studies.id,
      studyName: studies.name,
      protocolNumber: studies.protocolNumber,
      version: studySpecs.version,
      createdAt: studySpecs.createdAt,
    })
    .from(studySpecs)
    .innerJoin(studies, and(eq(studies.id, studySpecs.studyId), eq(studies.organizationId, orgId)))
    .where(and(eq(studySpecs.organizationId, orgId), eq(studySpecs.status, 'draft')))
    .orderBy(desc(studySpecs.createdAt))
    .limit(limit)
  return rows.map((row) => ({
    specId: row.specId,
    studyId: row.studyId,
    studyLabel: studyLabel(row),
    version: row.version,
    createdAt: row.createdAt,
  }))
}

export interface StudyOption {
  id: string
  label: string
}

/** Estudios activos que ya tienen al menos un documento listo para consultar. */
export async function listStudiesWithReadyDocs(orgId: string): Promise<StudyOption[]> {
  const rows = await db
    .selectDistinct({ id: studies.id, name: studies.name, protocolNumber: studies.protocolNumber })
    .from(studies)
    .innerJoin(
      documentVersions,
      and(
        eq(documentVersions.studyId, studies.id),
        eq(documentVersions.organizationId, orgId),
        eq(documentVersions.status, 'ready'),
      ),
    )
    .where(and(eq(studies.organizationId, orgId), eq(studies.status, 'active')))
    .orderBy(studies.name)
    .limit(50)
  return rows.map((row) => ({
    id: row.id,
    label: row.protocolNumber?.trim() ? `${row.protocolNumber.trim()} · ${row.name}` : row.name,
  }))
}

const PRIORITY_FETCH_LIMIT = 25

export interface SatelliteAlerts {
  module: string
  alerts: ModuleAlert[]
}

/**
 * Junta lo que hoy necesita atención. Los ítems de laboratorio llevan código
 * de sujeto: solo se incluyen si el rol puede ver datos de sujetos.
 */
export async function listPriorityItems(
  orgId: string,
  opts: { includeSubjects: boolean; satellites?: SatelliteAlerts[] },
): Promise<PriorityItem[]> {
  const [labs, reports, ingestions, specs] = await Promise.all([
    opts.includeSubjects ? listPendingLabReviews(orgId, PRIORITY_FETCH_LIMIT) : Promise.resolve([]),
    opts.includeSubjects ? listPendingLabReports(orgId, PRIORITY_FETCH_LIMIT) : Promise.resolve([]),
    listFailedIngestions(orgId, PRIORITY_FETCH_LIMIT),
    listDraftSpecs(orgId, PRIORITY_FETCH_LIMIT),
  ])

  const items: PriorityItem[] = [
    ...labs.map((row): PriorityItem => ({
      id: `lab:${row.subjectId}`,
      kind: 'lab',
      severity: 'high',
      title: 'Laboratorio sin confirmar',
      detail: `${row.subjectCode} · ${row.studyLabel}`,
      href: `/studies/${row.studyId}/subjects/${row.subjectId}`,
      since: row.since?.toISOString() ?? null,
    })),
    ...reports.map((row): PriorityItem => ({
      id: `lab-report:${row.reportId}`,
      kind: 'lab',
      severity: 'high',
      title: 'Informe de laboratorio por revisar',
      detail: `${row.subjectCode} · ${row.studyLabel}`,
      href: `/studies/${row.studyId}/subjects/${row.subjectId}/labs/${row.reportId}`,
      since: row.since.toISOString(),
    })),
    ...ingestions.map((row): PriorityItem => ({
      id: `ingestion:${row.versionId}`,
      kind: 'ingestion',
      severity: 'high',
      title: 'Documento que no se pudo procesar',
      detail: `${row.documentName} · ${row.studyLabel}`,
      href: `/studies/${row.studyId}/documents`,
      since: row.createdAt.toISOString(),
    })),
    ...specs.map((row): PriorityItem => ({
      id: `spec:${row.specId}`,
      kind: 'spec',
      severity: 'medium',
      title: 'Spec del protocolo sin aprobar',
      detail: `${row.studyLabel} · versión ${row.version}`,
      href: `/studies/${row.studyId}/spec`,
      since: row.createdAt.toISOString(),
    })),
    ...(opts.satellites ?? []).flatMap((satellite) =>
      satellite.alerts.map((alert): PriorityItem => ({
        id: `${satellite.module}:${alert.id}`,
        kind: 'satellite',
        severity: alert.severity,
        title: alert.title,
        detail: alert.detail,
        href: alert.href,
        since: null,
      })),
    ),
  ]
  return sortPriorityItems(items)
}

/** Cantidad exacta para la campana: solo lo que Alphi sabe sin consultar satélites. */
export async function countNativePriority(orgId: string, includeSubjects: boolean): Promise<number> {
  const [labs, [ingestions], [specs]] = await Promise.all([
    includeSubjects ? countPendingLabWork(orgId) : Promise.resolve(0),
    db
      .select({ value: count() })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.organizationId, orgId),
          eq(documentVersions.status, 'error'),
          sql`NOT EXISTS (
            SELECT 1 FROM document_versions newer
            WHERE newer.document_id = ${documentVersions.documentId}
              AND newer.version_number > ${documentVersions.versionNumber}
          )`,
        ),
      ),
    db
      .select({ value: count() })
      .from(studySpecs)
      .where(and(eq(studySpecs.organizationId, orgId), eq(studySpecs.status, 'draft'))),
  ])
  return labs + (ingestions?.value ?? 0) + (specs?.value ?? 0)
}
