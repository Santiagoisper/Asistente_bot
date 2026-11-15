import { describe, expect, it } from 'vitest'
import { answerModel } from '../answer-model'

const event = (kind: string, model: string, provider = 'anthropic') => ({ kind, provider, model, inputTokens: 1, outputTokens: 1 })

describe('con qué modelo se generó una respuesta', () => {
  it('es el de la llamada que escribe la respuesta, no el de la evaluación', () => {
    expect(answerModel([event('chat_answer', 'modelo-a'), event('chat_eval', 'modelo-b', 'google')])).toEqual({ provider: 'anthropic', model: 'modelo-a' })
    expect(answerModel([event('chat_eval', 'modelo-b', 'google'), event('chat_answer', 'modelo-a')])).toEqual({ provider: 'anthropic', model: 'modelo-a' })
  })

  it('si la respuesta se generó más de una vez, vale la última', () => {
    expect(answerModel([event('chat_answer', 'modelo-a'), event('chat_answer', 'modelo-c', 'openai')])).toEqual({ provider: 'openai', model: 'modelo-c' })
  })

  it('anota el modelo que el proveedor dijo que respondió; si no lo informó, el que se pidió', () => {
    expect(answerModel([{ ...event('chat_answer', 'modelo-pedido'), responseModel: 'modelo-que-respondio-20260101' }])).toEqual({ provider: 'anthropic', model: 'modelo-que-respondio-20260101' })
    expect(answerModel([{ ...event('chat_answer', 'modelo-pedido'), responseModel: null }])).toEqual({ provider: 'anthropic', model: 'modelo-pedido' })
    expect(answerModel([{ ...event('chat_answer', 'modelo-pedido'), responseModel: '' }])).toEqual({ provider: 'anthropic', model: 'modelo-pedido' })
  })

  it('sin ninguna llamada que escriba la respuesta no hay modelo que anotar', () => {
    expect(answerModel([])).toBeNull()
    expect(answerModel(undefined)).toBeNull()
    expect(answerModel([event('chat_eval', 'modelo-b')])).toBeNull()
  })
})
