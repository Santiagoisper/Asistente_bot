import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { messages } from '../schema/conversations'

/** 0025: proveedor y modelo van juntos; o están los dos o no está ninguno (R6). */
const read = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8')
const statements = read('0025_messages_provider_and_model_together.sql')
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

describe('migración 0025 — proveedor y modelo van juntos', () => {
  it('es una sola sentencia: la regla, y se puede aplicar dos veces sin error', () => {
    expect(statements).toEqual([
      `DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_provider_and_model_together_check" CHECK (("provider" IS NULL) = ("model" IS NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    ])
  })

  it('el esquema declara las dos reglas del mensaje, con los mismos nombres', () => {
    expect(getTableConfig(messages).checks.map((c) => c.name).sort()).toEqual([
      'messages_model_only_on_assistant_check',
      'messages_provider_and_model_together_check',
    ])
  })

  it('no toca la 0023 ni la 0024, que ya se integraron', () => {
    expect(read('0023_agenda_title_encrypted_message_model.sql')).not.toContain('together')
    expect(read('0024_messages_model_only_on_assistant.sql')).not.toContain('together')
  })

  it('está en el registro de migraciones, última y después de la 0024', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> }
    const [previous, last] = journal.entries.slice(-2)
    expect([previous!.idx, previous!.tag]).toEqual([24, '0024_messages_model_only_on_assistant'])
    expect([last!.idx, last!.tag]).toEqual([25, '0025_messages_provider_and_model_together'])
    expect(last!.when).toBeGreaterThan(previous!.when)
  })
})
