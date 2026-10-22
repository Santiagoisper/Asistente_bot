import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// El setup del package define DATABASE_URL para el resto de los tests; acá
// necesitamos simular su ausencia, así que reseteamos el registry de módulos
// antes de cada import dinámico.
beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('@ichtys/db client — inicialización perezosa', () => {
  it('importar el módulo sin DATABASE_URL no lanza (build de Next no explota)', async () => {
    vi.stubEnv('DATABASE_URL', '')

    const mod = await import('../client')

    expect(mod.db).toBeDefined()
    expect(mod.pool).toBeDefined()
  })

  it('el primer uso sin DATABASE_URL lanza un error claro', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { db } = await import('../client')

    expect(() => db.select).toThrow(/DATABASE_URL is not set/)
  })

  it('con DATABASE_URL construye el cliente en el primer uso, con la misma API', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test?sslmode=disable')
    const { db } = await import('../client')

    expect(typeof db.select).toBe('function')
    expect(typeof db.insert).toBe('function')
    expect(typeof db.transaction).toBe('function')
    expect(db.query).toBeDefined()
  })
})
