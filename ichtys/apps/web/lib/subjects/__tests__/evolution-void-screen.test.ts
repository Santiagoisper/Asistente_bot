import { describe, expect, it } from 'vitest'
import { voidDoneMessage, voidErrorMessage } from '../evolution-void-screen'
import { retireErrorMessage } from '../voided-origin'

/** D24, punto 1 — lo que la pantalla dice al declarar que una evolución se registró en el sujeto equivocado. */
describe('voidErrorMessage — ningún rechazo se traga, y ninguno afirma lo que no se sabe', () => {
  it('el sujeto confirmado no es el de la evolución', () => {
    const text = voidErrorMessage(409, 'subject_mismatch')
    expect(text).toContain('no coincide')
    expect(text).toContain('No se declaró nada')
  })

  it('ya figuraba como registrada por error: lo dice, no lo calla', () => {
    const text = voidErrorMessage(409, 'already_voided')
    expect(text).toContain('ya figuraba')
    expect(text).not.toContain('No se pudo')
  })

  it('la evolución no está en este sujeto', () => {
    expect(voidErrorMessage(404, 'request_failed')).toContain('No se encontró')
  })

  it('sin permiso: dice a quién pedírselo, con lo que vale en los dos modos', () => {
    const text = voidErrorMessage(403, 'request_failed')
    expect(text).toContain('quien la escribió')
    // En modo abierto la coordinación todavía no puede: el texto no la promete.
    expect(text).not.toContain('coordina')
    expect(text).toContain('No se declaró nada')
  })

  it('demasiados pedidos', () => {
    const text = voidErrorMessage(429, 'request_failed')
    expect(text).toContain('Esperá')
    expect(text).toContain('No se declaró nada')
  })

  it('el perfil no se pudo leer: no se anula a ciegas, y se dice', () => {
    const text = voidErrorMessage(422, 'profile_unreadable')
    expect(text).toContain('no se pudo leer')
    expect(text).toContain('No se declaró nada')
  })

  it('sin cifrado configurado', () => {
    expect(voidErrorMessage(503, 'phi_encryption_not_configured')).toContain('cifrado')
  })

  it('un pedido mal armado: no se declaró nada', () => {
    expect(voidErrorMessage(400, 'request_failed')).toContain('No se declaró nada')
  })

  it('si no hubo respuesta o el servidor falló, no afirma que no cambió: manda a mirar la historia', () => {
    for (const status of [0, 500, 502]) {
      const text = voidErrorMessage(status, 'request_failed')
      expect(text).toContain('No se pudo confirmar')
      expect(text).toContain('historia')
      expect(text).not.toContain('No se declaró nada')
    }
  })
})

describe('voidDoneMessage — qué pasó, con lo que el servidor contestó', () => {
  it('sin grabaciones ni propuesta: la marca, y que el perfil no se corrige solo', () => {
    const text = voidDoneMessage({ withdrawnAudios: 0, proposalRetired: false })
    expect(text).toContain('registrada por error en este sujeto')
    expect(text).toContain('El perfil no se corrigió solo')
    expect(text).not.toContain('grabaci')
    expect(text).not.toContain('propuesta')
  })

  it('una grabación, en singular; varias, con su número', () => {
    expect(voidDoneMessage({ withdrawnAudios: 1, proposalRetired: false })).toContain('Su grabación pasó a las grabaciones sin sujeto')
    expect(voidDoneMessage({ withdrawnAudios: 3, proposalRetired: false })).toContain('Sus 3 grabaciones pasaron a las grabaciones sin sujeto')
  })

  it('si había una propuesta pendiente, dice que se retiró', () => {
    expect(voidDoneMessage({ withdrawnAudios: 0, proposalRetired: true })).toContain('La propuesta pendiente para el perfil se retiró')
  })

  it('una respuesta sin los datos (versión anterior) no inventa números', () => {
    const text = voidDoneMessage({})
    expect(text).toContain('registrada por error en este sujeto')
    expect(text).not.toContain('grabaci')
  })
})

describe('retireErrorMessage — tampoco afirma lo que no se sabe', () => {
  it('si no hubo respuesta o el servidor falló, no dice que el perfil no cambió', () => {
    for (const status of [0, 500]) {
      const text = retireErrorMessage(status, 'request_failed')
      expect(text).toContain('No se pudo confirmar')
      expect(text).not.toContain('no cambió')
    }
  })

  it('un pedido mal armado sí se sabe que no cambió nada', () => {
    expect(retireErrorMessage(400, 'request_failed')).toContain('El perfil no cambió')
  })
})
