/**
 * Enums compartidos del schema.
 *
 * Viven en su propio módulo (sin importar tablas) para evitar ciclos de
 * inicialización: varias tablas usan estos arrays como `enum` de columnas en
 * tiempo de evaluación del módulo, y unas tablas se referencian entre sí en
 * sus relations. Centralizar los enums acá rompe ese ciclo.
 */

export const studyStatus = ['active', 'closed', 'archived'] as const
export type StudyStatus = (typeof studyStatus)[number]

export const documentType = [
  'protocol',
  'investigator_brochure',
  'lab_manual',
  'pharmacy_manual',
  'other',
] as const
export type DocumentType = (typeof documentType)[number]

export const documentVersionStatus = ['pending', 'processing', 'ready', 'error'] as const
export type DocumentVersionStatus = (typeof documentVersionStatus)[number]

export const messageRole = ['user', 'assistant'] as const
export type MessageRole = (typeof messageRole)[number]

export const answerConfidence = ['high', 'medium', 'low', 'insufficient_evidence'] as const
export type AnswerConfidence = (typeof answerConfidence)[number]

/**
 * Ciclo de vida del study spec extraído. Nace 'draft' SIEMPRE: la extracción
 * LLM requiere revisión humana antes de usarse operativamente (ALPHI: humano
 * en el loop para objetos críticos).
 */
export const studySpecStatus = ['draft', 'approved', 'superseded'] as const
export type StudySpecStatus = (typeof studySpecStatus)[number]

export const auditAction = [
  'document.upload',
  'document.download',
  'document.delete',
  'embeddings.started',
  'embeddings.completed',
  'embeddings.failed',
  'ingestion.start',
  'ingestion.complete',
  'ingestion.error',
  'ingestion.started',
  'ingestion.completed',
  'ingestion.failed',
  'chat.question',
  'chat.answer',
  'chat.insufficient_evidence',
  'rag.answer.requested',
  'rag.answer.completed',
  'rag.answer.failed',
  'citation.view',
  'document.view',
  'auth.login',
  'auth.access_denied',
  'admin.action',
  'study_spec.approved',
] as const
export type AuditAction = (typeof auditAction)[number]
