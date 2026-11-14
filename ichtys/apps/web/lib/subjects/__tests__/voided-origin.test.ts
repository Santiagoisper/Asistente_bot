import { describe, expect, it } from 'vitest'
import { voidedOriginNotice, voidedOriginLines, VOIDED_ORIGIN_TITLE } from '../voided-origin'

/**
 * D24, punto 2: si lo que se extrajo de una evolución ya se había aceptado cuando se la anuló,
 * Alphi no saca nada solo. Avisa. Los laboratorios guardan de qué evolución vinieron y se pueden
 * nombrar; las medicaciones y las condiciones no, y el aviso lo dice.
 */
const VOIDED = '11111111-1111-4111-8111-111111111111'
const CURRENT = '22222222-2222-4222-8222-222222222222'
const fromEvolution = (name: string, evolutionId: string) => ({ name, value: 1, source: { kind: 'evolution' as const, evolutionId } })

describe('voidedOriginNotice', () => {
  it('sin evoluciones anuladas no hay aviso, aunque haya datos de evoluciones', () => {
    expect(voidedOriginNotice({ labs: [fromEvolution('HbA1c', CURRENT)], voidedEvolutionIds: [], acceptedFrom: [] })).toBeNull()
  })

  it('una anulada de la que no se aceptó nada no da aviso', () => {
    expect(voidedOriginNotice({ labs: [fromEvolution('HbA1c', CURRENT)], voidedEvolutionIds: [VOIDED], acceptedFrom: [] })).toBeNull()
  })

  it('nombra los laboratorios que vinieron de la anulada, y solo esos', () => {
    const notice = voidedOriginNotice({
      labs: [
        fromEvolution('HbA1c', VOIDED),
        fromEvolution('Glucosa', CURRENT),
        { name: 'Creatinina', value: 0.9, source: { kind: 'lab_report' as const, reportId: 'r1' } },
        { name: 'Urea', value: 30 },
      ],
      voidedEvolutionIds: [VOIDED],
      acceptedFrom: [VOIDED],
    })
    expect(notice).toEqual({ labNames: ['HbA1c'], evolutionIds: [VOIDED] })
  })

  it('lee también el origen en la forma anterior a C4', () => {
    const notice = voidedOriginNotice({ labs: [{ name: 'TSH', value: 2, sourceEvolutionId: VOIDED }], voidedEvolutionIds: [VOIDED], acceptedFrom: [] })
    expect(notice?.labNames).toEqual(['TSH'])
  })

  it('un laboratorio de una anulada alcanza para avisar aunque el registro no diga que se aceptó', () => {
    expect(voidedOriginNotice({ labs: [fromEvolution('HbA1c', VOIDED)], voidedEvolutionIds: [VOIDED], acceptedFrom: [] })).not.toBeNull()
  })

  it('si se aceptó una propuesta y ya no queda ningún laboratorio de ese origen, el aviso sigue: medicaciones y condiciones no se pueden descartar', () => {
    const notice = voidedOriginNotice({ labs: [fromEvolution('Glucosa', CURRENT)], voidedEvolutionIds: [VOIDED], acceptedFrom: [VOIDED] })
    expect(notice).toEqual({ labNames: [], evolutionIds: [VOIDED] })
  })

  it('una aceptación de una evolución que no está anulada no cuenta', () => {
    expect(voidedOriginNotice({ labs: [], voidedEvolutionIds: [VOIDED], acceptedFrom: [CURRENT] })).toBeNull()
  })

  it('no repite un nombre ni una evolución', () => {
    const notice = voidedOriginNotice({ labs: [fromEvolution('HbA1c', VOIDED), fromEvolution('HbA1c', VOIDED)], voidedEvolutionIds: [VOIDED, VOIDED], acceptedFrom: [VOIDED] })
    expect(notice).toEqual({ labNames: ['HbA1c'], evolutionIds: [VOIDED] })
  })
})

describe('voidedOriginLines — lo que se le dice a la persona', () => {
  it('el título dice qué pasó sin prometer nada', () => {
    expect(VOIDED_ORIGIN_TITLE).toBe('El perfil incluye datos aceptados desde una evolución registrada por error en este sujeto')
  })

  it('con laboratorios: los nombra, dice que medicaciones y condiciones no se pueden listar, y que Alphi no los saca solo', () => {
    const text = voidedOriginLines({ labNames: ['HbA1c', 'Glucosa'], evolutionIds: [VOIDED] }).join(' ')
    expect(text).toContain('HbA1c, Glucosa')
    expect(text).toContain('no guardan de qué evolución vinieron')
    expect(text).toContain('Alphi no saca estos datos solo')
    expect(text).toContain('elegibilidad')
  })

  it('sin laboratorios de ese origen no inventa una lista', () => {
    const lines = voidedOriginLines({ labNames: [], evolutionIds: [VOIDED] })
    expect(lines.join(' ')).not.toContain('Laboratorios que vinieron')
    expect(lines.join(' ')).toContain('no guardan de qué evolución vinieron')
  })

  it('no dice «corregido», «resuelto» ni que se puede quitar desde la pantalla', () => {
    const text = voidedOriginLines({ labNames: ['HbA1c'], evolutionIds: [VOIDED] }).join(' ').toLowerCase()
    for (const word of ['corregido', 'resuelto', 'hacé clic', 'botón']) expect(text).not.toContain(word)
  })
})
