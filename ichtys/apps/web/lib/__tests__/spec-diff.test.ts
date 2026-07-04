import { describe, expect, it } from 'vitest'
import type { StudyEndpoint, StudySpec } from '@ichtys/ingestion'
import { diffSpecs } from '../spec-diff'

// El diff solo lee inclusionCriteria/exclusionCriteria/endpoints/visits, así que
// construimos un StudySpec mínimo y casteamos para no armar el schema completo.
function spec(endpoints: StudyEndpoint[]): StudySpec {
  return {
    inclusionCriteria: [],
    exclusionCriteria: [],
    endpoints,
    visits: [],
  } as unknown as StudySpec
}

function ep(
  type: StudyEndpoint['type'],
  objective: string,
  endpoint: string,
): StudyEndpoint {
  return { type, objective, endpoint } as unknown as StudyEndpoint
}

describe('diffSpecs — endpoints (alineación LCS)', () => {
  it('no reporta cambios cuando los endpoints son idénticos', () => {
    const a = ep('primary', 'Obj A', 'End A')
    const b = ep('secondary', 'Obj B', 'End B')
    const diff = diffSpecs(spec([a, b]), spec([a, b]))
    expect(diff.hasChanges).toBe(false)
    expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 0 })
    expect(diff.endpoints.every((d) => d.diffType === 'unchanged')).toBe(true)
  })

  it('una inserción en el medio NO marca los siguientes como modificados (regresión del bug posicional)', () => {
    const a = ep('primary', 'Obj A', 'End A')
    const b = ep('secondary', 'Obj B', 'End B')
    const inserted = ep('secondary', 'Obj NUEVO', 'End NUEVO')

    const diff = diffSpecs(spec([a, b]), spec([a, inserted, b]))

    // Con matching posicional b habría aparecido como "modificado".
    expect(diff.summary).toEqual({ added: 1, removed: 0, modified: 0 })
    const added = diff.endpoints.filter((d) => d.diffType === 'added')
    expect(added).toHaveLength(1)
    expect(added[0]!.new?.objective).toBe('Obj NUEVO')
    // a y b siguen siendo "unchanged".
    const unchanged = diff.endpoints.filter((d) => d.diffType === 'unchanged')
    expect(unchanged.map((d) => d.new?.endpoint)).toEqual(
      expect.arrayContaining(['End A', 'End B']),
    )
  })

  it('detecta una edición real de un endpoint como "modified"', () => {
    const a = ep('primary', 'Obj A', 'End A')
    const b = ep('secondary', 'Obj B', 'End B')
    const bEdit = ep('secondary', 'Obj B', 'End B corregido')

    const diff = diffSpecs(spec([a, b]), spec([a, bEdit]))

    expect(diff.summary).toEqual({ added: 0, removed: 0, modified: 1 })
    const mod = diff.endpoints.find((d) => d.diffType === 'modified')
    expect(mod?.old?.endpoint).toBe('End B')
    expect(mod?.new?.endpoint).toBe('End B corregido')
  })

  it('reporta remoción cuando desaparece un endpoint', () => {
    const a = ep('primary', 'Obj A', 'End A')
    const b = ep('secondary', 'Obj B', 'End B')

    const diff = diffSpecs(spec([a, b]), spec([a]))

    expect(diff.summary).toEqual({ added: 0, removed: 1, modified: 0 })
    const removed = diff.endpoints.find((d) => d.diffType === 'removed')
    expect(removed?.old?.endpoint).toBe('End B')
  })

  it('distingue edición de tipo (primary → secondary) como modificación por posición del mismo objetivo', () => {
    const a = ep('primary', 'Obj A', 'End A')
    const aTypeChange = ep('secondary', 'Obj A', 'End A')

    const diff = diffSpecs(spec([a]), spec([aTypeChange]))

    // Firmas distintas por type y sin ancla: al no compartir tipo se ve como
    // remoción + adición (comportamiento honesto sin ID estable).
    expect(diff.summary.added + diff.summary.removed).toBe(2)
    expect(diff.summary.modified).toBe(0)
  })

  it('asigna índices únicos a cada fila del diff (React key seguro)', () => {
    const a = ep('primary', 'Obj A', 'End A')
    const b = ep('secondary', 'Obj B', 'End B')
    const c = ep('exploratory', 'Obj C', 'End C')

    const diff = diffSpecs(spec([a, b]), spec([b, c]))
    const indices = diff.endpoints.map((d) => d.index)
    expect(new Set(indices).size).toBe(indices.length)
  })
})
