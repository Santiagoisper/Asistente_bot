import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { labReports } from './lab-reports'
import { organizations } from './organizations'
import { studies } from './studies'

/**
 * lab_report_images — imagen recortada de un informe subido como foto o
 * escaneo. Existe solo mientras el informe está pendiente de revisión: la
 * persona necesita verla al lado de los campos para confirmar cada valor.
 * Al confirmar o rechazar el informe se borra. El contenido va cifrado con
 * @ichtys/crypto; el recorte se hace en el navegador y deja afuera el
 * encabezado con nombre y documento.
 */
export const labReportImages = pgTable(
  'lab_report_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => labReports.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    mime: text('mime').notNull(),
    contentEncrypted: text('content_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportPageIdx: uniqueIndex('lab_report_images_report_page_idx').on(table.reportId, table.page),
    orgIdx: index('lab_report_images_org_idx').on(table.organizationId),
  }),
)

export type LabReportImage = typeof labReportImages.$inferSelect
export type NewLabReportImage = typeof labReportImages.$inferInsert
