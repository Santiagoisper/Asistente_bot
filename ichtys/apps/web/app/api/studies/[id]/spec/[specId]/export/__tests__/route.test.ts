/**
 * Exportación del Study Spec (auditoría 19/11, H-03). El formato se valida antes de
 * consultar; el Spec se busca con la organización y el estudio del acceso; lo que viene
 * del protocolo se escapa en el HTML; y sacar el Spec del sistema queda auditado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const packer = vi.hoisted(() => ({ fail: false }))
vi.mock('docx', async (orig) => {
  const real = (await orig()) as Record<string, unknown> & { Packer: { toBuffer: (d: unknown) => Promise<Buffer> } }
  return { ...real, Packer: { toBuffer: (d: unknown) => (packer.fail ? Promise.reject(new Error('docx')) : real.Packer.toBuffer(d)) } }
})

const h = vi.hoisted(() => {
  class AccessError extends Error {
    constructor(message: string, public status: 401 | 403 | 404) {
      super(message)
    }
  }
  return { AccessError, validateStudyAccess: vi.fn(), findFirst: vi.fn(), insertValues: vi.fn(), rateLimit: vi.fn() }
})

vi.mock('../../../../../../../../lib/security/clinical-rate-limit', () => ({ clinicalRateLimit: h.rateLimit }))
vi.mock('@ichtys/auth', () => ({ AccessError: h.AccessError, validateStudyAccess: h.validateStudyAccess }))
vi.mock('@ichtys/db', () => ({
  db: { query: { studySpecs: { findFirst: h.findFirst } }, insert: () => ({ values: h.insertValues }) },
  and: (...a: unknown[]) => ({ and: a }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  auditLogs: {},
  studySpecs: { id: 'id', organizationId: 'organizationId', studyId: 'studyId' },
}))

import { GET } from '../route'

const p = { params: Promise.resolve({ id: 'study-1', specId: 'spec-1' }) }
const req = (format?: string) => new Request(`http://x/api/studies/study-1/spec/spec-1/export${format ? `?format=${format}` : ''}`)
// Spec mínimo y válido, inventado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- forma libre para armar casos
const spec: Record<string, any> = {
  identification: { protocolCode: 'SEED-EJEMPLO-F3', title: 'Estudio ficticio', phase: '3', sourcePages: [1] },
  inclusionCriteria: [{ number: '1', text: 'Edad entre 18 y 75 años.', sourcePages: [24], confidence: 'high' }],
  exclusionCriteria: [{ number: '1', text: 'Embarazo.', sourcePages: [26], confidence: 'high' }],
  endpoints: [{ type: 'primary', objective: 'Eficacia', endpoint: 'Cambio de HbA1c a la semana 24', sourcePages: [10], confidence: 'high' }],
  visits: [{ name: 'V1', label: 'Selección', day: 1, windowDays: 3, procedures: ['Laboratorio'], sourcePages: [40], confidence: 'high' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1', userId: 'user-1' })
  h.findFirst.mockResolvedValue({ id: 'spec-1', version: 3, status: 'approved', spec })
  h.insertValues.mockResolvedValue(undefined)
  h.rateLimit.mockResolvedValue(null)
})

describe('GET exportar Study Spec', () => {
  it.each([[undefined], ['xls'], ['PDF']])('formato %s: 400 sin validar acceso', async (format) => {
    expect((await GET(req(format), p)).status).toBe(400)
    expect(h.validateStudyAccess).not.toHaveBeenCalled()
  })

  it('sin acceso: el código del acceso y no busca el Spec', async () => {
    h.validateStudyAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await GET(req('pdf'), p)).status).toBe(404)
    expect(h.findFirst).not.toHaveBeenCalled()
  })

  it('pasado el límite de pedidos: 429 sin buscar el Spec ni auditar, contado con la org y la persona de la sesión', async () => {
    h.rateLimit.mockResolvedValue(new Response('{}', { status: 429 }))
    expect((await GET(req('docx'), p)).status).toBe(429)
    expect(h.rateLimit).toHaveBeenCalledWith('record_read', expect.objectContaining({ orgId: 'org-1', userId: 'user-1', studyId: 'study-1' }))
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.insertValues).not.toHaveBeenCalled()
  })

  it('un Spec de otra organización o estudio no aparece: 404 y nada auditado', async () => {
    h.findFirst.mockResolvedValue(undefined)
    expect((await GET(req('docx'), p)).status).toBe(404)
    expect(h.insertValues).not.toHaveBeenCalled()
  })

  it('un Spec guardado con un formato viejo: 422', async () => {
    h.findFirst.mockResolvedValue({ id: 'spec-1', version: 1, status: 'draft', spec: { foo: 1 } })
    expect((await GET(req('pdf'), p)).status).toBe(422)
  })

  it('DOCX: archivo Word, nombre saneado, sin caché, auditado', async () => {
    const res = await GET(req('docx'), p)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('wordprocessingml')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="seed-ejemplo-f3_spec_v3.docx"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK')
    expect(h.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', studyId: 'study-1', userId: 'user-1', resourceType: 'study_spec', resourceId: 'spec-1', metadata: { format: 'docx', version: 3, status: 'approved' } }),
    )
  })

  it('PDF (HTML para imprimir): lo que viene del protocolo se escapa', async () => {
    const malicioso = structuredClone(spec)
    malicioso.inclusionCriteria[0].text = '<script>alert(1)</script> & <img src=x onerror=1>'
    malicioso.identification.title = '</title><script>x</script>'
    h.findFirst.mockResolvedValue({ id: 'spec-1', version: 3, status: 'draft', spec: malicioso })
    const res = await GET(req('pdf'), p)
    const html = await res.text()
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=1&gt;')
    expect(html).toContain('BORRADOR')
  })

  it('si armar el Word falla, no queda registrada una exportación que no ocurrió', async () => {
    packer.fail = true
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req('docx'), p)
    spy.mockRestore()
    packer.fail = false
    expect(res.status).toBe(500)
    expect(h.insertValues).not.toHaveBeenCalled()
  })

  it('si la auditoría falla, no se entrega el archivo', async () => {
    h.insertValues.mockRejectedValue(new Error('db'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req('docx'), p)).status).toBe(500)
    spy.mockRestore()
  })
})
