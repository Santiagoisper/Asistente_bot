import { describe, expect, it } from 'vitest'
import { afterDeclaredVoid, declaredByResponse, proposalsStillOffered, voidDoneMessage, voidErrorMessage } from '../evolution-void-screen'
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
    expect(text).toContain('quien coordina el estudio')
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

/**
 * Hallazgo de revisión del #180: después de una declaración confirmada, si la historia no se
 * puede volver a leer, la pantalla seguía mostrando la evolución como vigente y ofreciendo
 * declararla otra vez; y la propuesta ya retirada seguía a la vista como pendiente.
 */
describe('afterDeclaredVoid — lo que ya se sabe que se declaró no se muestra como vigente', () => {
  const list = [
    { id: 'a', voided: null, canVoid: true },
    { id: 'b', voided: null, canVoid: true },
    { id: 'c', voided: { at: 'x' }, canVoid: false },
  ]

  it('sin nada declarado en esta pantalla, la lista queda igual', () => {
    expect(afterDeclaredVoid(list, new Set())).toEqual(list)
  })

  it('la declarada que la lista todavía trae como vigente deja de ofrecer la acción y queda marcada', () => {
    const out = afterDeclaredVoid(list, new Set(['a']))
    expect(out[0]).toEqual({ id: 'a', voided: null, canVoid: false, voidUnrefreshed: true })
    expect(out[1]).toEqual(list[1])
  })

  it('cuando la relectura ya la trae anulada, manda lo que dice el servidor', () => {
    expect(afterDeclaredVoid(list, new Set(['c']))[2]).toEqual(list[2])
  })

  it('no cambia la lista que recibe', () => {
    afterDeclaredVoid(list, new Set(['a']))
    expect(list[0]).toEqual({ id: 'a', voided: null, canVoid: true })
  })
})

describe('proposalsStillOffered — la propuesta de una evolución declarada por error no se ofrece', () => {
  const proposals = [{ evolutionId: 'a' }, { evolutionId: 'b' }]

  it('saca la de la evolución declarada y deja las demás', () => {
    expect(proposalsStillOffered(proposals, new Set(['a']))).toEqual([{ evolutionId: 'b' }])
  })

  it('sin nada declarado, todas', () => {
    expect(proposalsStillOffered(proposals, new Set())).toEqual(proposals)
  })
})

describe('declaredByResponse — cuándo la respuesta prueba que la evolución quedó declarada', () => {
  it('una respuesta correcta', () => {
    expect(declaredByResponse(true, '')).toBe(true)
  })

  it('«ya figuraba»: también está declarada, aunque no por este pedido', () => {
    expect(declaredByResponse(false, 'already_voided')).toBe(true)
  })

  it('cualquier otro rechazo, o no saber, no la da por declarada', () => {
    for (const code of ['subject_mismatch', 'request_failed', 'profile_unreadable', '']) expect(declaredByResponse(false, code), code).toBe(false)
  })
})
