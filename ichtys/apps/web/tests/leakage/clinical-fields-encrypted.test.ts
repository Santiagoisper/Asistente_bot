import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '@ichtys/db/schema'

/**
 * Datos de salud cifrados campo por campo (regla R5 del marco normativo).
 *
 * Tripwire sobre el esquema. En toda tabla que guarda contenido de un sujeto, cada columna que no sea un
 * identificador, una fecha con hora o un sí/no tiene que ser una columna cifrada (su nombre termina en
 * `_encrypted`) o figurar en la lista de abajo con el motivo por el que va en claro. La regla va al
 * revés a propósito: un tipo de columna nuevo (un número, una fecha, un texto de otro tipo) cae del
 * lado que obliga a decidir. Una columna nueva en una de esas tablas rompe la prueba.
 *
 * Qué tablas mira: las que tienen `subject_id`, la de sujetos, y las que guardan contenido salido de un
 * sujeto sin llevar esa columna (`EXTRA_TABLES`). Una tabla nueva de este último tipo hay que sumarla a mano.
 *
 * Límites:
 * - Mira el nombre de la columna, no lo que se escribe en ella: que una columna `_encrypted` reciba
 *   texto cifrado lo prueban las pruebas de cada servicio, no esta.
 * - No mira `messages` ni `chunks`: son preguntas al asistente y texto de documentos del estudio, que
 *   hoy van en claro. Si eso es dato de salud es una decisión que esta guarda no toma.
 * - No mira `audit_logs.metadata`, que es una estructura libre. Hoy guarda motivos de lista cerrada,
 *   nombres de archivo y cantidades; nada impide que un servicio nuevo escriba ahí el texto de una nota.
 *   Que el registro no lleve contenido clínico lo prueban las pruebas de cada ruta, no esta.
 * - Importa solo el esquema, sin cliente: no necesita una base.
 */
const EXTRA_TABLES = ['subjects', 'lab_report_images', 'unassigned_dictation_audios']

/** Columnas en claro, con su motivo. `tabla.columna` → por qué. */
const PLAIN: Record<string, string> = {
  'subjects.subject_code': 'TEXTO LIBRE EN CLARO (hasta 32 letras, números y guiones): código del sujeto. El esquema lo define como código operativo sin datos personales, pero nada impide que un centro cargue iniciales o un documento, y se muestra en el inicio, en laboratorios y en la exportación. Decisión pendiente: restringir el formato',
  'subjects.status': 'estado del sujeto, de una lista cerrada',
  'clinical_evolutions.dictation_takes': 'cantidad de tomas dictadas',
  'screening_assessments.study_spec_version': 'número de versión del protocolo extraído',
  'lab_reports.row_count': 'cantidad de renglones del informe',
  'lab_report_images.page': 'número de página',
  'dictation_audios.take': 'número de toma',
  'dictation_audios.size_bytes': 'tamaño del archivo',
  'dictation_audios.duration_sec': 'duración de la grabación',
  'unassigned_dictation_audios.take': 'número de toma',
  'unassigned_dictation_audios.size_bytes': 'tamaño del archivo',
  'unassigned_dictation_audios.duration_sec': 'duración de la grabación',
  'agenda_items.duration_minutes': 'duración del turno',
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

/** Lo único que no hace falta anotar: identificadores, fechas con hora y sí/no. */
const STRUCTURAL = /^(uuid|timestamp|boolean)/i

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
  table.columns.filter((column) => !STRUCTURAL.test(column.getSQLType()) && !column.name.endsWith('_encrypted')).map((column) => `${table.name}.${column.name}`),
)

describe('leakage — datos de salud cifrados campo por campo (R5)', () => {
  it('mira las tablas con contenido de un sujeto', () => {
    expect(watched.map((table) => table.name).sort()).toEqual(
      ['agenda_items', 'clinical_evolutions', 'dictation_audios', 'evolution_voids', 'lab_report_images', 'lab_reports', 'patient_profiles', 'screening_assessments', 'subjects', 'unassigned_dictation_audios'].sort(),
    )
  })

  it('cada columna en claro está anotada con su motivo; las demás son cifradas', () => {
    expect(plainColumns.sort()).toEqual(Object.keys(PLAIN).sort())
  })

  it('cada tabla mirada tiene al menos una columna cifrada', () => {
    const without = watched.filter((table) => !['screening_assessments', 'subjects'].includes(table.name) && !table.columns.some((column) => column.name.endsWith('_encrypted'))).map((table) => table.name)
    expect(without).toEqual([])
  })

  it('cada motivo dice algo', () => {
    for (const [column, why] of Object.entries(PLAIN)) expect(why.length, column).toBeGreaterThan(10)
  })

  it('el texto libre en claro es exactamente el que está marcado como decisión pendiente', () => {
    const pending = Object.entries(PLAIN).filter(([, why]) => why.startsWith('TEXTO LIBRE EN CLARO')).map(([column]) => column)
    expect(pending.sort()).toEqual(['agenda_items.title', 'clinical_evolutions.visit_label', 'subjects.subject_code'])
  })
})
