import { patientProfileSchema } from '@ichtys/clinical'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { safeIssuePath } from '../profile-issue-path'

/**
 * La ruta de un dato que no validó, para un registro operativo. Regla: se escriben los
 * nombres de campo que el esquema declara y los índices; una clave que es dato (la de un
 * `z.record`: el nombre de un laboratorio, de una medicación, de una condición) no se
 * escribe nunca. zod la pone en la ruta tal cual.
 */
const firstPath = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value)
  if (parsed.success) throw new Error('el valor de la prueba tenía que no validar')
  return safeIssuePath(schema, parsed.error.issues[0]!.path)
}

const uuid = '3f0c1a52-8d4e-4b6f-9a17-2c5d7e8f9a01'
const proposal = (overrides: Record<string, unknown>) => ({
  requiresHumanReview: true,
  evolutionId: uuid,
  extractedAt: '2026-11-13T10:00:00.000Z',
  facts: { labs: [], medications: [], conditions: [] },
  ...overrides,
})

describe('ruta de un dato del perfil que no validó', () => {
  it.each([
    ['el valor de un laboratorio', { labs: [{ name: 'HbA1c', value: 7.4 }, { name: 'Creatinina', value: 'cero coma nueve' }] }, 'labs[1].value'],
    ['el nombre de una medicación', { medications: [{ name: 'metformina' }, { name: 'enalapril' }, { name: '' }] }, 'medications[2].name'],
    ['una condición que no es texto', { conditions: ['Sin antecedente de pancreatitis', 14] }, 'conditions[1]'],
    ['una lista de condiciones que no es una lista', { conditions: 'Sin antecedente de pancreatitis' }, 'conditions'],
    ['una versión que este código no conoce', { version: 2 }, 'version'],
    ['la edad', { demographics: { ageYears: -4 } }, 'demographics.ageYears'],
    ['la presión', { vitals: { systolic: 'ciento veinte' } }, 'vitals.systolic'],
    ['un laboratorio pendiente de revisión', { pendingLabReview: { requiresHumanReview: true, extractedAt: 'hoy', labs: [{ name: 'Glucosa', value: 92 }, { name: 'TGP', value: 31 }, { name: 'TGO' }] } }, 'pendingLabReview.labs[2].value'],
    ['un laboratorio de una propuesta', { pendingEvolutionProposals: [proposal({}), proposal({ facts: { labs: [{ name: 'HbA1c', value: 'siete' }] } })] }, 'pendingEvolutionProposals[1].facts.labs[0].value'],
    ['el identificador de la última evolución', { lastEvolutionId: 'no-es-un-uuid' }, 'lastEvolutionId'],
  ])('%s: la ruta exacta, con los nombres del esquema y los índices', (_label, value, expected) => {
    expect(firstPath(patientProfileSchema, value)).toBe(expected)
  })

  it.each([
    ['un laboratorio', { fieldConfidence: { labs: { 'hemoglobina glicosilada': 'altísima' } } }, 'fieldConfidence.labs.*', 'hemoglobina glicosilada'],
    ['una medicación', { fieldConfidence: { medications: { metformina: 'altísima' } } }, 'fieldConfidence.medications.*', 'metformina'],
    ['una condición', { fieldConfidence: { conditions: { 'Diabetes tipo 2': 'altísima' } } }, 'fieldConfidence.conditions.*', 'Diabetes tipo 2'],
    [
      'una condición de una propuesta',
      { pendingEvolutionProposals: [proposal({ fieldConfidence: { conditions: { 'Pancreatitis crónica': 'altísima' } } })] },
      'pendingEvolutionProposals[0].fieldConfidence.conditions.*',
      'Pancreatitis crónica',
    ],
  ])('la confianza de %s: la clave es un dato clínico y no se escribe', (_label, value, expected, clinicalKey) => {
    const parsed = patientProfileSchema.safeParse(value)
    // El dato real: zod deja la clave en la ruta.
    expect(parsed.success ? [] : parsed.error.issues[0]!.path).toContain(clinicalKey)
    const text = firstPath(patientProfileSchema, value)
    expect(text).toBe(expected)
    expect(text).not.toContain(clinicalKey)
  })

  it.each([
    ['una lista en lugar de un perfil', [{ name: 'HbA1c', value: 7.4 }]],
    ['un texto en lugar de un perfil', 'perfil'],
    ['nada', null],
  ])('%s: la ruta es la raíz', (_label, value) => {
    expect(firstPath(patientProfileSchema, value)).toBe('(raíz)')
  })
})

describe('ruta segura — formas de esquema que el perfil va a tener (C4) y las que no se conocen', () => {
  it('un objeto con transformación conserva los nombres de sus campos', () => {
    const lab = z.object({ name: z.string(), sampleDate: z.string().date().optional() }).transform((entry) => ({ ...entry, read: true }))
    const schema = z.object({ labs: z.array(lab).default([]) })
    expect(firstPath(schema, { labs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd', sampleDate: '24/09/2026' }] })).toBe('labs[3].sampleDate')
  })

  it('una unión por tipo conserva el campo de la variante que lo declara', () => {
    const source = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('evolution'), evolutionId: z.string().uuid() }),
      z.object({ kind: z.literal('report'), reportId: z.string().uuid() }),
    ])
    const schema = z.object({ labs: z.array(z.object({ source: source.optional() })) })
    expect(firstPath(schema, { labs: [{ source: { kind: 'report', reportId: 'no-es-un-uuid' } }] })).toBe('labs[0].source.reportId')
  })

  it('un valor que se preprocesa antes de validar conserva los nombres', () => {
    const schema = z.preprocess((value) => value, z.object({ inner: z.object({ count: z.number() }).nullable() }))
    expect(firstPath(schema, { inner: { count: 'dos' } })).toBe('inner.count')
  })

  it('lo que está adentro de una clave que es dato conserva sus nombres de campo', () => {
    const schema = z.object({ byName: z.record(z.string(), z.object({ level: z.enum(['high', 'low']) })) })
    expect(firstPath(schema, { byName: { metformina: { level: 'altísima' } } })).toBe('byName.*.level')
  })

  it.each([
    ['una clave que el esquema no declara', ['labs', 0, 'Diabetes tipo 2'], 'labs[0].?'],
    ['una clave de texto donde el esquema espera una lista', ['labs', 'Diabetes tipo 2', 'value'], 'labs.?.?'],
    ['una ruta que sigue después de un valor simple', ['version', 'Diabetes tipo 2', 3], 'version.?[3]'],
    ['un segmento que no es texto ni número', ['labs', Symbol('Diabetes tipo 2')], 'labs.?'],
    ['una clave que no existe en la raíz', ['Diabetes tipo 2'], '?'],
  ])('%s: se tapa; nunca se copia un texto que el esquema no declara', (_label, path, expected) => {
    const text = safeIssuePath(patientProfileSchema, path)
    expect(text).toBe(expected)
    expect(text).not.toContain('Diabetes')
  })

  it('una forma de esquema que esta función no conoce se tapa de ahí en adelante', () => {
    const schema = z.object({ pair: z.tuple([z.object({ name: z.string() }), z.number()]) })
    expect(safeIssuePath(schema, ['pair', 0, 'name'])).toBe('pair[0].?')
  })
})

/**
 * C4 paso 1 (#145): el valor de laboratorio del perfil pasa a tener transformación, una unión
 * por tipo en `source` y la fecha de la muestra. El registro operativo tiene que seguir
 * diciendo qué campo falló, con el esquema real del perfil.
 */
describe('ruta segura con el esquema del perfil después de C4 paso 1', () => {
  const lab = (extra: Record<string, unknown>) => ({ version: 1, labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }, { name: 'Creatinina', value: 0.9, ...extra }] })

  it('una fecha de muestra mal formada: labs[1].sampleDate', () => {
    expect(firstPath(patientProfileSchema, lab({ sampleDate: 'ayer' }))).toBe('labs[1].sampleDate')
  })

  it('un origen de informe con identificador mal formado: labs[1].source.reportId', () => {
    expect(firstPath(patientProfileSchema, lab({ source: { kind: 'lab_report', reportId: 'no-es-uuid' } }))).toBe('labs[1].source.reportId')
  })

  it('un origen de evolución con identificador mal formado: labs[1].source.evolutionId', () => {
    expect(firstPath(patientProfileSchema, lab({ source: { kind: 'evolution', evolutionId: 'x' } }))).toBe('labs[1].source.evolutionId')
  })

  it('un tipo de origen que no existe: labs[1].source.kind, sin el valor', () => {
    const text = firstPath(patientProfileSchema, lab({ source: { kind: 'Diabetes tipo 2' } }))
    expect(text).toBe('labs[1].source.kind')
    expect(text).not.toContain('Diabetes')
  })
})

/**
 * Pedido de Architect en el #152. Hoy el perfil no tiene objetos estrictos; si C4 suma uno,
 * la clave sobrante puede ser un dato (el nombre de una condición escrito como campo). zod la
 * informa en `issue.keys`, no en la ruta, y el registro operativo no copia `issue.keys`. Estas
 * pruebas fijan las dos cosas con un esquema de prueba: si una versión de zod empieza a poner
 * la clave en la ruta, o alguien suma `keys` al registro, se rompen.
 */
describe('clave sobrante en un objeto estricto — su nombre no llega a la ruta', () => {
  const strictLab = z.object({ name: z.string(), value: z.number() }).strict()
  const schema = z.object({ labs: z.array(strictLab), summary: z.object({ note: z.string() }).strict().optional() })
  const issuesOf = (value: unknown) => {
    const parsed = schema.safeParse(value)
    if (parsed.success) throw new Error('el valor de la prueba tenía que no validar')
    return parsed.error.issues
  }

  it('adentro de una lista: la ruta es la del objeto, y la clave queda solo en `issue.keys`', () => {
    const issues = issuesOf({ labs: [{ name: 'HbA1c', value: 7.4, 'Diabetes tipo 2': 'sí' }] })
    expect(issues).toHaveLength(1)
    // La premisa: zod informa la clave sobrante por separado de la ruta.
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['Diabetes tipo 2'], path: ['labs', 0] })
    const text = safeIssuePath(schema, issues[0]!.path)
    expect(text).toBe('labs[0]')
    expect(text).not.toContain('Diabetes')
  })

  it('en un objeto opcional: lo mismo, con el nombre del campo declarado', () => {
    const issues = issuesOf({ labs: [], summary: { note: 'ok', 'pancreatitis previa': true } })
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['pancreatitis previa'] })
    const text = safeIssuePath(schema, issues[0]!.path)
    expect(text).toBe('summary')
    expect(text).not.toContain('pancreatitis')
  })

  it('y si una versión de zod pusiera la clave sobrante en la ruta, se taparía igual', () => {
    const text = safeIssuePath(schema, ['labs', 0, 'Diabetes tipo 2'])
    expect(text).toBe('labs[0].?')
    expect(text).not.toContain('Diabetes')
  })

  it('lo que el registro operativo escribe de un error así (ruta, código y cantidad) no nombra la clave', () => {
    const issues = issuesOf({ labs: [{ name: 'HbA1c', value: 7.4, 'Diabetes tipo 2': 'sí' }] })
    // Los mismos tres datos que arma `reportUnreadableProfile` a partir de los errores.
    const logged = { path: safeIssuePath(schema, issues[0]!.path), issueCode: issues[0]!.code, issueCount: issues.length }
    expect(logged).toEqual({ path: 'labs[0]', issueCode: 'unrecognized_keys', issueCount: 1 })
    expect(JSON.stringify(logged)).not.toContain('Diabetes')
  })
})
