import type { ScriptedAnswer } from './types'

const NO_MATCH = 'Eso no figura en el protocolo de esta visita.'

function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export function answerQuestion(question: string, answers: ScriptedAnswer[]): { text: string; page: number | null } {
  const folded = fold(question)
  for (const answer of answers) {
    if (answer.patterns.some((pattern) => folded.includes(fold(pattern)))) {
      return { text: answer.answer, page: answer.page }
    }
  }
  return { text: NO_MATCH, page: null }
}
