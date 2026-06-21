import {
  and,
  db,
  eq,
  inArray,
  auditLogs,
  citations,
  conversations,
  documents,
  messages,
  type AnswerConfidence,
  type AuditAction,
} from '@ichtys/db'
import { AccessError, logServerError } from '@ichtys/auth'
import type { Evidence } from '@ichtys/rag'

/**
 * persistence.ts — helpers server-only de persistencia de chat.
 *
 * Responsabilidades:
 *  - Crear o validar conversaciones (tenant-isolated).
 *  - Persistir user messages y assistant messages + citations.
 *  - Escribir audit logs mandatory o best-effort segun politica.
 *
 * Reglas:
 *  - No recibe orgId del body/cliente — siempre resuelto por el caller desde Clerk.
 *  - No loguea pregunta, respuesta, chunks ni PHI.
 *  - `persistAssistantMessageAndCitations` es atómica: si falla cualquier paso
 *    (incluido metadata de documento faltante o pageStart nulo), toda la TX falla.
 */

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

/**
 * Si `conversationId` es undefined, crea una conversación nueva.
 * Si viene, valida que pertenezca a orgId + studyId + userId — hard boundary de seguridad.
 */
export async function getOrCreateConversation(params: {
  conversationId: string | undefined
  orgId: string
  studyId: string
  userId: string
}): Promise<string> {
  if (!params.conversationId) {
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: params.orgId,
        studyId: params.studyId,
        userId: params.userId,
      })
      .returning({ id: conversations.id })

    if (!conv) throw new Error('Failed to create conversation')
    return conv.id
  }

  // Three-field validation: org + study + user must all match.
  const existing = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, params.conversationId),
      eq(conversations.organizationId, params.orgId),
      eq(conversations.studyId, params.studyId),
      eq(conversations.userId, params.userId),
    ),
  })

  if (!existing) {
    throw new AccessError('Conversation not found or access denied', 404)
  }

  return existing.id
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

export async function persistUserMessage(params: {
  conversationId: string
  orgId: string
  studyId: string
  question: string
}): Promise<string> {
  const [msg] = await db
    .insert(messages)
    .values({
      conversationId: params.conversationId,
      organizationId: params.orgId,
      studyId: params.studyId,
      role: 'user',
      content: params.question,
    })
    .returning({ id: messages.id })

  if (!msg) throw new Error('Failed to persist user message')
  return msg.id
}

/**
 * Persiste el mensaje del assistant y sus citations en una sola transacción.
 *
 * - La metadata de documentos se fetch DENTRO de la TX para garantizar consistencia.
 * - Si el documentId de cualquier evidence no se encuentra: hard failure (TX rollback).
 * - Si pageStart o pageEnd son null: hard failure — dato de integridad clínica.
 * - Si evidences = [] (insufficient_evidence): solo se persiste el message, sin citations.
 */
export async function persistAssistantMessageAndCitations(params: {
  conversationId: string
  orgId: string
  studyId: string
  answer: string
  confidence: AnswerConfidence
  evidences: Evidence[]
}): Promise<string> {
  return db.transaction(async (tx) => {
    // 1. Insertar mensaje del assistant.
    const [assistantMsg] = await tx
      .insert(messages)
      .values({
        conversationId: params.conversationId,
        organizationId: params.orgId,
        studyId: params.studyId,
        role: 'assistant',
        content: params.answer,
        confidence: params.confidence,
      })
      .returning({ id: messages.id })

    if (!assistantMsg) throw new Error('Failed to persist assistant message')

    // 2. Persistir citations solo si hay evidencias.
    if (params.evidences.length > 0) {
      // Fetch document metadata dentro de la TX — garantiza consistencia.
      const documentIds = [...new Set(params.evidences.map((e) => e.documentId))]

      const docs = await tx
        .select({
          id: documents.id,
          name: documents.name,
          documentType: documents.documentType,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.id, documentIds),
            eq(documents.organizationId, params.orgId),
          ),
        )

      const docMap = new Map(docs.map((d) => [d.id, { name: d.name, documentType: d.documentType }]))

      for (const evidence of params.evidences) {
        const docMeta = docMap.get(evidence.documentId)
        if (!docMeta) {
          // Hard failure — no persistir citation sin metadata real del documento.
          throw new Error(
            `Document metadata not found for citation — document may have been deleted`,
          )
        }

        // pageStart/pageEnd son notNull en DB. En retrieval siempre son numbers.
        // Si llegaran null, es una falla de integridad que no debe silenciarse.
        if (evidence.pageStart === null || evidence.pageEnd === null) {
          throw new Error('Evidence has null page numbers — data integrity error')
        }

        await tx.insert(citations).values({
          messageId: assistantMsg.id,
          chunkId: evidence.chunkId,
          organizationId: params.orgId,
          studyId: params.studyId,
          documentId: evidence.documentId,
          documentVersionId: evidence.documentVersionId,
          documentName: docMeta.name,
          documentType: docMeta.documentType,
          pageStart: evidence.pageStart,
          pageEnd: evidence.pageEnd,
          sectionTitle: evidence.sectionTitle,
          excerpt: evidence.excerpt,
        })
      }
    }

    return assistantMsg.id
  })
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Audit log helpers: writeAuditLog is mandatory; safeWriteAuditLog is best-effort.
 * Metadata must stay limited to IDs, counts, confidence values, and codes.
 *
 * Metadata permitida: IDs, counts, confidence, codes — nunca texto de usuario,
 * respuestas, chunks, prompts ni PHI.
 */
type AuditLogParams = {
  action: AuditAction
  orgId?: string
  studyId?: string
  userId?: string
  resourceType?: string
  resourceId?: string
  metadata?: Record<string, unknown>
}

export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  await db.insert(auditLogs).values({
    action: params.action,
    organizationId: params.orgId,
    studyId: params.studyId,
    userId: params.userId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    metadata: params.metadata ?? null,
  })
}

export async function safeWriteAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await writeAuditLog(params)
  } catch {
    // Swallow — audit failures are not fatal (SECURITY.md §15).
    logServerError('[audit] Failed to write audit log', params.action)
  }
}
