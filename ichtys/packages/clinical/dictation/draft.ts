import { applySpokenCorrections, type SpokenCorrection } from './corrections'
import { collapseRepetitions, type RepetitionNotice } from './repetition'
import { DICTATION_BLOCKS, NOT_MENTIONED, splitIntoBlocks, type DictationBlock, type DictationBlockId } from './template'

/**
 * `blocks`: la persona nombró los apartados al dictar; el borrador los ordena y deja
 * a la vista los que no nombró. `narrative`: dictó en texto corrido; el borrador
 * respeta su texto y no le agrega renglones que no dijo.
 */
export type DictationLayout = 'blocks' | 'narrative'

export interface DictationDraft {
  layout: DictationLayout
  blocks: DictationBlock[]
  corrections: SpokenCorrection[]
  /** Frases que el transcriptor repitió en bucle. Se dejó una; el tramo hay que revisarlo. */
  repetitions: RepetitionNotice[]
  /** Apartados de la plantilla que no se nombraron. En `narrative` es una lista de control, no un faltante. */
  missing: DictationBlockId[]
  /** Texto listo para el cuadro de la evolución. */
  text: string
}

/** La apertura no cuenta como faltante: es lo que se dijo antes del primer encabezado. */
const OPTIONAL: readonly DictationBlockId[] = ['apertura']

/** Con menos apartados nombrados que esto, o con casi todo dicho antes del primero, es texto corrido. */
const MIN_NAMED_BLOCKS = 3
const MAX_OPENING_SHARE = 0.5

const wordCount = (text: string | null): number => (text ? text.split(/\s+/).filter(Boolean).length : 0)

export function detectLayout(blocks: readonly DictationBlock[]): DictationLayout {
  const named = blocks.filter((block) => block.text !== null && !OPTIONAL.includes(block.id)).length
  const total = blocks.reduce((sum, block) => sum + wordCount(block.text), 0)
  const opening = wordCount(blocks.find((block) => block.id === 'apertura')?.text ?? null)
  if (named < MIN_NAMED_BLOCKS) return 'narrative'
  return total > 0 && opening / total > MAX_OPENING_SHARE ? 'narrative' : 'blocks'
}

export function composeEvolutionDraft(blocks: readonly DictationBlock[], layout: DictationLayout = 'blocks'): string {
  if (layout === 'narrative') {
    // Lo dicho, en el orden en que se dijo: sin el rótulo de la apertura y sin renglones «No mencionado».
    return blocks
      .filter((block) => block.text !== null)
      .map((block) => (OPTIONAL.includes(block.id) ? block.text : `${block.title}: ${block.text}`))
      .join('\n')
  }
  return blocks
    .filter((block) => block.text !== null || !OPTIONAL.includes(block.id))
    .map((block) => `${block.title}: ${block.text ?? NOT_MENTIONED}`)
    .join('\n')
}

/** De la transcripción al borrador: bucles del transcriptor, correcciones dictadas y, al final, los bloques. */
export function buildDictationDraft(transcript: string): DictationDraft {
  const cleaned = collapseRepetitions(transcript.replace(/\s+/g, ' ').trim())
  const corrected = applySpokenCorrections(cleaned.text)
  const blocks = splitIntoBlocks(corrected.text)
  const layout = detectLayout(blocks)
  const missing = blocks.filter((block) => block.text === null && !OPTIONAL.includes(block.id)).map((block) => block.id)
  return {
    layout,
    blocks,
    corrections: corrected.corrections,
    repetitions: cleaned.repetitions,
    missing,
    text: composeEvolutionDraft(blocks, layout),
  }
}

/**
 * Suma un dictado nuevo a un texto que ya estaba en el cuadro (D16): lo que la persona
 * agrega va a su apartado, no al final como un borrador entero más.
 *
 * - Si el texto ya está por apartados, cada apartado dictado se suma al suyo; uno que decía
 *   «No mencionado» pasa a tener lo dictado. Los renglones escritos a mano fuera de la
 *   plantilla se conservan, al final.
 * - Si el texto es corrido, lo nuevo se agrega debajo, con su título si lo nombró.
 * Nunca quita ni reemplaza lo que ya estaba escrito.
 */
export function mergeDictationAddition(currentText: string, addition: DictationDraft): string {
  const added = addition.blocks.filter((block) => block.text !== null)
  if (added.length === 0) return currentText
  if (currentText.trim().length === 0) return addition.text

  const existing = new Map<DictationBlockId, string>()
  const loose: string[] = []
  for (const line of currentText.split('\n')) {
    const block = DICTATION_BLOCKS.find((candidate) => line.startsWith(`${candidate.title}:`))
    if (!block) {
      if (line.trim().length > 0) loose.push(line)
      continue
    }
    const text = line.slice(block.title.length + 1).trim()
    const previous = existing.get(block.id)
    existing.set(block.id, previous && previous !== NOT_MENTIONED ? `${previous} ${text}` : text)
  }

  if (existing.size === 0) {
    const lines = added.map((block) => (OPTIONAL.includes(block.id) ? block.text! : `${block.title}: ${block.text}`))
    return [currentText.trimEnd(), ...lines].join('\n')
  }

  for (const block of added) {
    const previous = existing.get(block.id)
    existing.set(block.id, !previous || previous === NOT_MENTIONED ? block.text! : `${previous} ${block.text}`)
  }
  const lines = DICTATION_BLOCKS.filter((block) => existing.has(block.id)).map((block) => `${block.title}: ${existing.get(block.id)}`)
  return [...lines, ...loose].join('\n')
}
