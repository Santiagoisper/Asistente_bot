import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findOrg: vi.fn(),
  saveOrgModule: vi.fn(),
  saveOrgTimeZone: vi.fn(),
  writeAuditLog: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@ichtys/db', () => ({
  organizations: { clerkOrgId: 'clerk_org_id' },
  eq: (column: unknown, value: unknown) => ({ column, value }),
  db: { query: { organizations: { findFirst: mocks.findOrg } } },
}))
vi.mock('../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))
vi.mock('../../../../../lib/os/org-admin-service', () => ({ saveOrgModule: mocks.saveOrgModule, saveOrgTimeZone: mocks.saveOrgTimeZone }))

import { PUT } from '../route'

const put = (body: unknown) => new Request('https://os.example.test/api/os/org-config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const moduleBody = { kind: 'module', module: 'queries', baseUrl: 'https://queries.centro-a.example.test', enabled: true }
const savedEnv = { vercel: process.env.VERCEL_ENV, os: process.env.ALPHI_OS }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_ENV = 'preview'
  mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_a', orgRole: 'org:admin' })
  mocks.findOrg.mockResolvedValue({ id: 'org-a' })
})

afterEach(() => {
  if (savedEnv.vercel === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv.vercel
  if (savedEnv.os === undefined) delete process.env.ALPHI_OS
  else process.env.ALPHI_OS = savedEnv.os
})

describe('PUT /api/os/org-config — configuración del centro', () => {
  it('sin sesión: 401; sin ser administrador: 403; y no se guarda nada', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null })
    expect((await PUT(put(moduleBody))).status).toBe(401)
    for (const orgRole of ['org:member', 'org:site_coordinator', 'org:principal_investigator', null]) {
      mocks.auth.mockResolvedValue({ userId: 'user_2', orgId: 'org_clerk_a', orgRole })
      expect((await PUT(put(moduleBody))).status).toBe(403)
    }
    expect(mocks.saveOrgModule).not.toHaveBeenCalled()
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('guarda el módulo en la organización del token y lo audita sin la URL completa', async () => {
    const res = await PUT(put({ ...moduleBody, baseUrl: 'https://queries.centro-a.example.test/ruta/privada/' }))
    expect(res.status).toBe(200)
    expect(mocks.saveOrgModule).toHaveBeenCalledWith({ orgId: 'org-a', userId: 'user_1', module: 'queries', baseUrl: 'https://queries.centro-a.example.test/ruta/privada', enabled: true })
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      action: 'org.integration.update',
      orgId: 'org-a',
      userId: 'user_1',
      resourceType: 'organization_integration',
      resourceId: 'queries',
      metadata: { category: 'module', enabled: true, host: 'queries.centro-a.example.test' },
    })
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain('privada')
  })

  it('la organización nunca sale del cuerpo del pedido', async () => {
    expect((await PUT(put({ ...moduleBody, orgId: 'org-b' }))).status).toBe(400)
    expect(mocks.saveOrgModule).not.toHaveBeenCalled()
  })

  it('URL inválida o faltante: 400 con el motivo, sin guardar', async () => {
    const bad = await PUT(put({ ...moduleBody, baseUrl: 'http://queries.example.test' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'url_invalid' })
    for (const url of ['https://queries.centro-a.example.test/x?token=secreto', 'https://queries.centro-a.example.test/#secreto', 'http://localhost:3001', 'https://169.254.169.254']) {
      const res = await PUT(put({ ...moduleBody, baseUrl: url }))
      expect(res.status, url).toBe(400)
      expect(await res.json()).toEqual({ error: 'url_invalid' })
    }
    const missing = await PUT(put({ ...moduleBody, baseUrl: '' }))
    expect(await missing.json()).toEqual({ error: 'url_required' })
    expect(mocks.saveOrgModule).not.toHaveBeenCalled()
  })

  it('guarda la zona horaria; vacía la quita; inválida da 400', async () => {
    expect((await PUT(put({ kind: 'time_zone', timeZone: 'America/Bogota' }))).status).toBe(200)
    expect(mocks.saveOrgTimeZone).toHaveBeenLastCalledWith({ orgId: 'org-a', timeZone: 'America/Bogota' })
    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'org.os_settings.update', orgId: 'org-a', metadata: { timeZone: 'America/Bogota' } }))
    expect((await PUT(put({ kind: 'time_zone', timeZone: '' }))).status).toBe(200)
    expect(mocks.saveOrgTimeZone).toHaveBeenLastCalledWith({ orgId: 'org-a', timeZone: null })
    const bad = await PUT(put({ kind: 'time_zone', timeZone: 'Marte/Olimpo' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'time_zone_invalid' })
  })

  it('organización que no existe en la base: 403', async () => {
    mocks.findOrg.mockResolvedValue(undefined)
    expect((await PUT(put(moduleBody))).status).toBe(403)
  })

  it('con el interruptor apagado en producción: 404 antes de autenticar', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await PUT(put(moduleBody))).status).toBe(404)
    expect(mocks.auth).not.toHaveBeenCalled()
  })
})
