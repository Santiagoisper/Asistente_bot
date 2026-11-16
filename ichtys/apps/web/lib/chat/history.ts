import { db } from '@ichtys/db'
import { annotateAnswerSync, type MedicalAnnotation } from '@ichtys/rag/medical-annotator'
import { readConversationTitle, readMessageContent } from './persistence'
import type { AnswerConfidence, MessageRole } from '@ichtys/db'

/**
 * history.ts — server-only helpers de lectura para el historial de chat.
 *
 * Reglas:
 *  - Toda query filtra por orgId/studyId/userId antes de devolver datos.
 *  - No se exponen embeddings, prompts crudos ni chunks completos.
 *  - Las queries usan las callbacks de Drizzle para ORDER BY; no se importan
 *    operadores adicionales de drizzle-orm.
 */

// ---------------------------------------------------------------------------
// Tipos de respuesta
// ---------------------------------------------------------------------------

export type ConversationListItem = {
  conversationId: string
  studyId: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export type MessageItem = {
  messageId: string
  role: MessageRole
  content: string
  confidence: AnswerConfidence | null
  createdAt: string
  /**
   * Anotaciones recalculadas al reabrir (PR-B del chat cifrado): ya no se
   * guardan. Solo para respuestas del asistente; se recalculan con el
   * diccionario sobre la respuesta ya descifrada (menos de 2 ms, sin red), así
   * que pueden diferir de las de la consulta en vivo — no son dato guardado.
   */
  annotations?: MedicalAnnotation[]
}

export type CitationItem = {
  citationId: string
  citationIndex: number | null
  chunkId: string
  documentId: string
  documentVersionId: string
  documentName: string
  documentType: string
  pageStart: number | null
  pageEnd: number | null
  sectionTitle: string | null
  excerpt: string
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista las conversaciones del usuario dentro de un study autorizado.
 * Filtra por orgId + studyId + userId en la query — nunca en memoria.
 */
export async function listConversationsForStudy(
  orgId: string,
  studyId: string,
  userId: string,
): Promise<ConversationListItem[]> {
  const rows = await db.query.conversations.findMany({
    where: (c, { and, eq }) => and(eq(c.organizationId, orgId), eq(c.studyId, studyId), eq(c.userId, userId)),
    orderBy: (c, { desc }) => desc(c.updatedAt),
  })

  return rows.map((row) => ({
    conversationId: row.id,
    studyId: row.studyId,
    title: readConversationTitle(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/**
 * Devuelve los mensajes de una conversación autorizada en orden ascendente.
 * La autorización (orgId+studyId+userId) ya fue validada por el caller.
 */
export async function getConversationMessages(
  conversationId: string,
  orgId: string,
  studyId: string,
): Promise<MessageItem[]> {
  const rows = await db.query.messages.findMany({
    where: (m, { and, eq }) =>
      and(eq(m.conversationId, conversationId), eq(m.organizationId, orgId), eq(m.studyId, studyId)),
    orderBy: (m, { asc }) => asc(m.createdAt),
  })

  return rows.map((row) => ({
    messageId: row.id,
    role: row.role,
    content: readMessageContent(row),
    confidence: row.confidence ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(row.role === 'assistant' ? { annotations: annotateAnswerSync(readMessageContent(row)) } : {}),
  }))
}

/**
 * Devuelve las citations de un assistant message autorizado.
 * La autorización ya fue validada por el caller (incluida la cadena
 * messageId → conversationId → userId).
 */
export async function getMessageCitations(messageId: string, orgId: string, studyId: string): Promise<CitationItem[]> {
  const rows = await db.query.citations.findMany({
    where: (c, { and, eq }) => and(eq(c.messageId, messageId), eq(c.organizationId, orgId), eq(c.studyId, studyId)),
    orderBy: (c, { asc }) => [asc(c.citationIndex), asc(c.createdAt), asc(c.id)],
  })

  return rows.map((row) => ({
    citationId: row.id,
    citationIndex: row.citationIndex,
    chunkId: row.chunkId,
    documentId: row.documentId,
    documentVersionId: row.documentVersionId,
    documentName: row.documentName,
    documentType: row.documentType,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    sectionTitle: row.sectionTitle,
    excerpt: row.excerpt,
  }))
}
