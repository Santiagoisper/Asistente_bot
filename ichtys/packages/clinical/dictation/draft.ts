import { applySpokenCorrections, type SpokenCorrection } from './corrections'
import { NOT_MENTIONED, splitIntoBlocks, type DictationBlock, type DictationBlockId } from './template'

export interface DictationDraft {
  blocks: DictationBlock[]
  corrections: SpokenCorrection[]
  missing: DictationBlockId[]
  /** Texto listo para el cuadro de la evolución. Los bloques sin dictar dicen «No mencionado». */
  text: string
}

/** La apertura no cuenta como faltante: es lo que se dijo antes del primer encabezado. */
const OPTIONAL: readonly DictationBlockId[] = ['apertura']

export function composeEvolutionDraft(blocks: readonly DictationBlock[]): string {
  return blocks
    .filter((block) => block.text !== null || !OPTIONAL.includes(block.id))
    .map((block) => `${block.title}: ${block.text ?? NOT_MENTIONED}`)
    .join('\n')
}

/** De la transcripción al borrador: primero las correcciones dictadas, después los bloques. */
export function buildDictationDraft(transcript: string): DictationDraft {
  const corrected = applySpokenCorrections(transcript.replace(/\s+/g, ' ').trim())
  const blocks = splitIntoBlocks(corrected.text)
  const missing = blocks.filter((block) => block.text === null && !OPTIONAL.includes(block.id)).map((block) => block.id)
  return { blocks, corrections: corrected.corrections, missing, text: composeEvolutionDraft(blocks) }
}
