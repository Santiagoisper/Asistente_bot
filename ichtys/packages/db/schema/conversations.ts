import { pgTable, uuid, text, integer, real, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { chunks } from './chunks'
import { documents, documentVersions } from './documents'
import { documentType, messageRole, answerConfidence } from './enums'

/**
 * `insufficient_evidence` NO es un error: es la respuesta correcta cuando no
 * hay chunks suficientes (ver PRD §7.4 y CLAUDE.md regla 6).
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    userId: text('user_id').notNull(), // Clerk user ID
    /**
     * Título cifrado (2026-11-16, migración 0026): el título lo arma un modelo desde la
     * primera pregunta y puede llevar dato clínico. La columna en claro `title` se dejó de
     * leer el 17/11/2026, después del sellado, y la saca la migración 0028. Null mientras
     * la conversación no tiene título.
     */
    titleEncrypted: text('title_encrypted'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStudyIdx: index('conversations_org_study_idx').on(t.organizationId, t.studyId),
  }),
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    role: text('role', { enum: messageRole }).notNull(),
    /**
     * Cuerpo cifrado (2026-11-16, migración 0026): pregunta y respuesta van acá, y es el único
     * cuerpo del mensaje. La columna en claro `content` se dejó de leer el 17/11/2026, después
     * del sellado (todos los mensajes de prueba y de producción con cuerpo cifrado), y la saca
     * la migración 0028, que además vuelve obligatoria esta.
     */
    contentEncrypted: text('content_encrypted').notNull(),
    confidence: text('confidence', { enum: answerConfidence }),
    /**
     * (Columna `annotations` de la base: fuera del schema desde el PR-B del chat
     * cifrado, 2026-11-16. Las anotaciones se dejan de guardar: se calculan en
     * memoria para el stream y se recalculan al reabrir. La columna vieja la saca la
     * migración 0028.)
     */
    /**
     * Con qué proveedor y modelo se generó la respuesta (regla R6). Null en los mensajes de la
     * persona, en las respuestas sin llamada a un modelo (sin evidencia) y en las anteriores al
     * 15/11/2026. No es contenido: es el nombre del modelo.
     */
    provider: text('provider'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationIdx: index('messages_conversation_idx').on(t.conversationId),
    /** Un mensaje de la persona no tiene modelo: lo exige la base, no solo el código. */
    modelOnlyOnAssistantCheck: check(
      'messages_model_only_on_assistant_check',
      sql`${t.role} = 'assistant' OR (${t.provider} IS NULL AND ${t.model} IS NULL)`,
    ),
    /** Proveedor y modelo van juntos: o están los dos o no está ninguno. */
    providerAndModelTogetherCheck: check(
      'messages_provider_and_model_together_check',
      sql`(${t.provider} IS NULL) = (${t.model} IS NULL)`,
    ),
  }),
)

/**
 * citations — evidencia trazable de cada respuesta del assistant.
 * Snapshotea la metadata de la fuente (nombre, página, excerpt) al momento de
 * responder, para que el historial sea reproducible aunque cambie el documento.
 */
export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => chunks.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id),
    /** NULL identifica citas anteriores al mapeo verificable de índices. */
    citationIndex: integer('citation_index'),
    documentName: text('document_name').notNull(),
    documentType: text('document_type', { enum: documentType }).notNull(),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    sectionTitle: text('section_title'),
    excerpt: text('excerpt').notNull(),
    similarityScore: real('similarity_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageIdx: index('citations_message_idx').on(t.messageId),
    messageCitationIndexIdx: uniqueIndex('citations_message_citation_index_idx').on(t.messageId, t.citationIndex),
  }),
)

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [conversations.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [conversations.studyId],
    references: [studies.id],
  }),
  messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  citations: many(citations),
}))

export const citationsRelations = relations(citations, ({ one }) => ({
  message: one(messages, {
    fields: [citations.messageId],
    references: [messages.id],
  }),
  chunk: one(chunks, {
    fields: [citations.chunkId],
    references: [chunks.id],
  }),
}))

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Citation = typeof citations.$inferSelect
export type NewCitation = typeof citations.$inferInsert
