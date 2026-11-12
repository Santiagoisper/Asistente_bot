import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canChangeOrgSettings } from '../permissions'

const WEB_ROOT = join(__dirname, '..', '..', '..')

describe('canChangeOrgSettings', () => {
  it('open: decide el rol histórico (administrador del estudio o de la organización)', () => {
    const open = (role: 'org_admin' | 'study_admin' | 'site_coordinator' | 'read_only_monitor') =>
      canChangeOrgSettings({ mode: 'open', role, functions: [] })
    expect(open('org_admin')).toBe(true)
    expect(open('study_admin')).toBe(true)
    expect(open('site_coordinator')).toBe(false)
    expect(open('read_only_monitor')).toBe(false)
  })

  it('enforced: decide la función, y el rol no cuenta', () => {
    expect(canChangeOrgSettings({ mode: 'enforced', role: 'read_only_monitor', functions: ['platform_admin'] })).toBe(true)
    expect(canChangeOrgSettings({ mode: 'enforced', role: 'study_admin', functions: [] })).toBe(false)
    expect(canChangeOrgSettings({ mode: 'enforced', role: 'study_admin', functions: ['study_coordinator'] })).toBe(false)
  })

  it('la pantalla y la ruta usan la misma decisión', () => {
    const page = readFileSync(join(WEB_ROOT, 'app/(app)/settings/page.tsx'), 'utf8')
    const route = readFileSync(join(WEB_ROOT, 'app/api/org/settings/route.ts'), 'utf8')
    expect(page).toMatch(/canChangeOrgSettings\(/)
    expect(route.match(/canChangeOrgSettings\(/g)).toHaveLength(2)
    // La pantalla no vuelve a decidir por rol por su cuenta.
    expect(page).not.toMatch(/orgRole|study_admin|org_admin/)
  })
})
