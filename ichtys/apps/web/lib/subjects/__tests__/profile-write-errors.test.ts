import { describe, expect, it, vi } from 'vitest'

vi.mock('@ichtys/db', () => ({ db: {}, and: vi.fn(), eq: vi.fn(), patientProfiles: {}, getOrgLlmApiKeys: vi.fn(), recordUsage: vi.fn() }))

import { ProfileConflictError, ProfileInvalidError, ProfileUnreadableError } from '../patient-profile-service'
import { profileWriteErrorResponse } from '../profile-write-errors'
import { profileWriteErrorMessage, PROFILE_UNREADABLE_NOTICE, PROPOSAL_OF_VOIDED_EVOLUTION_MESSAGE } from '../profile-write-messages'

describe('errores de escritura del perfil: código propio para la pantalla', () => {
  it('un perfil guardado que no se pudo leer responde 422 con su código, sin ningún dato', async () => {
    const response = profileWriteErrorResponse(new ProfileUnreadableError())
    expect(response?.status).toBe(422)
    expect(await response?.json()).toEqual({ error: 'profile_unreadable' })
  })

  it('un cambio que dejaba el perfil inválido responde 422 con otro código', async () => {
    const response = profileWriteErrorResponse(new ProfileInvalidError())
    expect(response?.status).toBe(422)
    expect(await response?.json()).toEqual({ error: 'profile_invalid' })
  })

  it('cualquier otro error no se traduce acá', () => {
    expect(profileWriteErrorResponse(new ProfileConflictError())).toBeNull()
    expect(profileWriteErrorResponse(new Error('otra cosa'))).toBeNull()
    expect(profileWriteErrorResponse('texto')).toBeNull()
  })

  it('no usa 409: la pantalla lee un 409 como «otra persona ya lo resolvió»', () => {
    for (const error of [new ProfileUnreadableError(), new ProfileInvalidError()]) {
      expect(profileWriteErrorResponse(error)?.status).not.toBe(409)
    }
  })
})

describe('lo que la pantalla le dice a la persona', () => {
  it('perfil ilegible: no se cambió nada, los datos siguen guardados, a quién avisar', () => {
    const text = profileWriteErrorMessage('profile_unreadable')
    expect(text).toContain('no se pudo leer')
    expect(text).toContain('No se cambió nada')
    expect(text).toContain('Avisá a quien administra la plataforma')
  })

  it('cambio inválido: no se guardó y el perfil quedó como estaba', () => {
    const text = profileWriteErrorMessage('profile_invalid')
    expect(text).toContain('no se guardó')
    expect(text).toContain('quedó como estaba')
  })

  it('propuesta de una evolución anulada: dice por qué no entra, que el perfil no cambió y qué se puede hacer', () => {
    expect(PROPOSAL_OF_VOIDED_EVOLUTION_MESSAGE).toContain('registrada por error en este sujeto')
    expect(PROPOSAL_OF_VOIDED_EVOLUTION_MESSAGE).toContain('El perfil no cambió')
    expect(PROPOSAL_OF_VOIDED_EVOLUTION_MESSAGE).toContain('descartar')
  })

  it('un código que no es de estos no tiene mensaje propio', () => {
    for (const code of ['no_pending_proposal', undefined, null, 42, '']) expect(profileWriteErrorMessage(code)).toBeNull()
  })

  it('el aviso de la ficha no promete lo que no se sabe y no dice que se borró nada', () => {
    expect(PROFILE_UNREADABLE_NOTICE.title).toBe('El perfil guardado de este sujeto no se pudo leer')
    expect(PROFILE_UNREADABLE_NOTICE.body.join(' ')).toContain('no están borrados')
    expect(PROFILE_UNREADABLE_NOTICE.body.join(' ')).toContain('No se evaluó la elegibilidad')
    expect(PROFILE_UNREADABLE_NOTICE.body.join(' ')).not.toMatch(/se perdi|se borr[oó]/)
  })
})
