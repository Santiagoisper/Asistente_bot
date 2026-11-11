import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { labReportSourceKind, labReportStatus } from './enums'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/**
 * lab_analytes — catálogo de analitos por organización. No es dato de paciente.
 * Lo que un informe trae y el catálogo no conoce entra como campo nuevo al
 * confirmar; `normalized_key` evita duplicar por mayúsculas o acentos.
 */
export const labAnalytes = pgTable(
  'lab_analytes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Como figuró impreso la primera vez. */
    name: text('name').notNull(),
    normalizedKey: text('normalized_key').notNull(),
    /** Última unidad vista. */
    unit: text('unit'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgKeyIdx: uniqueIndex('lab_analytes_org_key_idx').on(table.organizationId, table.normalizedKey),
  }),
)

export type LabAnalyte = typeof labAnalytes.$inferSelect
export type NewLabAnalyte = typeof labAnalytes.$inferInsert

/**
 * lab_reports — informe de laboratorio subido para un sujeto.
 * Todo valor clínico vive en `content_encrypted` (transcripción y filas,
 * cifrado con @ichtys/crypto). Las columnas en claro son operativas.
 * El archivo original no se guarda.
 */
export const labReports = pgTable(
  'lab_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    status: text('status', { enum: labReportStatus }).notNull().default('pending_review'),
    sourceKind: text('source_kind', { enum: labReportSourceKind }).notNull(),
    contentEncrypted: text('content_encrypted').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('lab_reports_org_status_idx').on(table.organizationId, table.status),
    subjectIdx: index('lab_reports_subject_idx').on(table.subjectId, table.createdAt),
  }),
)

export type LabReport = typeof labReports.$inferSelect
export type NewLabReport = typeof labReports.$inferInsert
