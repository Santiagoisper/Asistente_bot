import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { messages } from '../schema/conversations'

/** 0024: la base exige que un mensaje de la persona no tenga proveedor ni modelo (R6). */
const read = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8')
const statements = read('0024_messages_model_only_on_assistant.sql')
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

describe('migración 0024 — solo las respuestas del asistente tienen modelo', () => {
  it('es una sola sentencia: la regla, y se puede aplicar dos veces sin error', () => {
    expect(statements).toEqual([
      `DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_model_only_on_assistant_check" CHECK ("role" = 'assistant' OR ("provider" IS NULL AND "model" IS NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    ])
  })

  it('el esquema declara la misma regla, con el mismo nombre', () => {
    expect(getTableConfig(messages).checks.map((c) => c.name)).toEqual(['messages_model_only_on_assistant_check'])
  })

  it('no toca la 0023, que ya se integró: sigue con sus cuatro sentencias', () => {
    expect(read('0023_agenda_title_encrypted_message_model.sql')).not.toContain('messages_model_only_on_assistant_check')
  })

  it('está en el registro de migraciones, última y después de la 0023', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> }
    const [previous, last] = journal.entries.slice(-2)
    expect([previous!.idx, previous!.tag]).toEqual([23, '0023_agenda_title_encrypted_message_model'])
    expect([last!.idx, last!.tag]).toEqual([24, '0024_messages_model_only_on_assistant'])
    expect(last!.when).toBeGreaterThan(previous!.when)
  })
})
