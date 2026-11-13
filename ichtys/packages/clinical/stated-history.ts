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
    mention: /pancreatitis/i,
    denial: /^pancreatitis(?:\s+(?:agud[ao]|cr[oó]nic[ao]|previ[ao]|conocid[ao]))*$/i,
    deniedAs: 'Sin antecedentes de pancreatitis',
  },
  {
    label: 'embarazo',
    // «Diabetes gestacional» no es un embarazo en curso: no cuenta como mención.
    // Los criterios de un protocolo pueden venir en inglés; las condiciones del perfil, en castellano.
    mention: /embaraz|gestaci[oó]n(?!al)|gestante|pregnan/i,
    denial: /^embaraz(?:o|ada)(?:\s+(?:actual|en\s+curso))?$/i,
    deniedAs: 'Sin embarazo',
  },
  {
    label: 'lactancia',
    mention: /lactancia|amamant|lactando|breast-?feeding|lactati(?:on|ng)|nursing/i,
    denial: /^(?:lactancia(?:\s+(?:materna|actual|en\s+curso))*|amamantando|lactando)$/i,
    deniedAs: 'Sin lactancia',
  },
]

const NEGATION_HEAD =
  /^\s*(?:paciente\s+)?(?:sin|niega|descarta|no\s+(?:presenta|refiere|tiene|registra|hay|cursa|est[aá]))\s+(?:(?:antecedentes?|historia|episodios?|cuadros?|diagn[oó]stico|signos)\s+)?(?:(?:previ[oa]s?|personal(?:es)?)\s+)?(?:de\s+)?(.+?)\s*\.?\s*$/i
const NEGATED_ITEM = /^[a-záéíóúñ]+(?:\s+(?:agud[ao]|cr[oó]nic[ao]|previ[ao]|conocid[ao]|materna|actual|en\s+curso))*$/i

/**
 * Negación pura: TODA la frase es la negación, de una cosa o de una lista corta unida por
 * «ni», «o», «y». «Sin antecedentes de pancreatitis», «Niega pancreatitis aguda», «Sin
 * embarazo ni lactancia» devuelven lo negado. Si la frase dice algo más («Niega
 * pancreatitis, pero tuvo una en 2019», «sin fiebre, con pancreatitis crónica», «sin dolor
 * por pancreatitis previa») no es una negación pura y devuelve null. Una coma no une: no
 * se sabe si la negación sigue del otro lado. Ante la duda gana el lado que obliga a mirar.
 */
export function negatedItems(phrase: string): string[] | null {
  const match = phrase.match(NEGATION_HEAD)
  if (!match) return null
  const items = match[1]!.split(/\s+(?:ni|o|y)\s+(?:de\s+)?/i)
  return items.every((item) => NEGATED_ITEM.test(item)) ? items : null
}

/** La frase niega este término de forma pura (sola o dentro de una lista corta). */
export function deniesTerm(phrase: string, term: HistoryTerm): boolean {
  const items = negatedItems(phrase)
  return items !== null && items.some((item) => term.denial.test(item))
}
