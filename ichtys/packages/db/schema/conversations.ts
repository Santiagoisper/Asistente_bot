import { pgTable, uuid, text, integer, real, timestamp, index, jsonb } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
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
    title: text('title'),
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
    content: text('content').notNull(),
    confidence: text('confidence', { enum: answerConfidence }),
    /**
     * SNOMED-CT / LOINC annotations detected in the assistant's answer.
     * Nullable: null for user messages and answers with insufficient_evidence.
     * Shape: MedicalAnnotation[] — see packages/rag/medical-annotator.ts.
     */
    annotations: jsonb('annotations'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationIdx: index('messages_conversation_idx').on(t.conversationId),
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
