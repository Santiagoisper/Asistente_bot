import { describe, expect, it } from 'vitest'
import { answerQuestion } from '../answers'
import { demoStudy } from '../demo-data'

describe('preguntas de la visita', () => {
  it('contesta con la página cuando la pregunta está en el guion y si no, lo dice', () => {
    expect(answerQuestion('¿Puedo comer antes?', demoStudy.answers)).toEqual({
      text: 'No puede comer. El ayuno es de al menos 8 horas, solo agua, sin ejercicio intenso.',
      page: 19,
    })
    expect(answerQuestion('¿qué extraigo?', demoStudy.answers).page).toBe(109)
    expect(answerQuestion('¿de qué color es el auto?', demoStudy.answers)).toEqual({
      text: 'Eso no figura en el protocolo de esta visita.',
      page: null,
    })
  })
})
