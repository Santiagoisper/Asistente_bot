import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encryptClinicalContent } from '../../subjects/phi-fields'
import { historyTurnsFrom, UNREADABLE_MESSAGE } from '../persistence'

/**
 * El historial que va al modelo omite lo que no se puede descifrar (matiz de Reviewer sobre
 * #224): el modelo no tiene que leer «[mensaje ilegible]» como si fuera algo que se dijo.
 */
const savedKey = process.env.PHI_ENCRYPTION_KEY
beforeEach(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})

describe('historyTurnsFrom', () => {
  it('descifra lo cifrado y respeta el orden', () => {
    const turns = historyTurnsFrom([
      { role: 'user', contentEncrypted: encryptClinicalContent('¿Ventana de la visita 6?'), content: null },
      { role: 'assistant', contentEncrypted: encryptClinicalContent('±7 días respecto del día 169.'), content: null },
    ])
    expect(turns).toEqual([
      { role: 'user', content: '¿Ventana de la visita 6?' },
      { role: 'assistant', content: '±7 días respecto del día 169.' },
    ])
  })

  it('lo heredado en claro sigue entrando hasta el sellado', () => {
    expect(historyTurnsFrom([{ role: 'user', contentEncrypted: null, content: 'pregunta vieja' }])).toEqual([{ role: 'user', content: 'pregunta vieja' }])
  })

  it('un mensaje que no descifra se omite: ni el aviso ni el texto en claro de respaldo', () => {
    const turns = historyTurnsFrom([
      { role: 'user', contentEncrypted: encryptClinicalContent('primera'), content: null },
      { role: 'assistant', contentEncrypted: 'v1:basura', content: 'resto en claro que no debe usarse' },
      { role: 'user', contentEncrypted: encryptClinicalContent('tercera'), content: null },
    ])
    expect(turns).toEqual([
      { role: 'user', content: 'primera' },
      { role: 'user', content: 'tercera' },
    ])
    expect(JSON.stringify(turns)).not.toContain(UNREADABLE_MESSAGE)
  })

  it('una fila sin cuerpo en ninguna forma no entra', () => {
    expect(historyTurnsFrom([{ role: 'assistant', contentEncrypted: null, content: null }])).toEqual([])
  })
})
