import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '@ichtys/db/schema'

/**
 * Datos de salud cifrados campo por campo (regla R5 del marco normativo).
 *
 * Tripwire sobre el esquema. En toda tabla que guarda contenido de un sujeto, cada columna de texto o
 * de estructura libre tiene que ser una columna cifrada (su nombre termina en `_encrypted`) o figurar en
 * la lista de abajo con el motivo por el que va en claro. Una columna nueva en una de esas tablas rompe
 * la prueba hasta que alguien decida de qué lado cae.
 *
 * Qué tablas mira: las que tienen `subject_id`, y las que guardan contenido salido de un sujeto sin
 * llevar esa columna (`EXTRA_TABLES`). Una tabla nueva de este segundo tipo hay que sumarla a mano.
 *
 * Límites:
 * - Mira el nombre de la columna, no lo que se escribe en ella: que una columna `_encrypted` reciba
 *   texto cifrado lo prueban las pruebas de cada servicio, no esta.
 * - No mira `messages` ni `chunks`: son preguntas al asistente y texto de documentos del estudio, que
 *   hoy van en claro. Si eso es dato de salud es una decisión que esta guarda no toma.
 * - Importa solo el esquema, sin cliente: no necesita una base.
 */
const EXTRA_TABLES = ['lab_report_images', 'unassigned_dictation_audios']

/** Columnas en claro, con su motivo. `tabla.columna` → por qué. */
const PLAIN: Record<string, string> = {
  'clinical_evolutions.author_user_id': 'identificador de quien escribió, no dato del sujeto',
  'clinical_evolutions.visit_label': 'TEXTO LIBRE EN CLARO (hasta 100 caracteres): nombre de la visita. Nada impide escribir ahí un dato del sujeto. Decisión pendiente: cifrarlo o limitarlo a una lista',
  'screening_assessments.assessments': 'estructura que guarda un sobre cifrado; lo prueban screening-crypto y screening-seal',
  'screening_assessments.summary': 'estructura que guarda un sobre cifrado; lo prueban screening-crypto y screening-seal',
  'lab_reports.status': 'estado del informe, de una lista cerrada',
  'lab_reports.source_kind': 'camino por el que entró, de una lista cerrada',
  'lab_reports.created_by': 'identificador de quien lo cargó',
  'lab_reports.reviewed_by': 'identificador de quien lo revisó',
  'lab_report_images.mime': 'tipo de archivo',
  'dictation_audios.mime': 'tipo de archivo',
  'dictation_audios.sha256': 'huella del archivo; no permite reconstruir el contenido',
  'dictation_audios.created_by': 'identificador de quien grabó',
  'unassigned_dictation_audios.mime': 'tipo de archivo',
  'unassigned_dictation_audios.sha256': 'huella del archivo; no permite reconstruir el contenido',
  'unassigned_dictation_audios.created_by': 'identificador de quien grabó',
  'unassigned_dictation_audios.declared_by': 'identificador de quien declaró el error',
  'evolution_voids.reason': 'motivo de la anulación, de una lista cerrada; la nota libre va cifrada aparte',
  'evolution_voids.declared_by': 'identificador de quien declaró el error',
  'agenda_items.title': 'TEXTO LIBRE EN CLARO (hasta 80 caracteres): nombre operativo del turno. El esquema dice que no lleva datos del paciente, pero nada lo impide. Decisión pendiente: cifrarlo o limitarlo a una lista',
  'agenda_items.kind': 'tipo de turno, de una lista cerrada',
  'agenda_items.status': 'estado del turno, de una lista cerrada',
  'agenda_items.created_by': 'identificador de quien lo agendó',
  'agenda_items.updated_by': 'identificador de quien lo cambió',
}

const FREE_FORM = /^(text|varchar|character varying|jsonb?|bytea)/i

function tables() {
  return Object.values(schema).flatMap((value) => {
    try {
      const config = getTableConfig(value as PgTable)
      return config.columns.length > 0 ? [config] : []
    } catch {
      return []
    }
  })
}

const watched = tables().filter((table) => table.columns.some((column) => column.name === 'subject_id') || EXTRA_TABLES.includes(table.name))
const plainColumns = watched.flatMap((table) =>
  table.columns.filter((column) => FREE_FORM.test(column.getSQLType()) && !column.name.endsWith('_encrypted')).map((column) => `${table.name}.${column.name}`),
)

describe('leakage — datos de salud cifrados campo por campo (R5)', () => {
  it('mira las tablas con contenido de un sujeto', () => {
    expect(watched.map((table) => table.name).sort()).toEqual(
      ['agenda_items', 'clinical_evolutions', 'dictation_audios', 'evolution_voids', 'lab_report_images', 'lab_reports', 'patient_profiles', 'screening_assessments', 'unassigned_dictation_audios'].sort(),
    )
  })

  it('cada columna de texto en claro está anotada con su motivo; las demás son cifradas', () => {
    expect(plainColumns.sort()).toEqual(Object.keys(PLAIN).sort())
  })

  it('cada tabla mirada tiene al menos una columna cifrada', () => {
    const without = watched.filter((table) => table.name !== 'screening_assessments' && !table.columns.some((column) => column.name.endsWith('_encrypted'))).map((table) => table.name)
    expect(without).toEqual([])
  })

  it('cada motivo dice algo', () => {
    for (const [column, why] of Object.entries(PLAIN)) expect(why.length, column).toBeGreaterThan(10)
  })

  it('el texto libre en claro es exactamente el que está marcado como decisión pendiente', () => {
    const pending = Object.entries(PLAIN).filter(([, why]) => why.startsWith('TEXTO LIBRE EN CLARO')).map(([column]) => column)
    expect(pending.sort()).toEqual(['agenda_items.title', 'clinical_evolutions.visit_label'])
  })
})
