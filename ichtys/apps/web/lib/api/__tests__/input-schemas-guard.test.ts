/**
 * Test guardián de cotas (vuelta 3 del delta zod, H7).
 *
 * TODO esquema que parsea entrada HTTP tiene que acotar sus arrays
 * (maxItems), records (maxProperties) y strings (maxLength): sin cota, un
 * payload de elementos inválidos acumula un issue por elemento (Sicario
 * vuelta 3: 120k sourcePages inválidos → 120k issues y respuesta de 18 MB).
 * El guardián convierte cada esquema externo a JSON Schema y lo recorre
 * completo — si alguien agrega un campo externo sin tope, este test falla.
 *
 * Tolerados (no amplifican): enums y literals (a lo sumo 1 issue por
 * payload), números y booleanos. Los uuid llevan .max(64) como cualquier
 * string. Los esquemas de SALIDA del LLM no están aquí: no parsean HTTP.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  answerTestInput,
  chatInput,
  createStudyInput,
  patchSchema,
  specDiffQueryInput,
  triggerInput,
} from '../input-schemas'
import {
  createEvolutionSchema,
  createSubjectSchema,
  labOcrConfirmSchema,
  labOcrExtractSchema,
} from '../../subjects/schemas'
import { studySpecSchema } from '@ichtys/ingestion'

const EXTERNAL_SCHEMAS = {
  chatInput,
  answerTestInput,
  triggerInput,
  patchSchema,
  createStudyInput,
  specDiffQueryInput,
  createSubjectSchema,
  createEvolutionSchema,
  labOcrExtractSchema,
  labOcrConfirmSchema,
  studySpecSchema,
} as const

type JsonNode = Record<string, unknown>

function walk(node: JsonNode, path: string, problems: string[]): void {
  if (typeof node !== 'object' || node === null) return

  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = node[keyword]
    if (Array.isArray(branches)) {
      branches.forEach((branch, i) => walk(branch, `${path}.${keyword}[${i}]`, problems))
    }
  }
  if (node.items !== undefined) walk(node.items as JsonNode, `${path}.items`, problems)
  if (Array.isArray(node.prefixItems)) {
    node.prefixItems.forEach((item, i) =>
      walk(item as JsonNode, `${path}.prefixItems[${i}]`, problems),
    )
  }
  if (node.properties !== undefined && typeof node.properties === 'object' && node.properties !== null) {
    for (const [key, value] of Object.entries(node.properties as Record<string, unknown>)) {
      walk(value as JsonNode, `${path}.${key}`, problems)
    }
  }
  if (
    node.additionalProperties !== undefined &&
    typeof node.additionalProperties === 'object' &&
    node.additionalProperties !== null
  ) {
    walk(node.additionalProperties as JsonNode, `${path}.additionalProperties`, problems)
  }

  if (node.type === 'array' && node.maxItems === undefined) {
    problems.push(`${path}: array sin maxItems`)
  }
  if (
    node.type === 'string' &&
    node.maxLength === undefined &&
    node.enum === undefined &&
    node.const === undefined
  ) {
    problems.push(`${path}: string sin maxLength`)
  }
  // record = objeto de claves dinámicas (sin properties fijas).
  if (
    node.type === 'object' &&
    node.properties === undefined &&
    node.maxProperties === undefined &&
    (node.additionalProperties !== undefined || node.propertyNames !== undefined)
  ) {
    problems.push(`${path}: record sin maxProperties`)
  }
}

describe('guardián de cotas — todo esquema externo acota arrays, records y strings', () => {
  it('ningún esquema externo queda sin cota', () => {
    const problems: string[] = []
    for (const [name, schema] of Object.entries(EXTERNAL_SCHEMAS)) {
      const json = z.toJSONSchema(schema, { io: 'input' })
      walk(json, name, problems)
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('el guardián detecta arrays y strings sin cota (autochequeo con schema trampa)', () => {
    const trampa = z.object({
      items: z.array(z.string()),
      etiqueta: z.string(),
      porClave: z.record(z.string(), z.number()),
    })
    const json = z.toJSONSchema(trampa, { io: 'input' })
    const problems: string[] = []
    walk(json, 'trampa', problems)
    expect(problems).toContain('trampa.items: array sin maxItems')
    expect(problems).toContain('trampa.etiqueta: string sin maxLength')
    expect(problems).toContain('trampa.porClave: record sin maxProperties')
  })
})
