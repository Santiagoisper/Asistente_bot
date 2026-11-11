import { describe, expect, it } from 'vitest'
import { checkModuleInput, checkTimeZoneInput, orgConfigInputSchema, urlHost } from '../org-admin'
import { orgConfigError } from '../org-config-messages'

describe('configuración del centro — reglas de entrada', () => {
  it('un módulo encendido necesita una URL https válida', () => {
    expect(checkModuleInput({ baseUrl: ' https://queries.centro-a.example.test/ ', enabled: true })).toEqual({ ok: true, baseUrl: 'https://queries.centro-a.example.test/' })
    expect(checkModuleInput({ baseUrl: '', enabled: true })).toEqual({ ok: false, error: 'url_required' })
    for (const bad of ['http://queries.example.test', 'https://u:p@queries.example.test', 'no es una url', 'ftp://x.example.test']) {
      expect(checkModuleInput({ baseUrl: bad, enabled: true })).toEqual({ ok: false, error: 'url_invalid' })
    }
  })

  it('apagado se puede guardar sin URL, pero una URL mala no se guarda ni apagada', () => {
    expect(checkModuleInput({ baseUrl: '', enabled: false })).toEqual({ ok: true, baseUrl: null })
    expect(checkModuleInput({ baseUrl: 'https://queries.centro-a.example.test', enabled: false })).toEqual({ ok: true, baseUrl: 'https://queries.centro-a.example.test' })
    expect(checkModuleInput({ baseUrl: 'http://queries.example.test', enabled: false })).toEqual({ ok: false, error: 'url_invalid' })
  })

  it('la zona horaria se valida; vacía significa volver a la de la instalación', () => {
    expect(checkTimeZoneInput('America/Bogota')).toEqual({ ok: true, timeZone: 'America/Bogota' })
    expect(checkTimeZoneInput('  ')).toEqual({ ok: true, timeZone: null })
    expect(checkTimeZoneInput('Marte/Olimpo')).toEqual({ ok: false, error: 'time_zone_invalid' })
  })

  it('el cuerpo del pedido solo admite las dos formas conocidas, sin campos de más', () => {
    expect(orgConfigInputSchema.safeParse({ kind: 'module', module: 'queries', baseUrl: 'https://x.example.test', enabled: true }).success).toBe(true)
    expect(orgConfigInputSchema.safeParse({ kind: 'time_zone', timeZone: 'America/Bogota' }).success).toBe(true)
    expect(orgConfigInputSchema.safeParse({ kind: 'module', module: 'otro', baseUrl: '', enabled: true }).success).toBe(false)
    expect(orgConfigInputSchema.safeParse({ kind: 'module', module: 'queries', baseUrl: '', enabled: true, orgId: 'x' }).success).toBe(false)
    expect(orgConfigInputSchema.safeParse({ kind: 'module', module: 'queries', baseUrl: 'x'.repeat(400), enabled: true }).success).toBe(false)
    expect(orgConfigInputSchema.safeParse({ kind: 'secrets', value: 'x' }).success).toBe(false)
  })

  it('en la auditoría va el servidor, no la URL completa', () => {
    expect(urlHost('https://queries.centro-a.example.test/ruta?token=abc')).toBe('queries.centro-a.example.test')
    expect(urlHost(null)).toBeNull()
  })

  it('cada rechazo del servidor tiene un texto que la persona entiende', () => {
    expect(orgConfigError(400, 'url_required')).toMatch(/dirección/)
    expect(orgConfigError(400, 'url_invalid')).toMatch(/https/)
    expect(orgConfigError(400, 'time_zone_invalid')).toMatch(/zona horaria/)
    expect(orgConfigError(403, null)).toMatch(/administra/)
    expect(orgConfigError(500, { raro: true })).toBe('No se pudo guardar. Probá de nuevo.')
  })

  it('el formulario no arrastra código de servidor al navegador', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const form = readFileSync(join(__dirname, '..', '..', '..', 'components', 'os', 'org-config-form.tsx'), 'utf8')
    const messages = readFileSync(join(__dirname, '..', 'org-config-messages.ts'), 'utf8')
    // Solo tipos de @ichtys/integrations: el paquete firma tokens con node:crypto.
    expect(form).not.toMatch(/import \{[^}]*\} from '@ichtys\/(integrations|db|auth)'/)
    expect(form).not.toContain("lib/os/org-admin'")
    expect(messages).not.toMatch(/^import /m)
  })
})
