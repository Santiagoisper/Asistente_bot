import { describe, expect, it } from 'vitest'
import { zodSchema } from 'ai'
import { z } from 'zod'
// Importación por ruta (no dependencia): este test mide los esquemas REALES
// que viajan al proveedor en las llamadas estructuradas, vengan del paquete
// que vengan (ADR-8 §4). Los bare imports de esos archivos se resuelven desde
// el node_modules de cada paquete dueño del archivo.
import { answerSchema, confidenceOnlySchema } from '../../rag/answer-engine'
import {
  endpointsGroupSchema,
  eligibilityGroupSchema,
  identificationGroupSchema,
  sectionMapSchema,
  visitsGroupSchema,
} from '../../ingestion/spec-extractor'
import { llmFactsSchema } from '../../../apps/web/lib/subjects/patient-profile-service'
import { labObservationSchema } from '../../clinical/profile-schema'

/**
 * Instantáneas del JSON Schema que recibe el modelo en las llamadas
 * estructuradas (ADR-8 M4/M5). Con zod 3 `ai@7` usa su convertidor propio;
 * con zod 4 pasa por `toJSONSchema` de zod con `io: "input"` — el esquema
 * cambia y cada diferencia tiene que quedar explicada en el PR, no
 * desapercibida. El contador de opcionales replica la regla de
 * `supportsNativeStructuredOutputSchema` de @ai-sdk/anthropic (límite 10
 * del modo nativo, A1 §2.1).
 */
const STRUCTURED_SCHEMAS = {
  sectionMap: sectionMapSchema,
  eligibilityGroup: eligibilityGroupSchema,
  endpointsGroup: endpointsGroupSchema,
  visitsGroup: visitsGroupSchema,
  identificationGroup: identificationGroupSchema,
  confidenceOnly: confidenceOnlySchema,
  answer: answerSchema,
  llmFacts: llmFactsSchema,
} as const

// Misma regla que @ai-sdk/anthropic 4.0.96 dist/index.js:3826-3845.
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

describe('instantáneas de JSON Schema de las llamadas estructuradas (ADR-8 M4)', () => {
  for (const [name, schema] of Object.entries(STRUCTURED_SCHEMAS)) {
    it(`jsonSchema de ${name} coincide con la instantánea`, () => {
      // `as z.ZodType`: la unión de 8 esquemas distintos no unifica en las
      // sobrecargas de zodSchema; nos importa el JSON Schema, no el tipo.
      expect(zodSchema(schema as z.ZodType).jsonSchema).toMatchSnapshot()
    })
  }
})

describe('límite de 10 opcionales del modo nativo (ADR-8 M5)', () => {
  for (const [name, schema] of Object.entries(STRUCTURED_SCHEMAS)) {
    it(`${name} tiene ≤ 10 propiedades opcionales`, () => {
      const jsonSchema = zodSchema(schema as z.ZodType).jsonSchema as unknown
      expect(countOptionalProperties(jsonSchema)).toBeLessThanOrEqual(10)
    })
  }

  it('llmFacts queda en 9 (al límite, sin margen para campos nuevos opcionales)', () => {
    const jsonSchema = zodSchema(llmFactsSchema).jsonSchema as unknown
    expect(countOptionalProperties(jsonSchema)).toBe(9)
  })
})

describe('veredictos de validación sin cambio (ADR-8 M7)', () => {
  // Una salida válida típica por esquema (fixtures representativos de los
  // tests de spec-extractor y answer-engine) y su inversa inválida: al
  // migrar zod, los veredictos no pueden cambiar.
  const valid: Record<string, unknown> = {
    sectionMap: {
      eligibility: { pageStart: 3, pageEnd: 7 },
      endpoints: { pageStart: null, pageEnd: null },
      visits: { pageStart: 12, pageEnd: 20 },
      identification: { pageStart: 1, pageEnd: 2 },
      detectedLanguage: 'es',
    },
    eligibilityGroup: {
      inclusionCriteria: [
        { number: '1', text: 'Adultos 18-75 años', sourcePages: [4], confidence: 'high' },
      ],
      exclusionCriteria: [],
    },
    endpointsGroup: {
      endpoints: [
        {
          type: 'primary',
          objective: 'Evaluar eficacia',
          endpoint: 'Reducción de HbA1c ≥ 1%',
          sourcePages: [8],
          confidence: 'medium',
        },
      ],
    },
    visitsGroup: {
      visits: [
        {
          name: 'Visita 1 — screening',
          label: 'Día -14',
          day: -14,
          windowDays: 3,
          procedures: ['Consentimiento', 'Analítica de laboratorio'],
          sourcePages: [13],
          confidence: 'high',
        },
      ],
    },
    identificationGroup: {
      identification: {
        protocolCode: 'FICT-2026-01',
        title: 'Estudio ficticio',
        phase: 'Fase III',
        sourcePages: [1],
      },
    },
    confidenceOnly: { confidence: 'high' },
    answer: { answer: 'Sí, con cita [1].', confidence: 'medium', citationIndices: [1] },
    llmFacts: {
      ageYears: 63,
      labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
      medications: [{ name: 'Metformina', dose: '850 mg' }],
      conditions: ['Diabetes tipo 2'],
    },
  }

  for (const [name, schema] of Object.entries(STRUCTURED_SCHEMAS)) {
    it(`${name}: fixture válido sigue validando`, async () => {
      // `as never` como en los mocks de A7: el diccionario es heterogéneo y
      // cada esquema exige su propio tipo inferido.
      // validate es opcional en el tipo Schema, pero el wrapper zodSchema()
      // siempre lo define (el validador es el propio zod).
      const result = await zodSchema(schema as z.ZodType).validate!(valid[name] as never)
      expect(result.success).toBe(true)
    })

    it(`${name}: salida inválida sigue fallando`, async () => {
      const broken =
        name === 'sectionMap'
          ? { eligibility: { pageStart: 'tres' }, detectedLanguage: 42 }
          : name === 'confidenceOnly'
            ? { confidence: 'totalmente_seguro' }
            : name === 'answer'
              ? { answer: 'falta todo lo demás' }
              : name === 'llmFacts'
                ? { ageYears: 'sesenta y tres' }
                : { esto: 'no', matchea: 'nada' }
      const result = await zodSchema(schema as z.ZodType).validate!(broken)
      expect(result.success).toBe(false)
    })
  }
})

describe('colecciones enormes no agotan memoria (ADR-8 M9, GHSA-mrhx-c7xc-m3w5)', () => {
  // H7 (vuelta 2): zod 4.6.7 cierra el OOM, pero SIN .max un arreglo de
  // elementos INVÁLIDOS sigue acumulando un issue por elemento — el DoS
  // sigue vivo. Este es el rojo-verde real que reemplaza a la prueba vieja
  // de 10⁵ elementos VÁLIDOS (que también pasaba con zod 3 y no demostraba
  // nada): 200k elementos inválidos contra el esquema SIN cota (acumula
  // ~400k issues — así se ve el problema que motivó las cotas) y contra el
  // esquema CON .max (zod 4 corta ANTES de recorrer: un único too_big,
  // tiempo ~0).
  //
  // Rojo en zod 3: medido con 3.25.76 (heap 512 MB), el caso CON cota da
  // 400.001 issues en 605 ms — .max no corta antes, valida todo y suma el
  // too_big. Verde en 4.6.7: 1 issue, 0 ms.
  //
  // 500 = MAX_LAB_ITEMS de apps/web/lib/api/limits.ts (espejo local: este
  // package no puede importar de apps/web).
  const MAX_LAB_ITEMS = 500

  const invalidLabs = Array.from({ length: 200_000 }, () => ({
    name: '', // min(1) falla en cada elemento
    value: 'no-es-número', // falla el tipo en cada elemento
  }))

  it('SIN cota: 200k inválidos acumulan issues por elemento (el DoS que motivó las cotas)', () => {
    const unbounded = z.array(labObservationSchema)
    const result = unbounded.safeParse(invalidLabs)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.length).toBeGreaterThan(200_000)
  })

  it('CON cota: zod 4 corta ANTES de recorrer — un único too_big, tiempo acotado', { timeout: 60_000 }, () => {
    const bounded = z.array(labObservationSchema).max(MAX_LAB_ITEMS)
    const startedAt = Date.now()
    const result = bounded.safeParse(invalidLabs)
    expect(result.success).toBe(false)
    if (result.success) return
    const issues = result.error.issues
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('too_big')
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  })
})
