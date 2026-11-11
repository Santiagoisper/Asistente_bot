import { sql } from 'drizzle-orm'
import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { memberFunction } from './enums'
import { organizations } from './organizations'
import { studies } from './studies'

/**
 * Acceso por estudio (docs/decisions/study-membership.md). Dos ejes:
 *
 * - `member_functions`: qué PUEDE HACER una persona en el centro. Acumulables.
 * - `study_memberships`: a QUÉ ESTUDIOS entra. No lleva permisos.
 *
 * En las dos tablas la baja marca `revoked_at` y no borra la fila: «quién
 * tenía acceso el día tal» tiene que poder responderse.
 */

/** member_functions — funciones de una persona dentro de una organización. */
export const memberFunctions = pgTable(
  'member_functions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Identificador del usuario en el proveedor de identidad. */
    userId: text('user_id').notNull(),
    functionKey: text('function_key', { enum: memberFunction }).notNull(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedBy: text('revoked_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    activeUniqueIdx: uniqueIndex('member_functions_active_uniq')
      .on(table.organizationId, table.userId, table.functionKey)
      .where(sql`${table.revokedAt} is null`),
    orgUserIdx: index('member_functions_org_user_idx').on(table.organizationId, table.userId),
  }),
)

/** study_memberships — a qué estudios entra una persona. */
export const studyMemberships = pgTable(
  'study_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id').notNull(),
    /** Identificador del usuario en el proveedor de identidad. */
    userId: text('user_id').notNull(),
    /** «PI», «Sub-PI». Informativo: NO autoriza nada. */
    studyLabel: text('study_label'),
    /** Null = sin vencimiento. Vencida, no da acceso. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedBy: text('revoked_by'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    // Compuesta: una membresía no puede apuntar a un estudio de otra
    // organización. Sin cascada: borrar un estudio suelto no se lleva su
    // historia de accesos. Borrar la organización entera sí funciona, porque
    // la cascada desde `organizations` quita estas filas en la misma sentencia
    // y NO ACTION se comprueba al final.
    studyOrgFk: foreignKey({
      name: 'study_memberships_study_org_fk',
      columns: [table.studyId, table.organizationId],
      foreignColumns: [studies.id, studies.organizationId],
    }),
    activeUniqueIdx: uniqueIndex('study_memberships_active_uniq')
      .on(table.studyId, table.userId)
      .where(sql`${table.revokedAt} is null`),
    orgUserIdx: index('study_memberships_org_user_idx')
      .on(table.organizationId, table.userId)
      .where(sql`${table.revokedAt} is null`),
  }),
)

export type MemberFunctionRow = typeof memberFunctions.$inferSelect
export type NewMemberFunctionRow = typeof memberFunctions.$inferInsert
export type StudyMembership = typeof studyMemberships.$inferSelect
export type NewStudyMembership = typeof studyMemberships.$inferInsert
