import { describe, expect, it } from 'vitest'
import { subjectOptions, subjectPlaceholder } from '../agenda-view'

describe('lista de sujetos al cargar un turno', () => {
  it('una respuesta correcta da las opciones ordenadas por código', () => {
    expect(subjectOptions(true, [{ id: 'b', subjectCode: '001-020' }, { id: 'a', subjectCode: '001-003' }])).toEqual([
      { id: 'a', label: '001-003' },
      { id: 'b', label: '001-020' },
    ])
  })

  it('un estudio sin sujetos es una lista vacía, no un error', () => {
    expect(subjectOptions(true, [])).toEqual([])
  })

  it('si el servidor falla o responde otra cosa, se sabe que la lista no se cargó', () => {
    expect(subjectOptions(false, null)).toBeNull()
    expect(subjectOptions(true, { error: 'x' })).toBeNull()
    expect(subjectOptions(true, [{ id: 1 }])).toBeNull()
  })

  it('la opción vacía dice la verdad sobre el estado de la lista', () => {
    expect(subjectPlaceholder('ready')).toBe('Sin sujeto (monitoreo, tarea del sitio)')
    expect(subjectPlaceholder('loading')).toBe('Cargando sujetos…')
    expect(subjectPlaceholder('failed')).toBe('Sin sujeto — la lista no se pudo cargar')
  })
})
