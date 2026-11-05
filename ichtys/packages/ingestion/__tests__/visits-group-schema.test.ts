import { describe, expect, it } from 'vitest'
import { zodSchema } from 'ai'
import { z } from 'zod'
import { visitsGroupSchema } from '../spec-extractor'

const SUBSCHEMA_KEYWORDS = ['additionalProperties', 'contains', 'else', 'if', 'items', 'not', 'then']
const SUBSCHEMA_LIST_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const SUBSCHEMA_MAP_KEYWORDS = ['dependentSchemas', 'patternProperties', 'properties']

function countOptionalProperties(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 0
  const rec = node as Record<string, unknown>
  let count = 0
  if (rec.properties && typeof rec.properties === 'object') {
    const required = new Set(Array.isArray(rec.required) ? (rec.required as unknown[]) : [])
    count += Object.keys(rec.properties as object).filter((name) => !required.has(name)).length
  }
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    const value = rec[keyword]
    if (value !== undefined) count += countOptionalProperties(value)
  }
  for (const keyword of SUBSCHEMA_LIST_KEYWORDS) {
    const value = rec[keyword]
    if (Array.isArray(value)) for (const item of value) count += countOptionalProperties(item)
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const value = rec[keyword]
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as object)) count += countOptionalProperties(item)
    }
  }
  return count
}

describe('T11 visitas: el grupo no pasa de 10 opcionales', () => {
  it('windowBefore y windowAfter son requeridos y el total de opcionales queda ≤ 10', () => {
    const jsonSchema = zodSchema(visitsGroupSchema as z.ZodType).jsonSchema as {
      properties?: { visits?: { items?: { required?: string[] } } }
    }
    const required = jsonSchema.properties?.visits?.items?.required ?? []
    expect(required).toEqual(expect.arrayContaining(['windowBefore', 'windowAfter', 'windowDays']))
    expect(countOptionalProperties(jsonSchema)).toBeLessThanOrEqual(10)
  })
})
