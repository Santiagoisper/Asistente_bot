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
// P3 (ADR-10 §3): el contrato Schedule del paquete soa y los esquemas de
// SALIDA de sus 4 llamadas (estos sí viajan al proveedor como output
// schema). Registran aquí su forma (M4) y su cuenta de opcionales (M5).
import { scheduleSchema } from '../../soa/schedule-contract'
import {
  headersOutputSchema,
  notesOutputSchema,
  rowsOutputSchema,
  rulesOutputSchema,
} from '../../soa/normalize/llm-steps'
// Esquema y tope REALES de la ruta labs/confirm (Architect, vuelta 3): el M9
// no usa una copia local — si alguien cambia el tope, este test lo sigue.
import { labOcrConfirmSchema } from '../../../apps/web/lib/subjects/schemas'
import { MAX_LAB_ITEMS } from '../../../apps/web/lib/api/limits'

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
  scheduleContract: scheduleSchema,
  soaHeadersOutput: headersOutputSchema,
  soaRowsOutput: rowsOutputSchema,
  soaNotesOutput: notesOutputSchema,
  soaRulesOutput: rulesOutputSchema,
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
          windowBefore: null,
          windowAfter: null,
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
    // P3: Schedule mínimo que toca todas las ramas del contrato (ADR-10 §3).
    scheduleContract: {
      tables: [
        {
          key: 'T1',
          title: 'Cronograma de la rama principal',
          branch: null,
          phase: null,
          pages: [2, 3],
          outcome: 'complete',
          reasons: [],
        },
      ],
      visits: [
        {
          key: 'T1-C01',
          tableKey: 'T1',
          printedId: 'V1',
          label: 'Día 1',
          timing: { kind: 'scheduled', value: 1, unit: 'day', anchor: null, recurrence: null },
          window: { before: 2, after: 2, unit: 'day' },
          type: 'standard',
          attributes: { fasting: null, onSite: true, armOnly: null },
          source: { page: 2, bbox: [100, 400, 120, 412] },
          confidence: 1,
        },
        {
          key: 'T1-C02',
          tableKey: 'T1',
          printedId: 'VR1',
          label: 'Rescate 1',
          timing: {
            kind: 'recurrent',
            value: 12,
            unit: 'week',
            anchor: null,
            recurrence: { every: 12, unit: 'week', until: 'S104' },
          },
          window: null,
          type: 'follow_up',
          attributes: { fasting: null, onSite: null, armOnly: 'A' },
          source: { page: 2, bbox: [122, 400, 142, 412] },
          confidence: 0.9,
        },
      ],
      procedures: [
        {
          key: 'P01',
          label: 'Analítica de laboratorio',
          section: null,
          kind: 'procedure',
          conditions: [],
          source: { page: 2, bbox: [40, 380, 90, 390] },
        },
      ],
      cells: [
        {
          visitKey: 'T1-C01',
          procedureKey: 'P01',
          mark: 'x',
          noteRefs: ['1'],
          conditions: [],
          procedureWindow: null,
          source: { page: 2, bbox: [100, 380, 120, 390] },
          confidence: 1,
          reviewed: false,
        },
        {
          visitKey: 'T1-C02',
          procedureKey: 'P01',
          mark: 'prn_range',
          noteRefs: [],
          conditions: [
            {
              kind: 'dose_timing',
              expr: 'Entre 1 y 2 horas después de la dosis',
              sourceRef: '2',
              page: 2,
              confidence: 1,
            },
          ],
          procedureWindow: { before: 4, after: 2, unit: 'week' },
          source: { page: 2, bbox: [122, 380, 142, 390] },
          confidence: 0.8,
          reviewed: false,
        },
      ],
      notes: [
        {
          ref: '1',
          tableKey: 'T1',
          text: 'Solo en participantes del brazo A',
          page: 2,
          conditions: [
            { kind: 'arm', expr: 'brazo A', sourceRef: '1', page: 2, confidence: 1 },
          ],
        },
      ],
      outOfTableRules: [
        {
          text: 'Ventana propia: −4/+2 semanas',
          page: 1,
          conditions: [
            {
              kind: 'dose_timing',
              expr: 'ventana propia −4/+2 semanas',
              sourceRef: '',
              page: 1,
              confidence: 1,
            },
          ],
        },
      ],
      inconsistencies: [
        {
          kind: 'hybrid_set_mismatch',
          description: 'La fila hibrida no coincide con las marcas de la grilla',
          pages: [2, 3],
          status: 'open',
        },
      ],
    },
    // P3: salidas de las 4 llamadas del normalizador (orden B-P3 §2).
    soaHeadersOutput: {
      headers: [
        { col: 0, printedIdSpan: [0, 2], type: 'screening' },
        {
          col: 1,
          printedIdSpan: null,
          type: 'unscheduled',
          timingIfUnparsed: { value: 15, unit: 'day' },
          armOnly: 'A',
        },
      ],
    },
    soaRowsOutput: {
      rows: [
        {
          row: 0,
          kind: 'procedure',
          conditions: [{ kind: 'fasting', expr: 'En ayunas de al menos 8 h' }],
        },
        { row: 3, kind: 'attribute_fasting', conditions: [] },
      ],
    },
    soaNotesOutput: {
      notes: [
        {
          ref: '1',
          conditions: [
            { kind: 'arm', expr: 'Solo en participantes del brazo A', appliesTo: 'cells' },
          ],
        },
        {
          ref: '9',
          conditions: [
            {
              kind: 'dose_timing',
              expr: 'Ventana propia',
              appliesTo: 'row',
              procedureWindow: { before: 4, after: 2, unit: 'week' },
            },
          ],
        },
      ],
    },
    soaRulesOutput: {
      rules: [
        { paragraph: 0, conditions: [{ kind: 'order', expr: 'antes de V1' }], affectsVisits: 'all' },
        { paragraph: 2, conditions: [], affectsVisits: [0, 3, 5] },
      ],
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

  it(`CON cota — el esquema REAL de labs/confirm (.max(${MAX_LAB_ITEMS})): un único too_big, tiempo acotado`, { timeout: 60_000 }, () => {
    const startedAt = Date.now()
    const result = labOcrConfirmSchema.safeParse({ labs: invalidLabs })
    expect(result.success).toBe(false)
    if (result.success) return
    const issues = result.error.issues
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('too_big')
    expect(issues[0]?.path.join('.')).toBe('labs')
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  })
})
