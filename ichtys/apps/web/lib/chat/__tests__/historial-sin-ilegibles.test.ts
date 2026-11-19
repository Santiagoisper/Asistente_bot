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
      { role: 'user', contentEncrypted: encryptClinicalContent('¿Ventana de la visita 6?') },
      { role: 'assistant', contentEncrypted: encryptClinicalContent('±7 días respecto del día 169.') },
    ])
    expect(turns).toEqual([
      { role: 'user', content: '¿Ventana de la visita 6?' },
      { role: 'assistant', content: '±7 días respecto del día 169.' },
    ])
  })

  it('un mensaje que no descifra se omite: ni el aviso ni el texto en claro de respaldo', () => {
    const turns = historyTurnsFrom([
      { role: 'user', contentEncrypted: encryptClinicalContent('primera') },
      { role: 'assistant', contentEncrypted: 'v1:basura' },
      { role: 'user', contentEncrypted: encryptClinicalContent('tercera') },
    ])
    expect(turns).toEqual([
      { role: 'user', content: 'primera' },
      { role: 'user', content: 'tercera' },
    ])
    expect(JSON.stringify(turns)).not.toContain(UNREADABLE_MESSAGE)
  })

  it('un texto en claro que viniera en la fila no entra: solo cuenta lo cifrado', () => {
    const fila = { role: 'assistant', contentEncrypted: 'v1:basura', content: 'texto en claro' } as { role: 'assistant'; contentEncrypted: string }
    expect(historyTurnsFrom([fila])).toEqual([])
  })
})
