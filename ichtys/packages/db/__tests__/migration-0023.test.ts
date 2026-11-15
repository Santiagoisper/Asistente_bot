import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { agendaItems } from '../schema/agenda'
import { messages } from '../schema/conversations'

/**
 * 0023: el nombre del turno pasa a guardarse cifrado (R5) y cada respuesta del asistente
 * guarda con qué proveedor y modelo se generó (R6).
 * No es solo aditiva: le saca la obligatoriedad a la columna en claro del nombre del turno,
 * porque el código nuevo deja de escribirla. Ninguna fila existente cambia.
 */
const read = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8')
const statements = read('0023_agenda_title_encrypted_message_model.sql')
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
const column = (table: Parameters<typeof getTableConfig>[0], name: string) =>
  getTableConfig(table).columns.find((c) => c.name === name)

describe('migración 0023 — nombre del turno cifrado y modelo por respuesta', () => {
  it('son exactamente estas cuatro sentencias: tres columnas nuevas y una que deja de ser obligatoria', () => {
    expect(statements).toEqual([
      'ALTER TABLE "agenda_items" ADD COLUMN IF NOT EXISTS "title_encrypted" text;',
      'ALTER TABLE "agenda_items" ALTER COLUMN "title" DROP NOT NULL;',
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider" text;',
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "model" text;',
    ])
  })

  it('no borra columnas, tablas ni filas, y no reescribe ningún valor', () => {
    expect(statements.join('\n')).not.toMatch(/DROP\s+(COLUMN|TABLE)|DELETE\s+FROM|TRUNCATE|UPDATE\s|RENAME\s/i)
  })

  it('las columnas nuevas son opcionales: las filas que ya existen quedan sin valor', () => {
    expect(column(agendaItems, 'title_encrypted')?.notNull).toBe(false)
    expect(column(messages, 'provider')?.notNull).toBe(false)
    expect(column(messages, 'model')?.notNull).toBe(false)
  })

  it('la columna en claro del nombre del turno sigue existiendo, ya sin ser obligatoria', () => {
    expect(column(agendaItems, 'title')?.notNull).toBe(false)
  })

  it('está en el registro de migraciones, después de la 0022', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> }
    const [previous, last] = journal.entries.filter((entry) => entry.idx === 22 || entry.idx === 23)
    expect([previous!.idx, previous!.tag]).toEqual([22, '0022_dictation_audio_segments'])
    expect([last!.idx, last!.tag]).toEqual([23, '0023_agenda_title_encrypted_message_model'])
    expect(last!.when).toBeGreaterThan(previous!.when)
  })
})
