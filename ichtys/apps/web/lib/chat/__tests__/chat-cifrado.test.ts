import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encryptClinicalContent } from '../../subjects/phi-fields'
import { readConversationTitle, readMessageContent, UNREADABLE_MESSAGE } from '../persistence'
import { buildChatAuditMetadata, CHAT_AUDIT_METADATA_KEYS } from '../audit-metadata'

/**
 * PR-B del chat cifrado (2026-11-16): el cuerpo del mensaje y el título de la
 * conversación se guardan cifrados; el código lee las dos formas hasta el
 * sellado. Estas pruebas sostienen la ida y vuelta, los fallbacks y las dos
 * guardas nuevas (lista cerrada de metadata de auditoría; nada de texto de la
 * pregunta en logs ni escrituras en claro).
 */
const webRoot = join(__dirname, '..', '..', '..', '..', '..')
const read = (relative: string) => readFileSync(join(webRoot, relative), 'utf8')
const savedKey = process.env.PHI_ENCRYPTION_KEY

beforeEach(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})

describe('lectura del contenido cifrado — ida y vuelta y fallbacks', () => {
  it('lo que se guarda cifrado se lee exacto: cuerpo y título', () => {
    const cuerpo = '¿El paciente continúa con metformina 850 mg cada 12 horas?'
    expect(readMessageContent({ contentEncrypted: encryptClinicalContent(cuerpo), content: null })).toBe(cuerpo)
    const titulo = 'Consulta por metformina'
    expect(readConversationTitle({ titleEncrypted: encryptClinicalContent(titulo), title: null })).toBe(titulo)
  })

  it('lo cifrado nunca aparece en claro en el payload guardado', () => {
    const cuerpo = 'HbA1c 8.2 por ciento del sujeto 04'
    const payload = encryptClinicalContent(cuerpo)
    expect(payload).not.toContain('HbA1c')
    expect(payload).not.toContain('8.2')
  })

  it('un cuerpo que no se puede descifrar cae al aviso y no tira la conversación', () => {
    expect(readMessageContent({ contentEncrypted: 'no-es-un-payload-valido', content: null })).toBe(UNREADABLE_MESSAGE)
    expect(readConversationTitle({ titleEncrypted: 'no-es-un-payload-valido', title: null })).toBe('Consulta sin título')
  })

  it('lo heredado en claro se sigue leyendo hasta el sellado', () => {
    expect(readMessageContent({ contentEncrypted: null, content: 'mensaje anterior en claro' })).toBe('mensaje anterior en claro')
    expect(readConversationTitle({ titleEncrypted: null, title: 'título anterior' })).toBe('título anterior')
  })

  it('sin ninguna de las dos, el cuerpo cae al aviso y el título a null', () => {
    expect(readMessageContent({ contentEncrypted: null, content: null })).toBe(UNREADABLE_MESSAGE)
    expect(readConversationTitle({ titleEncrypted: null, title: null })).toBeNull()
  })
})

describe('lista cerrada de claves de metadata de auditoría del chat', () => {
  it('es exactamente esta lista por acción (una clave nueva se ve en el diff de ESTA prueba)', () => {
    expect({ ...CHAT_AUDIT_METADATA_KEYS }).toEqual({
      'rag.answer.requested': ['documentType', 'topK', 'historyTurns', 'streaming'],
      'rag.answer.completed': ['confidence', 'evidenceCount', 'retrievalCount', 'annotationCount', 'streaming'],
      'rag.answer.failed': ['error'],
    })
  })

  it('arma la metadata con las claves conocidas', () => {
    expect(buildChatAuditMetadata('rag.answer.completed', { confidence: 'high', evidenceCount: 3, streaming: true })).toEqual({
      confidence: 'high',
      evidenceCount: 3,
      streaming: true,
    })
  })

  it('una clave fuera de la lista hace fallar el armado, nombrándola', () => {
    expect(() => buildChatAuditMetadata('rag.answer.requested', { question: 'texto de la pregunta' } as never)).toThrow(
      /clave fuera de la lista cerrada para rag.answer.requested: question/,
    )
  })
})

describe('guardas estáticas del PR-B', () => {
  it('answer-engine no loguea texto de la pregunta: ni el archivo ni el slice ni la consola', () => {
    const source = read('packages/rag/answer-engine.ts')
    expect(source).not.toContain('ichtys-rag-scores')
    expect(source).not.toContain('question.slice')
    expect(source).not.toMatch(/q="\$\{/)
  })

  it('el chat no escribe en claro: cuerpo/título van a las columnas cifradas y las anotaciones no se guardan', () => {
    const persistence = read('apps/web/lib/chat/persistence.ts')
    // Escribir el cuerpo en claro sería `content: params.…` (lectura y selects siguen permitidos).
    expect(persistence).not.toMatch(/content: params\./)
    expect(persistence).not.toContain('.set({ title,')
    expect(persistence).not.toMatch(/annotations: (params|null|\[)/)
    const streamRoute = read('apps/web/app/api/chat/stream/route.ts')
    expect(streamRoute).not.toMatch(/annotations: annotations/)
    const chatRoute = read('apps/web/app/api/chat/route.ts')
    expect(chatRoute).not.toMatch(/content: params\./)
  })
})
