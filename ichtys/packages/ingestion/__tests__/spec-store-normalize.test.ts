/**
 * Regresión E5 (vuelta 4): saveStudySpec normaliza ANTES del .parse.
 *
 * En 0f441f4, un spec con más de 200 extractionWarnings (pipeline las junta
 * todas) o con un texto por encima del tope hacía que
 * studySpecSchema.parse (spec-store) lanzara ZodError y se perdiera toda la
 * persistencia del draft. Contrato: un tope NUNCA hace fallar más que el
 * ítem afectado — la lista de advertencias se recorta a 200, cada
 * advertencia a 1000 chars, y el spec se guarda.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insertValues: {
    values: vi.fn((_value: unknown) => ({ returning: async () => [{ id: 'spec-1', version: 1 }] })),
  },
}))

vi.mock('@ichtys/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    insert: () => mocks.insertValues,
  },
  studySpecs: {},
}))

import { saveStudySpec } from '../spec-store'
import { emptyStudySpec, type StudySpec } from '../study-spec'

/** El spec que llegó al insert (único write de saveStudySpec). */
function insertedSpec(): StudySpec {
  const call = mocks.insertValues.values.mock.calls[0]
  expect(call).toBeDefined()
  return (call![0] as { spec: StudySpec }).spec
}

describe('saveStudySpec — normaliza antes del .parse (un tope nunca tumba el guardado)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('250 advertencias: se guardan 200 recortadas, sin throw', async () => {
    const warnings = Array.from({ length: 250 }, (_, i) => `advertencia ${i + 1}`)

    const saved = await saveStudySpec({
      orgId: 'org-1',
      studyId: 'study-1',
      documentVersionId: 'docver-1',
      extractionModel: 'claude-opus-5-5',
      spec: { ...emptyStudySpec(), extractionWarnings: warnings },
    })

    expect(saved).toEqual({ id: 'spec-1', version: 1 })
    const spec = insertedSpec()
    expect(spec.extractionWarnings).toHaveLength(200)
    expect(spec.extractionWarnings?.[0]).toBe('advertencia 1')
    expect(spec.extractionWarnings?.[199]).toBe('advertencia 200')
  })

  it('una advertencia de más de 1000 chars se recorta al tope', async () => {
    await saveStudySpec({
      orgId: 'org-1',
      studyId: 'study-1',
      documentVersionId: 'docver-1',
      extractionModel: 'claude-opus-5-5',
      spec: {
        ...emptyStudySpec(),
        extractionWarnings: ['x'.repeat(1500)],
      },
    })

    expect(insertedSpec().extractionWarnings?.[0]).toHaveLength(1000)
  })

  it('un spec válido se guarda tal cual, sin normalización ni advertencias', async () => {
    const spec = {
      ...emptyStudySpec(),
      inclusionCriteria: [
        { number: '1', text: 'Adultos mayores de 18 años', sourcePages: [52], confidence: 'high' as const },
      ],
      extractionWarnings: ['advertencia única'],
    }

    await saveStudySpec({
      orgId: 'org-1',
      studyId: 'study-1',
      documentVersionId: 'docver-1',
      extractionModel: 'claude-opus-5-5',
      spec,
    })

    expect(insertedSpec()).toEqual(spec)
  })
})
