import { describe, expect, it } from 'vitest'
import { FUNCTION_CAPABILITIES } from '@ichtys/auth/functions'
import { ROLES } from '@ichtys/auth/roles'
import { MONITOR_MEMBERSHIP_MAX_DAYS } from '../permissions'
import { ACCESS_EXPIRY_GUIDE, API_ERROR_TEXTS, FUNCTION_HINTS, FUNCTION_LABELS, MODE_TEXTS, ROLE_LABELS } from '../team-ui'

/**
 * L6: la pantalla enseña con estas constantes y su prueba las recorre. Acá lo
 * que se fija es que no se atrasen al schema: las etiquetas cubren exactamente
 * las funciones y roles que existen, ni más ni menos, y los números que la
 * guía muestra son los mismos con los que el servidor valida.
 */
describe('team-ui — etiquetas de funciones', () => {
  it('FUNCTION_LABELS y FUNCTION_HINTS cubren exactamente la lista cerrada', () => {
    expect(Object.keys(FUNCTION_LABELS).sort()).toEqual(Object.keys(FUNCTION_CAPABILITIES).sort())
    expect(Object.keys(FUNCTION_HINTS).sort()).toEqual(Object.keys(FUNCTION_CAPABILITIES).sort())
    for (const fn of Object.keys(FUNCTION_CAPABILITIES)) {
      expect(FUNCTION_LABELS[fn as keyof typeof FUNCTION_LABELS].length, fn).toBeGreaterThan(0)
      expect(FUNCTION_HINTS[fn as keyof typeof FUNCTION_HINTS].length, fn).toBeGreaterThan(0)
    }
  })

  it('ROLE_LABELS cubre exactamente los roles del proveedor de identidad', () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual(Object.values(ROLES).sort())
  })
})

describe('team-ui — textos de modo y de errores', () => {
  it('cada modo tiene título y explicación', () => {
    for (const mode of ['open', 'enforced'] as const) {
      expect(MODE_TEXTS[mode].title.length).toBeGreaterThan(0)
      expect(MODE_TEXTS[mode].detail.length).toBeGreaterThan(0)
    }
  })

  it('API_ERROR_TEXTS traduce cada rechazo que la API puede devolver', () => {
    for (const code of ['monitor_requires_expiry', 'expiry_in_past', 'monitor_expiry_too_far', 'not_a_member', 'invalid_input']) {
      expect(API_ERROR_TEXTS[code as keyof typeof API_ERROR_TEXTS].length, code).toBeGreaterThan(0)
    }
  })

  it('el tope que la guía enseña es la misma constante del servidor', () => {
    expect(API_ERROR_TEXTS.monitor_expiry_too_far).toContain(String(MONITOR_MEMBERSHIP_MAX_DAYS))
    expect(ACCESS_EXPIRY_GUIDE).toContain(String(MONITOR_MEMBERSHIP_MAX_DAYS))
    // M18 y M19 nombradas: quien lee la pantalla puede buscar la decisión.
    expect(ACCESS_EXPIRY_GUIDE).toContain('M18')
    expect(ACCESS_EXPIRY_GUIDE).toContain('M19')
  })
})
