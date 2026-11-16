import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { conversations, messages } from '../schema/conversations'

/**
 * 0026 (PR-A del chat cifrado, diseño de Architect 7a7b2edf + decisiones de Fable):
 * el contenido de los mensajes y el título de la conversación pasan a guardarse cifrados.
 * Solo agrega (regla 48): se aplica y se verifica ANTES de integrar el código que escribe
 * estas columnas; ninguna fila cambia. Las anotaciones no se cifran: se dejan de guardar.
 */
const read = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8')
const statements = read('0026_chat_content_encrypted.sql')
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
const column = (table: Parameters<typeof getTableConfig>[0], name: string) =>
  getTableConfig(table).columns.find((c) => c.name === name)

describe('migración 0026 — contenido del mensaje y título de la conversación, cifrados', () => {
  it('son exactamente estas cuatro sentencias: dos columnas nuevas, una que deja de ser obligatoria y el CHECK', () => {
    expect(statements).toEqual([
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "content_encrypted" text;',
      'ALTER TABLE "messages" ALTER COLUMN "content" DROP NOT NULL;',
      'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "title_encrypted" text;',
      'DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = \'messages_content_present\') THEN\n    ALTER TABLE "messages" ADD CONSTRAINT "messages_content_present"\n      CHECK (content IS NOT NULL OR content_encrypted IS NOT NULL);\n  END IF;\nEND\n$$;',
    ])
  })

  it('no borra columnas, tablas ni filas, y no reescribe ningún valor', () => {
    expect(statements.join('\n')).not.toMatch(/DROP\s+(COLUMN|TABLE)|DELETE\s+FROM|TRUNCATE|UPDATE\s|RENAME\s/i)
  })

  it('las columnas nuevas son opcionales: las filas que ya existen quedan sin valor', () => {
    expect(column(messages, 'content_encrypted')?.notNull).toBe(false)
    expect(column(conversations, 'title_encrypted')?.notNull).toBe(false)
  })

  it('la columna en claro del mensaje sigue existiendo, ya sin ser obligatoria; el título en claro queda como estaba', () => {
    expect(column(messages, 'content')?.notNull).toBe(false)
    expect(column(conversations, 'title')?.notNull).toBe(false)
  })

  it('todo mensaje tiene cuerpo: el CHECK pide content heredada O la cifrada, y no falla si ya existe (pg_constraint)', () => {
    const texto = statements.join('\n')
    expect(texto).toContain("ADD CONSTRAINT \"messages_content_present\"")
    expect(texto).toContain('CHECK (content IS NOT NULL OR content_encrypted IS NOT NULL)')
    expect(texto).toContain("SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_present'")
  })

  it('sin annotations_encrypted: las anotaciones se dejan de guardar (decisión de Fable), no se cifran', () => {
    expect(statements.join('\n')).not.toContain('annotations')
  })

  it('está en el registro de migraciones, después de la 0025', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> }
    const [previous, last] = journal.entries.filter((entry) => entry.idx === 25 || entry.idx === 26)
    expect([previous!.idx, previous!.tag]).toEqual([25, '0025_messages_provider_and_model_together'])
    expect([last!.idx, last!.tag]).toEqual([26, '0026_chat_content_encrypted'])
    expect(last!.when).toBeGreaterThan(previous!.when)
  })
})
