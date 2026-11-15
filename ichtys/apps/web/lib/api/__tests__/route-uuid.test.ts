import { describe, expect, it } from 'vitest'
import { parseRouteUuid } from '../route-uuid'

/**
 * Un identificador que llega por la ruta se comprueba y se pasa a su forma canónica en un solo
 * lugar. La base compara `uuid` sin distinguir mayúsculas; el perfil y el registro guardan texto
 * y sí distinguen (hallazgo del #178, corregido ruta por ruta en el #182).
 */
describe('parseRouteUuid', () => {
  const lower = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b'

  it('devuelve el identificador en minúsculas, como lo devuelve la base', () => {
    expect(parseRouteUuid(lower)).toBe(lower)
    expect(parseRouteUuid(lower.toUpperCase())).toBe(lower)
    expect(parseRouteUuid('A3F1c2d4-5B6e-4f70-8A9b-0c1D2e3f4a5B')).toBe(lower)
  })

  it.each([
    ['vacío', ''],
    ['corto', 'a3f1c2d4-5b6e-4f70-8a9b'],
    ['con una letra que no es hexadecimal', 'g3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b'],
    ['sin guiones', 'a3f1c2d45b6e4f708a9b0c1d2e3f4a5b'],
    ['con espacios alrededor', ` ${lower} `],
    ['con algo pegado atrás', `${lower}; drop`],
    ['con un salto de línea al final', `${lower}\n`],
    ['entre llaves', `{${lower}}`],
  ])('rechaza: %s', (_name, value) => {
    expect(parseRouteUuid(value)).toBeNull()
  })

  it('lo que no es texto no es un identificador', () => {
    expect(parseRouteUuid(undefined)).toBeNull()
    expect(parseRouteUuid(null)).toBeNull()
    expect(parseRouteUuid(['a'] as unknown as string)).toBeNull()
  })
})
