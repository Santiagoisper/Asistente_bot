import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ getLatestStudySpec: vi.fn() }))
vi.mock('@ichtys/ingestion/spec-store', () => ({ getLatestStudySpec: store.getLatestStudySpec }))
vi.mock('@ichtys/ingestion/study-spec', () => ({
  studySpecSchema: {
    safeParse: (spec: unknown) =>
      spec && typeof spec === 'object' && 'visits' in spec ? { success: true, data: spec } : { success: false },
  },
}))

import { loadStudyVisitLabels } from '../study-visit-names'
import { GENERIC_VISIT_LABELS, isAllowedVisitLabel, protocolVisitLabels, UNSCHEDULED_VISIT, visitForLabel, visitOptions } from '../visit-labels'

const SCOPE = { orgId: 'org-1', studyId: 'study-1' }
const visit = (name: string, label: string | null = null) => ({ name, label })

describe('opciones de visita que ve quien escribe', () => {
  it('con cronograma: las visitas del protocolo, en su orden, y «No programada» al final', () => {
    expect(visitOptions([visit('Visita 1', 'Selección'), visit('Visita 2', 'Semana 0'), visit('V3')])).toEqual([
      { value: 'Visita 1', text: 'Visita 1 · Selección' },
      { value: 'Visita 2', text: 'Visita 2 · Semana 0' },
      { value: 'V3', text: 'V3' },
      { value: UNSCHEDULED_VISIT, text: UNSCHEDULED_VISIT },
    ])
  })

  it('sin cronograma: la lista corta', () => {
    expect(visitOptions([]).map((option) => option.value)).toEqual([...GENERIC_VISIT_LABELS])
  })

  it('no repite una visita ni ofrece una sin nombre o demasiado larga', () => {
    const options = visitOptions([visit('V1'), visit(' V1 '), visit('  '), visit('x'.repeat(101)), visit(UNSCHEDULED_VISIT)])
    expect(options.map((option) => option.value)).toEqual(['V1', UNSCHEDULED_VISIT])
  })
})

describe('un protocolo que repite el nombre de una visita', () => {
  const visits = [
    { name: 'Selección', label: null, procedures: ['consentimiento'] },
    { name: 'Control', label: 'Semana 4', procedures: ['laboratorio'] },
    { name: 'Control', label: 'Semana 8', procedures: ['electrocardiograma'] },
  ]

  it('se ven las dos, cada una con su etiqueta de tiempo, y la que no se repite queda con su nombre', () => {
    expect(visitOptions(visits)).toEqual([
      { value: 'Selección', text: 'Selección' },
      { value: 'Control · Semana 4', text: 'Control · Semana 4' },
      { value: 'Control · Semana 8', text: 'Control · Semana 8' },
      { value: UNSCHEDULED_VISIT, text: UNSCHEDULED_VISIT },
    ])
  })

  it('la guía recibe la visita elegida, no la otra del mismo nombre', () => {
    expect(visitForLabel('Control · Semana 8', visits)?.procedures).toEqual(['electrocardiograma'])
    expect(visitForLabel('Control · Semana 4', visits)?.procedures).toEqual(['laboratorio'])
    expect(visitForLabel('Selección', visits)?.procedures).toEqual(['consentimiento'])
  })

  it('el nombre solo, que no dice cuál de las dos, no es un rótulo: ni en la guía ni en el servidor', () => {
    expect(visitForLabel('Control', visits)).toBeNull()
    expect(isAllowedVisitLabel('Control', protocolVisitLabels(visits))).toBe(false)
    expect(isAllowedVisitLabel('Control · Semana 8', protocolVisitLabels(visits))).toBe(true)
  })

  it('«Sin indicar», «No programada» y la lista corta no tienen visita en el cronograma', () => {
    for (const label of ['', UNSCHEDULED_VISIT, 'Basal']) expect(visitForLabel(label, visits)).toBeNull()
  })

  it('dos visitas que no se distinguen ni por la etiqueta quedan como una', () => {
    expect(protocolVisitLabels([visit('V1', 'Semana 1'), visit('V1', 'Semana 1'), visit('V2'), visit('V2')])).toEqual(['V1 · Semana 1', 'V2'])
  })
})

describe('qué rótulo vale en el servidor', () => {
  it('vale el nombre exacto de una visita del protocolo o uno de la lista corta', () => {
    expect(isAllowedVisitLabel('Visita 2', ['Visita 1', 'Visita 2'])).toBe(true)
    for (const label of GENERIC_VISIT_LABELS) expect(isAllowedVisitLabel(label, [])).toBe(true)
  })

  it('no vale nada más: ni otra mayúscula, ni un pedazo, ni texto libre', () => {
    for (const label of ['visita 2', 'Visita', 'Visita 2 de Juan', 'Juan Pérez', '']) {
      expect(isAllowedVisitLabel(label, ['Visita 1', 'Visita 2']), label).toBe(false)
    }
  })
})

describe('visitas del estudio para el servidor', () => {
  beforeEach(() => {
    store.getLatestStudySpec.mockReset()
  })

  it('junta el protocolo aprobado y el último borrador, sin repetir', async () => {
    store.getLatestStudySpec.mockImplementation(async ({ approvedOnly }: { approvedOnly: boolean }) =>
      approvedOnly ? { spec: { visits: [visit('V1'), visit('V2')] } } : { spec: { visits: [visit('V2'), visit('V3')] } },
    )

    expect(await loadStudyVisitLabels(SCOPE)).toEqual(['V1', 'V2', 'V3'])
    expect(store.getLatestStudySpec).toHaveBeenCalledWith({ ...SCOPE, approvedOnly: true })
    expect(store.getLatestStudySpec).toHaveBeenCalledWith({ ...SCOPE, approvedOnly: false })
  })

  it('sin protocolo, o con uno ilegible, no hay visitas: queda la lista corta', async () => {
    store.getLatestStudySpec.mockResolvedValueOnce(null).mockResolvedValueOnce({ spec: { roto: true } })
    expect(await loadStudyVisitLabels(SCOPE)).toEqual([])
  })
})
