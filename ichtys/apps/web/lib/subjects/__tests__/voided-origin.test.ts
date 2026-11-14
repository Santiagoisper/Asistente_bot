import { describe, expect, it } from 'vitest'
import { PROFILE_WRITES_LOGGED_SINCE, voidedOriginNotice, voidedOriginLines, voidedOriginTitle, VOIDED_ORIGIN_TITLE } from '../voided-origin'

/**
 * D24, punto 2: si lo que se extrajo de una evolución ya se había aceptado cuando se la anuló,
 * Alphi no saca nada solo. Avisa. Los laboratorios guardan de qué evolución vinieron y se pueden
 * nombrar; las medicaciones y las condiciones no, y el aviso lo dice.
 */
const VOIDED = '11111111-1111-4111-8111-111111111111'
const CURRENT = '22222222-2222-4222-8222-222222222222'
const OLD = '33333333-3333-4333-8333-333333333333'
/** Una evolución anulada, creada cuando el registro ya anotaba lo que entraba al perfil. */
const voided = (id: string, createdAt = '2026-11-14T12:00:00.000Z') => ({ id, createdAt })
const fromEvolution = (name: string, evolutionId: string) => ({ name, value: 1, source: { kind: 'evolution' as const, evolutionId } })

describe('voidedOriginNotice', () => {
  it('sin evoluciones anuladas no hay aviso, aunque haya datos de evoluciones', () => {
    expect(voidedOriginNotice({ labs: [fromEvolution('HbA1c', CURRENT)], voided: [], acceptedFrom: [] })).toBeNull()
  })

  it('una anulada de la que no se aceptó nada no da aviso', () => {
    expect(voidedOriginNotice({ labs: [fromEvolution('HbA1c', CURRENT)], voided: [voided(VOIDED)], acceptedFrom: [] })).toBeNull()
  })

  it('nombra los laboratorios que vinieron de la anulada, y solo esos', () => {
    const notice = voidedOriginNotice({
      labs: [
        fromEvolution('HbA1c', VOIDED),
        fromEvolution('Glucosa', CURRENT),
        { name: 'Creatinina', value: 0.9, source: { kind: 'lab_report' as const, reportId: 'r1' } },
        { name: 'Urea', value: 30 },
      ],
      voided: [voided(VOIDED)],
      acceptedFrom: [VOIDED],
    })
    expect(notice).toEqual({ labNames: ['HbA1c'], evolutionIds: [VOIDED], acceptedProposal: true, beforeLogging: false })
  })

  it('lee también el origen en la forma anterior a C4', () => {
    const notice = voidedOriginNotice({ labs: [{ name: 'TSH', value: 2, sourceEvolutionId: VOIDED }], voided: [voided(VOIDED)], acceptedFrom: [] })
    expect(notice?.labNames).toEqual(['TSH'])
  })

  it('un laboratorio de una anulada alcanza para avisar aunque el registro no diga que se aceptó', () => {
    expect(voidedOriginNotice({ labs: [fromEvolution('HbA1c', VOIDED)], voided: [voided(VOIDED)], acceptedFrom: [] })).not.toBeNull()
  })

  it('si se aceptó una propuesta y ya no queda ningún laboratorio de ese origen, el aviso sigue: medicaciones y condiciones no se pueden descartar', () => {
    const notice = voidedOriginNotice({ labs: [fromEvolution('Glucosa', CURRENT)], voided: [voided(VOIDED)], acceptedFrom: [VOIDED] })
    expect(notice).toEqual({ labNames: [], evolutionIds: [VOIDED], acceptedProposal: true, beforeLogging: false })
  })

  it('una aceptación de una evolución que no está anulada no cuenta', () => {
    expect(voidedOriginNotice({ labs: [], voided: [voided(VOIDED)], acceptedFrom: [CURRENT] })).toBeNull()
  })

  it('no repite un nombre ni una evolución', () => {
    const notice = voidedOriginNotice({ labs: [fromEvolution('HbA1c', VOIDED), fromEvolution('HbA1c', VOIDED)], voided: [voided(VOIDED), voided(VOIDED)], acceptedFrom: [VOIDED] })
    expect(notice).toEqual({ labNames: ['HbA1c'], evolutionIds: [VOIDED], acceptedProposal: true, beforeLogging: false })
  })

  /**
   * Antes de que cada cambio del perfil dejara registro (C1), una evolución escribía el perfil
   * sola y sin dejar huella. De una anulada de esa época no se puede saber si dejó medicaciones
   * o condiciones: callar sería afirmar que no (observación de Architect, #174).
   */
  it('una anulada anterior al registro avisa aunque no haya laboratorios ni registro de aceptación', () => {
    const notice = voidedOriginNotice({ labs: [], voided: [voided(OLD, '2026-11-10T09:00:00.000Z')], acceptedFrom: [] })
    expect(notice).toEqual({ labNames: [], evolutionIds: [OLD], acceptedProposal: false, beforeLogging: true })
  })

  it('el corte es la hora desde la que se registra, inclusive: en el corte ya no es «anterior»', () => {
    expect(voidedOriginNotice({ labs: [], voided: [voided(OLD, PROFILE_WRITES_LOGGED_SINCE)], acceptedFrom: [] })).toBeNull()
    const justBefore = new Date(Date.parse(PROFILE_WRITES_LOGGED_SINCE) - 1).toISOString()
    expect(voidedOriginNotice({ labs: [], voided: [voided(OLD, justBefore)], acceptedFrom: [] })?.beforeLogging).toBe(true)
  })

  it('una fecha que no se puede leer se trata como anterior: avisar de más es mejor que callar', () => {
    expect(voidedOriginNotice({ labs: [], voided: [voided(OLD, 'no es una fecha')], acceptedFrom: [] })?.beforeLogging).toBe(true)
  })

  it('una anulada reciente y una vieja: se dicen las dos cosas', () => {
    const notice = voidedOriginNotice({ labs: [], voided: [voided(VOIDED), voided(OLD, '2026-11-01T00:00:00.000Z')], acceptedFrom: [VOIDED] })
    expect(notice).toMatchObject({ acceptedProposal: true, beforeLogging: true })
    expect(notice?.evolutionIds.sort()).toEqual([VOIDED, OLD].sort())
  })
})

describe('voidedOriginLines — lo que se le dice a la persona', () => {
  const accepted = { labNames: ['HbA1c', 'Glucosa'], evolutionIds: [VOIDED], acceptedProposal: true, beforeLogging: false }

  it('el título dice qué pasó sin prometer nada', () => {
    expect(VOIDED_ORIGIN_TITLE).toBe('El perfil incluye datos aceptados desde una evolución registrada por error en este sujeto')
  })

  it('con laboratorios: los nombra, dice que medicaciones y condiciones no se pueden listar, y que Alphi no los saca solo', () => {
    const text = voidedOriginLines(accepted).join(' ')
    expect(text).toContain('HbA1c, Glucosa')
    expect(text).toContain('no guardan de qué evolución vinieron')
    expect(text).toContain('Alphi no saca estos datos solo')
    expect(text).toContain('elegibilidad')
  })

  it('sin laboratorios de ese origen no inventa una lista', () => {
    const lines = voidedOriginLines({ ...accepted, labNames: [] })
    expect(lines.join(' ')).not.toContain('Laboratorios que vinieron')
    expect(lines.join(' ')).toContain('no guardan de qué evolución vinieron')
  })

  it('una anulada anterior al registro: dice que no se puede comprobar, no que entró algo', () => {
    const text = voidedOriginLines({ labNames: [], evolutionIds: [OLD], acceptedProposal: false, beforeLogging: true }).join(' ')
    expect(text).toContain('anterior a que el sistema registrara')
    expect(text).toContain('no se puede comprobar')
    expect(text).not.toContain('no guardan de qué evolución vinieron')
  })

  it('el título no afirma que entraron datos cuando solo se sabe que pudieron entrar', () => {
    const onlyOld = { labNames: [], evolutionIds: [OLD], acceptedProposal: false, beforeLogging: true }
    expect(voidedOriginTitle(onlyOld)).toBe('El perfil puede incluir datos de una evolución registrada por error en este sujeto')
    expect(voidedOriginTitle(accepted)).toBe(VOIDED_ORIGIN_TITLE)
    // Con un laboratorio de ese origen ya es un hecho, aunque la evolución sea vieja.
    expect(voidedOriginTitle({ ...onlyOld, labNames: ['TSH'] })).toBe(VOIDED_ORIGIN_TITLE)
  })

  /**
   * Aceptar una propuesta también pisa la edad y la presión arterial del perfil con las de la
   * evolución (`mergeProfileWithExtraction`), y esas tampoco guardan origen. Con una anulada,
   * pueden ser de otra persona; la edad decide criterios de inclusión.
   */
  it('nombra la edad y la presión arterial junto con medicaciones y condiciones: también pudieron venir de esa evolución', () => {
    const text = voidedOriginLines(accepted).join(' ')
    expect(text).toContain('La edad, la presión arterial, las medicaciones y las condiciones no guardan de qué evolución vinieron')
    const old = voidedOriginLines({ labNames: [], evolutionIds: [OLD], acceptedProposal: false, beforeLogging: true }).join(' ')
    expect(old).toContain('puede haber dejado edad, presión arterial, medicaciones o condiciones')
  })

  it('dice que el valor anterior no quedó guardado: corregir es volver al documento fuente, no deshacer', () => {
    const lines = voidedOriginLines(accepted)
    expect(lines.find((line) => line.startsWith('Laboratorios'))).toContain('El valor anterior de cada uno no quedó guardado')
    expect(lines.join(' ')).toContain('El valor anterior de la edad y de la presión arterial no quedó guardado')
  })

  it('dice a quién avisar', () => {
    expect(voidedOriginLines(accepted).join(' ')).toContain('Avisá a quien coordina el estudio')
  })

  it('no dice «corregido», «resuelto» ni que se puede quitar desde la pantalla', () => {
    const text = voidedOriginLines(accepted).join(' ').toLowerCase()
    for (const word of ['corregido', 'resuelto', 'hacé clic', 'botón']) expect(text).not.toContain(word)
  })
})
