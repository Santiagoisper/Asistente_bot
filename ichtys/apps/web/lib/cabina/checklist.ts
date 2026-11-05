export interface ChecklistStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function checklistKey(patientId: string, visitKey: string): string {
  return `cabina-demo:checklist:v1:${patientId}:${visitKey}`
}

/** El getter de localStorage puede lanzar antes de getItem. */
export function safeStorage(host: { localStorage?: ChecklistStore } = globalThis): ChecklistStore | null {
  try {
    return host.localStorage ?? null
  } catch {
    return null
  }
}

export function readChecklist(storage: ChecklistStore | null, key: string): string[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function writeChecklist(storage: ChecklistStore | null, key: string, keys: string[]): void {
  if (storage === null) return
  try {
    storage.setItem(key, JSON.stringify(keys))
  } catch {
    // Si el navegador bloquea el almacenamiento, la hoja sigue usable en memoria.
  }
}
