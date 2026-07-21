import { describe, expect, it } from 'vitest'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'

/**
 * Leakage suite — invariantes de schema multi-tenant (SECURITY.md §1, §3).
 *
 * Bloqueante para release. Toda tabla que almacena contenido de un tenant
 * DEBE llevar organization_id NOT NULL (y study_id NOT NULL cuando el
 * aislamiento es por estudio). Si una migración futura relaja estas columnas,
 * este test rompe antes de que el retrieval pueda mezclar tenants.
 *
 * Importa SOLO el schema (no el cliente) para no requerir DATABASE_URL.
 */

import {
  auditLogs,
  chunks,
  citations,
  clinicalEvolutions,
  conversations,
  documents,
  documentVersions,
  ingestionJobs,
  messages,
  pages,
  patientProfiles,
  screeningAssessments,
  sites,
  studies,
  studySpecs,
  subjects,
} from '../../schema'

interface TenantTableSpec {
  name: string
  table: PgTable
  /** true → además de organization_id exige study_id NOT NULL */
  studyScoped: boolean
}

/** Tablas con contenido tenant-scoped y su nivel de aislamiento requerido. */
const TENANT_TABLES: TenantTableSpec[] = [
  { name: 'sites', table: sites, studyScoped: false },
  { name: 'studies', table: studies, studyScoped: false },
  { name: 'documents', table: documents, studyScoped: true },
  { name: 'document_versions', table: documentVersions, studyScoped: true },
  { name: 'pages', table: pages, studyScoped: true },
  { name: 'chunks', table: chunks, studyScoped: true },
  { name: 'conversations', table: conversations, studyScoped: true },
  { name: 'messages', table: messages, studyScoped: true },
  { name: 'citations', table: citations, studyScoped: true },
  { name: 'study_specs', table: studySpecs, studyScoped: true },
  // ingestion_jobs: study_id nullable por diseño — el job de bulk-import
  // existe ANTES de crear el estudio y usa onDelete: set null. El boundary
  // de seguridad de la cola es organization_id (NOT NULL) + batch_id.
  { name: 'ingestion_jobs', table: ingestionJobs, studyScoped: false },
  { name: 'subjects', table: subjects, studyScoped: true },
  { name: 'clinical_evolutions', table: clinicalEvolutions, studyScoped: true },
  { name: 'patient_profiles', table: patientProfiles, studyScoped: true },
  { name: 'screening_assessments', table: screeningAssessments, studyScoped: true },
]

function findColumn(table: PgTable, columnName: string) {
  return getTableConfig(table).columns.find((column) => column.name === columnName)
}

describe('leakage — tenant column invariants', () => {
  for (const spec of TENANT_TABLES) {
    it(`${spec.name} carries organization_id NOT NULL`, () => {
      const column = findColumn(spec.table, 'organization_id')
      expect(column, `${spec.name}.organization_id must exist`).toBeDefined()
      expect(column?.notNull, `${spec.name}.organization_id must be NOT NULL`).toBe(true)
    })
  }

  for (const spec of TENANT_TABLES.filter((table) => table.studyScoped)) {
    it(`${spec.name} carries study_id NOT NULL`, () => {
      const column = findColumn(spec.table, 'study_id')
      expect(column, `${spec.name}.study_id must exist`).toBeDefined()
      expect(column?.notNull, `${spec.name}.study_id must be NOT NULL`).toBe(true)
    })
  }

  it('audit_logs carries organization_id (traceability of sensitive actions)', () => {
    const column = findColumn(auditLogs, 'organization_id')
    expect(column).toBeDefined()
  })

  it('chunks embedding column exists with tenant columns beside it', () => {
    // Sanidad: el vector vive en la MISMA tabla que las columnas de tenant,
    // condición para que el WHERE por org/study preceda al ranking vectorial.
    expect(findColumn(chunks, 'embedding')).toBeDefined()
    expect(findColumn(chunks, 'organization_id')?.notNull).toBe(true)
    expect(findColumn(chunks, 'study_id')?.notNull).toBe(true)
  })
})
