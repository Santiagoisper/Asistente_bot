import { describe, expect, it } from 'vitest'
import { checklistKey, readChecklist, safeStorage, writeChecklist, type ChecklistStore } from '../checklist'

describe('checklist de la visita', () => {
  it('guarda y lee las casillas, y si el navegador falla deja la hoja usable', () => {
    const memory = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
    }
    const key = checklistKey('0042', 'V11')
    expect(readChecklist(storage, key)).toEqual([])
    writeChecklist(storage, key, ['ecg', 'vitals'])
    expect(readChecklist(storage, key)).toEqual(['ecg', 'vitals'])
    memory.set(key, '{')
    expect(readChecklist(storage, key)).toEqual([])
    const broken = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(readChecklist(broken, key)).toEqual([])
    expect(() => writeChecklist(broken, key, ['ecg'])).not.toThrow()
  })

  it('si leer la propiedad localStorage lanza, la hoja sigue usable', () => {
    const blocked: { localStorage?: ChecklistStore } = {}
    Object.defineProperty(blocked, 'localStorage', {
      get() {
        throw new Error('SecurityError')
      },
    })
    const storage = safeStorage(blocked)
    expect(storage).toBeNull()
    expect(readChecklist(storage, checklistKey('0042', 'V11'))).toEqual([])
    expect(() => writeChecklist(storage, checklistKey('0042', 'V11'), ['ecg'])).not.toThrow()
  })
})
