import { splitClauses } from './clauses'

/**
 * Bloques de la evolución dictada (docs/decisions/consulta-dictada.md, D6).
 * Provisorios: alinear con la plantilla del informe del 12/11 antes de fijarlos.
 * El médico nombra el bloque al empezar a dictarlo; lo que no nombra queda
 * «No mencionado», a la vista.
 */
export const DICTATION_BLOCKS = [
  {
    id: 'apertura',
    title: 'Apertura',
    headings: ['apertura'],
    say: null,
    hint: 'Empezá sin nombrar nada: qué visita es y la edad.',
    example: 'Visita 3 del estudio. Paciente de 58 años.',
  },
  {
    id: 'motivo',
    title: 'Motivo de la visita',
    headings: ['motivo de la visita', 'motivo de consulta', 'motivo'],
    say: 'Motivo de la visita',
    hint: 'Por qué viene hoy.',
    example: 'Control programado.',
  },
  {
    id: 'evolucion',
    title: 'Evolución desde la última visita',
    headings: ['evolucion desde la ultima visita', 'evolucion', 'enfermedad actual'],
    say: 'Evolución',
    hint: 'Qué cambió desde la visita anterior y cómo se siente.',
    example: 'Refiere buena tolerancia, sin cambios en sus hábitos.',
  },
  {
    id: 'medicacion',
    title: 'Medicación actual y adherencia',
    headings: ['medicacion actual y adherencia', 'medicacion actual', 'medicacion', 'tratamiento actual'],
    say: 'Medicación actual',
    hint: 'Cada medicamento con dosis y frecuencia. Si cumple.',
    example: 'Metformina 850 mg cada 12 horas, sin cambios. Buena adherencia.',
  },
  {
    id: 'eventos',
    title: 'Eventos adversos',
    headings: ['eventos adversos', 'evento adverso'],
    say: 'Eventos adversos',
    hint: 'Cuáles, desde cuándo, intensidad. Si no hubo, decilo.',
    example: 'Ninguno desde la última visita.',
  },
  {
    id: 'vitales',
    title: 'Signos vitales',
    headings: ['signos vitales'],
    say: 'Signos vitales',
    hint: 'Presión, frecuencia cardíaca, peso, temperatura.',
    example: 'Presión arterial 132 sobre 84. Frecuencia cardíaca 72.',
  },
  {
    id: 'examen',
    title: 'Examen físico',
    headings: ['examen fisico'],
    say: 'Examen físico',
    hint: 'Lo que encontraste al examinar.',
    example: 'Sin hallazgos de relevancia.',
  },
  {
    id: 'laboratorio',
    title: 'Laboratorio y estudios',
    headings: ['laboratorio y estudios', 'laboratorio', 'estudios complementarios'],
    say: 'Laboratorio',
    hint: 'Qué se extrajo o qué resultados trae.',
    example: 'Se toman muestras según el protocolo.',
  },
  {
    id: 'evaluacion',
    title: 'Evaluación',
    headings: ['evaluacion', 'impresion clinica'],
    say: 'Impresión clínica',
    hint: 'Tu conclusión sobre cómo está.',
    example: 'Paciente estable.',
  },
  {
    id: 'criterios',
    title: 'Criterios o desvíos',
    headings: ['criterios o desvios', 'criterios', 'desvios'],
    say: 'Criterios o desvíos',
    hint: 'Si sigue cumpliendo los criterios y si hubo algún desvío.',
    example: 'Sin desvíos al protocolo.',
  },
  {
    id: 'plan',
    title: 'Plan',
    headings: ['plan'],
    say: 'Plan',
    hint: 'Qué se indica y qué queda pendiente.',
    example: 'Continúa con el mismo tratamiento.',
  },
  {
    id: 'proxima',
    title: 'Próxima visita',
    headings: ['proxima visita', 'proximo control'],
    say: 'Próxima visita',
    hint: 'Cuándo vuelve.',
    example: 'En cuatro semanas.',
  },
] as const

export type DictationBlockId = (typeof DICTATION_BLOCKS)[number]['id']

export interface DictationBlock {
  id: DictationBlockId
  title: string
  /** `null` = el médico no dictó este bloque. */
  text: string | null
}

export const NOT_MENTIONED = 'No mencionado'

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** «exámenes» → «examen», «signos» → «signo». Las palabras cortas quedan como están. */
function singular(word: string): string {
  if (word.length <= 4) return word
  if (word.endsWith('es') && word.length > 6) return word.slice(0, -2)
  return word.endsWith('s') ? word.slice(0, -1) : word
}

/** Distancia de edición entre dos textos cortos. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

/**
 * ¿La frase empieza con este encabezado? Devuelve cuántas palabras ocupa y a qué distancia quedó.
 * La transcripción deforma palabras («signos y tales» por «signos vitales»),
 * así que se compara sin espacios y se tolera una diferencia chica. Los
 * encabezados de hasta cuatro letras («plan») tienen que venir exactos.
 */
function headingWords(words: readonly string[], heading: string): { count: number; distance: number } {
  const target = heading.replace(/\s+/g, '')
  // Un cuarto del largo, con tope de tres letras: en un encabezado largo, un cuarto alcanzaba para
  // cambiarle la primera palabra entera («Ninguno desde la última visita» abría «Evolución desde…»).
  const tolerance = target.length <= 4 ? 0 : Math.min(3, Math.max(1, Math.floor(target.length * 0.25)))
  const size = heading.split(' ').length
  // La primera palabra tiene que ser la del encabezado (se le perdona una letra si es larga):
  // «Sin eventos adversos» no es el encabezado «Eventos adversos» con una palabra de más.
  // El plural no cuenta: el transcriptor escribe «exámenes físicos» o «impresiones clínicas».
  const first = singular(heading.split(' ')[0]!)
  if (words.length === 0 || editDistance(singular(words[0]!), first) > (first.length <= 4 ? 0 : 1)) {
    return { count: 0, distance: Number.POSITIVE_INFINITY }
  }
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const count of [size, size + 1, size - 1]) {
    if (count < 1 || count > words.length) continue
    const distance = editDistance(words.slice(0, count).join(''), target)
    if (distance <= tolerance && distance < bestDistance) {
      best = count
      bestDistance = distance
    }
  }
  return { count: best, distance: bestDistance }
}

/**
 * Parte el texto en bloques. Lo dictado antes del primer encabezado va a la apertura.
 *
 * Un encabezado vale al comienzo de una frase («Signos vitales. …», «Plan solicitar…»).
 * Quien dicta de corrido no hace pausas y el transcriptor separa con comas, así que
 * también vale después de una coma o de dos puntos, con más exigencia: tiene que ser un
 * encabezado de varias palabras («próxima visita en cuatro semanas») o una palabra que
 * esté sola entre comas cuando el apartado en curso ya tiene contenido («…, plan, continúa igual»). «Motivo por el cual», «evolución
 * favorable» o «sin eventos adversos» en medio de una frase son texto.
 */
export function splitIntoBlocks(text: string): DictationBlock[] {
  const headings = DICTATION_BLOCKS.flatMap((block) => block.headings.map((heading) => ({ id: block.id, heading })))
  const parts = new Map<DictationBlockId, string[]>()
  let current: DictationBlockId = 'apertura'
  let buffer = ''
  const flush = () => {
    // Un tramo que quedó cortado por un encabezado termina en coma o en dos puntos: se cierra con punto.
    const body = buffer.trim().replace(/[,:]+$/, '').trim()
    buffer = ''
    if (body.replace(/[.;]/g, '').trim().length === 0) return
    const closed = /[.;!?]$/.test(body) ? body : `${body}.`
    const list = parts.get(current) ?? []
    list.push(closed.charAt(0).toUpperCase() + closed.slice(1))
    parts.set(current, list)
  }

  let sentenceStart = true
  let previousDelimiter = '.'
  for (const clause of splitClauses(text, '.;,:\n')) {
    const rawWords = clause.text.split(/\s+/)
    const words = rawWords.map((word) => plain(word).replace(/[^a-z0-9]/g, ''))
    // Gana el encabezado más parecido, no el primero que entra en la tolerancia: «Evolución»
    // está a dos letras de «evaluación» y tiene que abrir su propio bloque.
    let best: { id: DictationBlockId; count: number; distance: number; multiword: boolean } | null = null
    for (const { id, heading } of headings) {
      const match = headingWords(words, heading)
      if (match.count === 0) continue
      if (!best || match.distance < best.distance) best = { id, ...match, multiword: heading.includes(' ') }
    }
    // Una palabra suelta después de una coma abre apartado solo si el apartado en curso ya tiene
    // contenido: en «Plan: laboratorio» o «…, plan, laboratorio» la segunda palabra es lo dictado.
    const loneWord = best !== null && best.count === words.length && previousDelimiter === ',' && buffer.trim().length > 0
    const opens = best !== null && (sentenceStart || best.multiword || loneWord)
    if (best && opens) {
      flush()
      current = best.id
      const rest = rawWords.slice(best.count).join(' ').replace(/^[\s:,.;-]+/, '')
      buffer = rest.length > 0 ? rest + clause.delimiter : ''
    } else {
      buffer += (buffer.length > 0 ? ' ' : '') + clause.text + clause.delimiter
    }
    sentenceStart = clause.delimiter === '.' || clause.delimiter === ';'
    previousDelimiter = clause.delimiter
  }
  flush()

  return DICTATION_BLOCKS.map((block) => ({
    id: block.id,
    title: block.title,
    text: parts.has(block.id) ? parts.get(block.id)!.join(' ') : null,
  }))
}
