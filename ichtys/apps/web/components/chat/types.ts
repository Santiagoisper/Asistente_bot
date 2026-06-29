export type AnswerConfidence = 'high' | 'medium' | 'low' | 'insufficient_evidence'

export type DocumentType =
  | 'protocol'
  | 'investigator_brochure'
  | 'lab_manual'
  | 'pharmacy_manual'
  | 'other'

export type Evidence = {
  chunkId: string
  documentId: string
  documentVersionId: string
  documentName?: string
  documentType?: string
  pageStart: number | null
  pageEnd: number | null
  sectionTitle: string | null
  excerpt: string
}

export type ChatResponse = {
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  answer: string
  confidence: AnswerConfidence
  evidences: Evidence[]
  retrievalCount: number
}

export type ConversationListItem = {
  conversationId: string
  studyId: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export type MessageItem = {
  messageId: string
  role: 'user' | 'assistant'
  content: string
  confidence: AnswerConfidence | null
  createdAt: string
}

export type CitationItem = Evidence & {
  citationId: string
  documentName: string
  documentType: string
}

export type CodingSystem = 'SNOMED-CT' | 'LOINC'

export type MedicalAnnotation = {
  term: string
  normalizedTerm: string
  system: CodingSystem
  code: string
  display: string
  startIndex: number
  endIndex: number
  fromDictionary: boolean
}

/** Código de terminología sugerido para una pregunta de codificación clínica. */
export type TerminologySuggestion = {
  term: string
  system: CodingSystem
  code: string
  display: string
  source: 'dictionary'
}

export type ChatTurn = {
  messageId: string
  role: 'user' | 'assistant'
  content: string
  confidence: AnswerConfidence | null
  evidences: Evidence[]
  retrievalCount?: number | null
  createdAt?: string
  annotations?: MedicalAnnotation[]
  /** Sugerencias de codificación (SNOMED-CT / LOINC) para preguntas de terminología. */
  terminologySuggestions?: TerminologySuggestion[]
  /** true si el protocolo aportó evidencia grounded sobre el concepto consultado. */
  protocolMentionsFound?: boolean
}
