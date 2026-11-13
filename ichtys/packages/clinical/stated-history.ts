import type { MissingDatum } from './profile-schema'

/**
 * Antecedentes y estados que se dicen de forma expresa, y su negación.
 *
 * Lo usan dos lados que tienen que coincidir: la extracción (qué se anota de lo que el
 * médico dijo) y la elegibilidad (qué despeja una exclusión). Por eso vive en un solo
 * lugar: la extracción nunca anota «Sin …» de una frase que la elegibilidad no aceptaría
 * como negación pura.
 */

export interface HistoryTerm {
  label: string
  /**
   * Antecedente (algo que pasó alguna vez) o estado (algo que pasa hoy). No se niegan con las
   * mismas palabras: «no presenta pancreatitis» habla de hoy y no despeja un antecedente;
   * «sin antecedentes de embarazo» habla de la historia y no dice que hoy no haya embarazo.
   */
  nature: 'history' | 'state'
  /** Cómo se nombra este dato cuando falta. */
  datum: MissingDatum
  /** La palabra aparece, en un criterio o en una condición del perfil. */
  mention: RegExp
  /** Lo negado ES esto y nada más. «Embarazo previo» o «lactancia previa» no lo son. */
  denial: RegExp
  /** Texto fijo con el que se anota la negación. */
  deniedAs: string
}

export const HISTORY_TERMS: ReadonlyArray<HistoryTerm> = [
  {
    label: 'pancreatitis',
    nature: 'history',
    datum: 'pancreatitis',
    mention: /pancreatitis/i,
    denial: /^pancreatitis(?:\s+(?:agud[ao]|cr[oó]nic[ao]|previ[ao]|conocid[ao]))*$/i,
    deniedAs: 'Sin antecedentes de pancreatitis',
  },
  {
    label: 'embarazo',
    nature: 'state',
    datum: 'pregnancy',
    // «Diabetes gestacional» no es un embarazo en curso: no cuenta como mención.
    // Los criterios de un protocolo pueden venir en inglés; las condiciones del perfil, en castellano.
    mention: /embaraz|gestaci[oó]n(?!al)|gestante|pregnan/i,
    denial: /^embaraz(?:o|ada)(?:\s+(?:actual|en\s+curso))?$/i,
    deniedAs: 'Sin embarazo',
  },
  {
    label: 'lactancia',
    nature: 'state',
    datum: 'lactation',
    mention: /lactancia|amamant|lactando|breast-?feeding|lactati(?:on|ng)|nursing/i,
    denial: /^(?:lactancia(?:\s+(?:materna|actual|en\s+curso))*|amamantando|lactando)$/i,
    deniedAs: 'Sin lactancia',
  },
]

// «Signos» no está entre las palabras de historia a propósito: que hoy no haya signos no dice
// nada del antecedente ni descarta un embarazo (hallazgo de Reviewer en el #136).
const NEGATION_HEAD =
  /^\s*(?:paciente\s+)?(sin|niega|descarta|no\s+(?:presenta|refiere|tiene|registra|hay|cursa|est[aá]))\s+((?:antecedentes?|historia|episodios?|cuadros?|diagn[oó]stico)\s+)?(?:(?:previ[oa]s?|personal(?:es)?)\s+)?(?:de\s+)?(.+?)\s*\.?\s*$/i
const STATE_VERB = /^no\s+(?:presenta|tiene|cursa|est[aá])$/i
const NEGATED_ITEM = /^[a-záéíóúñ]+(?:\s+(?:agud[ao]|cr[oó]nic[ao]|previ[ao]|conocid[ao]|materna|actual|en\s+curso))*$/i

export interface PureNegation {
  items: string[]
  /** De qué habla la negación: de la historia («sin antecedentes de…»), de hoy («no presenta…») o no lo dice («sin…», «niega…»). */
  about: 'history' | 'state' | 'either'
}

/**
 * Negación pura: TODA la frase es la negación, de una cosa o de una lista corta unida por
 * «ni», «o», «y». «Sin antecedentes de pancreatitis», «Niega pancreatitis aguda», «Sin
 * embarazo ni lactancia» devuelven lo negado. Si la frase dice algo más («Niega
 * pancreatitis, pero tuvo una en 2019», «sin fiebre, con pancreatitis crónica», «sin dolor
 * por pancreatitis previa», «sin signos de pancreatitis») no es una negación pura y devuelve
 * null. Una coma no une: no se sabe si la negación sigue del otro lado. Ante la duda gana
 * el lado que obliga a mirar.
 */
export function pureNegation(phrase: string): PureNegation | null {
  const match = phrase.match(NEGATION_HEAD)
  if (!match) return null
  const items = match[3]!.split(/\s+(?:ni|o|y)\s+(?:de\s+)?/i)
  if (!items.every((item) => NEGATED_ITEM.test(item))) return null
  return { items, about: match[2] ? 'history' : STATE_VERB.test(match[1]!.replace(/\s+/g, ' ')) ? 'state' : 'either' }
}

/** Lo negado por una negación pura, o null si la frase no lo es. */
export function negatedItems(phrase: string): string[] | null {
  return pureNegation(phrase)?.items ?? null
}

/** La frase niega este término de forma pura, y habla de lo mismo que el término: historia o estado. */
export function deniesTerm(phrase: string, term: HistoryTerm): boolean {
  const negation = pureNegation(phrase)
  if (negation === null) return false
  if (negation.about !== 'either' && negation.about !== term.nature) return false
  return negation.items.some((item) => term.denial.test(item))
}

const LOOSE_ITEM = /^[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2}$/i
const CONNECTIVE = /(?:^|\s)(?:por|con|desde|pero|salvo|excepto|aunque|tras|luego|hace|durante|seg[uú]n|en|a|al|de|del|la|el|los|las|que)(?:\s|$)/i
const SIGNS_HEAD = /^(?:signos|s[ií]ntomas|evidencia|sospecha|cl[ií]nica)\s+(?:de\s+)?/i

/**
 * La frase entera es una negación y no dice nada más, aunque lo negado no sea exactamente
 * el término ni hable de lo mismo: «no presenta pancreatitis» (habla de hoy), «sin
 * antecedentes de embarazo» (habla de la historia), «sin signos de embarazo», «sin embarazos
 * previos». Una frase así no despeja, pero tampoco afirma: negar no es registrar. Si la frase
 * dice algo más («sin dolor por pancreatitis previa», «sin signos de pancreatitis, internada
 * en 2019») no entra acá, y la mención cuenta como afirmada (relectura de Reviewer, #136).
 */
export function isBareNegation(phrase: string): boolean {
  const match = phrase.match(NEGATION_HEAD)
  if (!match) return false
  const rest = match[3]!.replace(SIGNS_HEAD, '')
  return rest.split(/\s+(?:ni|o|y)\s+(?:de\s+)?/i).every((item) => LOOSE_ITEM.test(item) && !CONNECTIVE.test(item))
}
