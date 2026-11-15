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
 * Qué busca: la raíz «firm» en cualquier forma (firmar, firmando, firmó, firmante…), «rúbrica» y
 * «suscribir» como sinónimos, las frases de conformidad, «signature», «e-sign» y «signed by» en inglés, y el
 * ícono `Signature` de la biblioteca de íconos.
 *
 * Límites:
 * - No ve una palabra partida en pedazos (`Fir<b>mar</b>`, `'Fir' + 'mar'`) ni armada desde un diccionario
 *   de textos, otros íconos que se leen como firmar (una lapicera), ni una pantalla que dé a entender una
 *   firma sin nombrarla. «Sign» suelto no se busca: la autenticación lo usa en todas partes.
 * - No distingue un texto que se muestra de un nombre interno: por eso la lista lleva también usos que
 *   nunca llegan a una pantalla.
 * - Cuando exista la firma con clave personal (docs/decisions/firma-con-clave-personal.md), esta guarda
 *   se reemplaza por una que exija que la palabra aparezca solo en esa función.
 */
const WEB = join(__dirname, '..', '..')
const SCANNED = ['app', 'components', 'lib']

const BEFORE = String.raw`(?<![\p{L}\p{N}_])`
const AFTER = String.raw`(?![\p{L}\p{N}_])`
/** La raíz, no una lista de conjugaciones: «firmando» o «firmaste» no hay que acordarse de sumarlas. */
const SIGNATURE = new RegExp(`${BEFORE}(?!firmware)firm\\p{L}*`, 'giu')
const SYNONYMS = new RegExp(`${BEFORE}(?:r[uú]bric\\p{L}*|suscri(?:b|pt|t)\\p{L}*)`, 'giu')
const ENGLISH = new RegExp(`${BEFORE}(?:e-?sign(?:ed|ature)?|signatures?|signed by)${AFTER}`, 'giu')
const CLINICAL_VALIDATION = /validaci[oó]n\s+cl[ií]nica|validad[oa]s?\s+cl[ií]nicamente|conformidad\s+del\s+investigador|doy\s+(?:mi\s+)?conformidad/giu
const SIGNATURE_ICON = /import\s*\{[^}]*\bSignature\b[^}]*\}\s*from\s*['"]lucide-react['"]/gu
const WORDS = [SIGNATURE, SYNONYMS, ENGLISH]

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
        return WORDS.some((pattern) => count(pattern, text) > 0)
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

  it('ninguna pantalla habla de «validación clínica» ni de dar conformidad', () => {
    const offenders = files.filter((file) => count(CLINICAL_VALIDATION, withoutComments(readFileSync(file, 'utf8'))) > 0).map(key)
    expect(offenders).toEqual([])
  })

  it('ninguna pantalla usa el ícono de firma', () => {
    const offenders = files.filter((file) => count(SIGNATURE_ICON, readFileSync(file, 'utf8')) > 0).map(key)
    expect(offenders).toEqual([])
  })

  it('cada uso permitido dice por qué', () => {
    for (const entry of Object.values(ALLOWED)) expect(entry.why.length).toBeGreaterThan(30)
  })

  it('el detector reconoce lo que tiene que frenar, y no lo que no', () => {
    for (const text of ['<button>Firmar</button>', "label: 'Firma del investigador'", 'Evolución firmada', 'Firmá la evolución', 'firmado por', 'Firmó', 'Firmando…', 'firmo y cierro', '¿Firmás?', 'firmaste', 'los firmantes']) {
      expect(count(SIGNATURE, text), text).toBeGreaterThan(0)
    }
    for (const text of ['Confirmar', 'confirmado por una persona', 'no se afirma nada', 'reafirmar', 'firmware', 'confirmación']) {
      expect(count(SIGNATURE, text), text).toBe(0)
    }
    for (const text of ['Rubricar', 'con la rúbrica del investigador', 'Suscribir la evolución', 'suscripto por', 'suscrito']) expect(count(SYNONYMS, text), text).toBe(1)
    for (const text of ['suscripción mensual', 'rubro']) expect(count(SYNONYMS, text), text).toBe(0)
    for (const text of ['Signature', 'e-sign', 'eSignature', 'Signed by the investigator']) expect(count(ENGLISH, text), text).toBeGreaterThan(0)
    for (const text of ['Sign in', 'signIn()', 'headerSignature', 'typeSignal', 'designed']) expect(count(ENGLISH, text), text).toBe(0)
    for (const text of ['Validación clínica completa', 'Conformidad del investigador', 'Doy mi conformidad']) expect(count(CLINICAL_VALIDATION, text), text).toBe(1)
    expect(count(CLINICAL_VALIDATION, 'conforme a la norma')).toBe(0)
    expect(count(SIGNATURE_ICON, "import { Check, Signature } from 'lucide-react'")).toBe(1)
    expect(count(SIGNATURE_ICON, "import { Check } from 'lucide-react'")).toBe(0)
    expect(count(SIGNATURE, withoutComments('// la firma "%PDF-" es la evidencia\nconst a = 1 /* firma */'))).toBe(0)
    expect(count(SIGNATURE, withoutComments("const url = 'https://x.test/firma'"))).toBe(1)
  })
})
