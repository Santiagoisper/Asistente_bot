/**
 * normalize/index.ts — superficie de la etapa (c) + confianza (d) de ADR-10
 * §2.2: parsers deterministas, las 4 llamadas del puerto y el ensamblado.
 */
export { parseTiming, type ParseTimingOptions, type ParsedTiming } from './timing'
export { parseWindow } from './window'
export type {
  HeadersInput,
  RowsInput,
  NotesInput,
  RulesInput,
  HeadersOutput,
  RowsOutput,
  NotesOutput,
  RulesOutput,
  LlmPort,
} from './llm-steps'
export {
  headersOutputSchema,
  rowsOutputSchema,
  notesOutputSchema,
  rulesOutputSchema,
} from './llm-steps'
export {
  buildHeadersPrompt,
  buildRowsPrompt,
  buildNotesPrompt,
  buildRulesPrompt,
  NORMALIZER_SYSTEM_PROMPT,
} from './prompts'
export { normalizeSchedule, type NormalizeResult } from './assemble'
