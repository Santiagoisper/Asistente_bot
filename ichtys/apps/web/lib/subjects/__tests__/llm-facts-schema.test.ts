import { zodSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import { llmFactsSchema, normalizeLlmFacts } from '../llm-facts'

/**
 * El esquema que se le manda al modelo para leer una evolución tiene que
 * servir en cualquier proveedor de la cadena. Los que validan la salida de
 * forma estricta (OpenAI) rechazan el pedido si una propiedad no figura como
 * requerida o si el esquema trae restricciones que no admiten: con el esquema
 * anterior, cuando Anthropic no respondía, el respaldo fallaba siempre con 400.
 */
const UNSUPPORTED = ['default', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems']

function objects(node: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (typeof node !== 'object' || node === null) return found
  if (Array.isArray(node)) {
    for (const item of node) objects(item, found)
    return found
  }
  const record = node as Record<string, unknown>
  if (record.properties && typeof record.properties === 'object') found.push(record)
  for (const value of Object.values(record)) objects(value, found)
  return found
}

describe('llmFactsSchema — apto para proveedores con salida estricta', () => {
  const jsonSchema = zodSchema(llmFactsSchema).jsonSchema as unknown

  it('toda propiedad de todo objeto figura como requerida', () => {
    const all = objects(jsonSchema)
    expect(all.length).toBeGreaterThanOrEqual(3) // raíz, laboratorio, medicación
    for (const object of all) {
      expect([...((object.required as string[] | undefined) ?? [])].sort()).toEqual(Object.keys(object.properties as object).sort())
    }
  })

  it('no trae restricciones que esos proveedores no admiten', () => {
    const text = JSON.stringify(jsonSchema)
    for (const keyword of UNSUPPORTED) expect(text, keyword).not.toContain(`"${keyword}"`)
  })
})

describe('normalizeLlmFacts — lo que el esquema ya no valida, se valida acá', () => {
  it('saca los nulos y deja lo que el modelo sí leyó', () => {
    expect(
      normalizeLlmFacts({
        ageYears: 52,
        systolic: null,
        diastolic: 82,
        labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }, { name: 'Glucosa', value: 110, unit: null }],
        medications: [{ name: 'Metformina', dose: '850 mg', frequency: null }],
        conditions: ['Diabetes tipo 2'],
      }),
    ).toEqual({
      ageYears: 52,
      systolic: undefined,
      diastolic: 82,
      labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }, { name: 'Glucosa', value: 110 }],
      medications: [{ name: 'Metformina', dose: '850 mg' }],
      conditions: ['Diabetes tipo 2'],
    })
  })

  it('descarta enteros fuera del rango seguro (el esquema anterior los rechazaba)', () => {
    const facts = normalizeLlmFacts({ ageYears: 1e30, systolic: Number.MAX_SAFE_INTEGER + 2, diastolic: 80, labs: [], medications: [], conditions: [] })
    expect(facts).toMatchObject({ ageYears: undefined, systolic: undefined, diastolic: 80 })
  })

  it('descarta números que no pueden ser una edad o una presión, y textos vacíos', () => {
    expect(
      normalizeLlmFacts({
        ageYears: 0,
        systolic: -120,
        diastolic: 80.5,
        labs: [{ name: '  ', value: 1, unit: '' }, { name: 'Creatinina', value: 0.9, unit: '  ' }],
        medications: [{ name: '', dose: null, frequency: null }],
        conditions: ['', '  ', 'Hipertensión'],
      }),
    ).toEqual({
      ageYears: undefined,
      systolic: undefined,
      diastolic: undefined,
      labs: [{ name: 'Creatinina', value: 0.9 }],
      medications: [],
      conditions: ['Hipertensión'],
    })
  })
})
