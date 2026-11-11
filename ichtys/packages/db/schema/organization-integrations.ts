import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { integrationCategory } from './enums'
import { organizations } from './organizations'

/** Ajustes no secretos de una integración. Las credenciales van en `secrets_encrypted`. */
export type IntegrationSettings = Record<string, string | number | boolean | null>

/**
 * organization_integrations — qué tiene conectado cada organización.
 *
 * Una fila por integración y organización. `category` separa los módulos del
 * OS (Queries, Viáticos, Operación) de los conectores a sistemas de destino
 * (historia clínica, eCRF). Sin fila, la organización no tiene esa integración:
 * dos centros pueden convivir en la misma instalación con módulos distintos.
 *
 * `simulated` marca un conector de demostración: nunca se presenta como real.
 * Las credenciales solo se guardan cifradas.
 */
export const organizationIntegrations = pgTable(
  'organization_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    category: text('category', { enum: integrationCategory }).notNull(),
    /** Identificador estable: 'queries', 'viaticos', 'operacion', o el id de un conector. */
    integrationKey: text('integration_key').notNull(),
    baseUrl: text('base_url'),
    enabled: boolean('enabled').notNull().default(true),
    simulated: boolean('simulated').notNull().default(false),
    settings: jsonb('settings').$type<IntegrationSettings>(),
    secretsEncrypted: text('secrets_encrypted'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgKeyIdx: uniqueIndex('organization_integrations_org_key_idx').on(table.organizationId, table.integrationKey),
  }),
)

export type OrganizationIntegration = typeof organizationIntegrations.$inferSelect
export type NewOrganizationIntegration = typeof organizationIntegrations.$inferInsert
