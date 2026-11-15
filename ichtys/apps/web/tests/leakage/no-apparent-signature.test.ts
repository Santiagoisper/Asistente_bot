import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Sin firma aparente (regla R7 del marco normativo).
 *
 * Alphi no tiene firma electrónica. Mientras no exista una conforme (identidad verificada, significado,
 * vínculo inalterable con el registro), ninguna pantalla puede presentar una acción como «firma» ni como
 * «validación clínica»: quien la usa creería que firmó.
 *
 * Tripwire estático sobre el texto de la aplicación (`app/`, `components/` y `lib/`, sin pruebas ni
 * comentarios). Cada aparición de la palabra tiene que estar en la lista de abajo, con su motivo. Una
 * aparición nueva rompe la prueba: o es un uso que no presenta una acción de firma, y se suma con su
 * motivo, o es justo lo que la regla prohíbe.
 *
 * Límites:
 * - Mira palabras en castellano. Un botón «Sign» en inglés, un ícono o una pantalla que dé a entender
 *   una firma sin decir la palabra no los ve.
 * - No distingue un texto que se muestra de un nombre interno: por eso la lista lleva también usos que
 *   nunca llegan a una pantalla.
 * - Cuando exista la firma con clave personal (docs/decisions/firma-con-clave-personal.md), esta guarda
 *   se reemplaza por una que exija que la palabra aparezca solo en esa función.
 */
const WEB = join(__dirname, '..', '..')
const SCANNED = ['app', 'components', 'lib']

const SIGNATURE = /(?<![\p{L}\p{N}_])firm(?:a|á|as|ar|arlo|arla|ado|ada|ados|adas|e|é|ó|an|amos|aron|ante|antes)(?![\p{L}\p{N}_])/giu
const CLINICAL_VALIDATION = /validaci[oó]n\s+cl[ií]nica|validad[oa]s?\s+cl[ií]nicamente/giu

/**
 * Frases que usan la palabra sin presentar una acción de firma. Archivo → frases exactas y por qué.
 * Se quitan antes de buscar: cualquier otra aparición en ese archivo sigue rompiendo la prueba.
 */
const ALLOWED: Record<string, { phrases: RegExp[]; why: string }> = {
  'app/trust/page.tsx': { phrases: [/pendientes? de firma/giu], why: 'acuerdos con proveedores «pendientes de firma»: habla de contratos, no de una acción en la pantalla' },
  'lib/cabina/demo-data.ts': {
    phrases: [/la versión firmada/giu, /firmado el día de la visita/giu, /'firmar'/giu],
    why: 'datos de demostración sobre el consentimiento en papel que firma el participante, y una palabra para reconocer preguntas sobre él',
  },
  'lib/os/module-status.ts': { phrases: [/el OS firma los pedidos/giu], why: 'firma técnica de un pedido entre sistemas, no de una persona sobre un registro' },
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const files = SCANNED.flatMap((dir) => sourceFiles(join(WEB, dir)))
const key = (file: string) => relative(WEB, file).split(sep).join('/')
const count = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].length

describe('leakage — sin firma aparente (R7)', () => {
  it('recorre la aplicación', () => {
    expect(files.length).toBeGreaterThan(250)
  })

  it('la palabra «firma» no aparece fuera de las frases anotadas', () => {
    const offenders = files
      .filter((file) => {
        const allowed = ALLOWED[key(file)]?.phrases ?? []
        const text = allowed.reduce((rest, phrase) => rest.replace(phrase, ' '), withoutComments(readFileSync(file, 'utf8')))
        return count(SIGNATURE, text) > 0
      })
      .map(key)
    expect(offenders).toEqual([])
  })

  it('cada frase anotada sigue en su archivo: una excepción que ya no hace falta se saca', () => {
    for (const [file, entry] of Object.entries(ALLOWED)) {
      const text = withoutComments(readFileSync(join(WEB, file), 'utf8'))
      for (const phrase of entry.phrases) expect(count(phrase, text), `${file}: ${phrase.source}`).toBeGreaterThan(0)
    }
  })

  it('ninguna pantalla habla de «validación clínica»', () => {
    const offenders = files.filter((file) => count(CLINICAL_VALIDATION, withoutComments(readFileSync(file, 'utf8'))) > 0).map(key)
    expect(offenders).toEqual([])
  })

  it('cada uso permitido dice por qué', () => {
    for (const entry of Object.values(ALLOWED)) expect(entry.why.length).toBeGreaterThan(30)
  })

  it('el detector reconoce lo que tiene que frenar, y no lo que no', () => {
    for (const text of ['<button>Firmar</button>', "label: 'Firma del investigador'", 'Evolución firmada', 'Firmá la evolución', 'firmado por', 'Firmó']) {
      expect(count(SIGNATURE, text), text).toBeGreaterThan(0)
    }
    for (const text of ['Confirmar', 'confirmado por una persona', 'no se afirma nada', 'reafirmar', 'firmware', 'confirmación']) {
      expect(count(SIGNATURE, text), text).toBe(0)
    }
    expect(count(SIGNATURE, withoutComments('// la firma "%PDF-" es la evidencia\nconst a = 1 /* firma */'))).toBe(0)
    expect(count(SIGNATURE, withoutComments("const url = 'https://x.test/firma'"))).toBe(1)
    expect(count(CLINICAL_VALIDATION, 'Validación clínica completa')).toBe(1)
  })
})
