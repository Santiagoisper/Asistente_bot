import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import {
  db,
  conversations,
  documentVersions,
  documents,
  messages,
  organizations,
  pages,
  studies,
  type Conversation,
  type Document,
  type DocumentVersion,
  type Message,
  type Page,
  type Study,
} from '@ichtys/db'
import { AccessError } from './validate-study-access'

interface ActiveOrganizationContext {
  userId: string
  orgId: string
}

export interface DocumentAccessContext extends ActiveOrganizationContext {
  studyId: string
  document: Document
  study: Study
}

export interface MessageAccessContext extends ActiveOrganizationContext {
  studyId: string
  message: Message
  study: Study
}

export interface DocumentPageAccessContext extends DocumentAccessContext {
  documentVersion: DocumentVersion
  page: Page
}

export interface DocumentVersionAccessContext extends DocumentAccessContext {
  documentVersion: DocumentVersion
}

export interface ConversationAccessContext extends ActiveOrganizationContext {
  studyId: string
  conversation: Conversation
  study: Study
}

async function resolveActiveOrganization(): Promise<ActiveOrganizationContext> {
  const { userId, orgId: clerkOrgId } = await auth()

  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })

  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  return { userId, orgId: org.id }
}

async function validateStudyBelongsToOrg(studyId: string, orgId: string): Promise<Study> {
  const study = await db.query.studies.findFirst({
    where: and(eq(studies.id, studyId), eq(studies.organizationId, orgId)),
  })

  if (!study) {
    throw new AccessError('Study not found or access denied', 404)
  }

  return study
}

/**
 * Validates that the active user owns the conversation within their active org.
 * Chain: conversationId → organizationId + userId → studyId.
 */
export async function validateConversationAccess(
  conversationId: string,
): Promise<ConversationAccessContext> {
  const { userId, orgId } = await resolveActiveOrganization()

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, conversationId),
      eq(conversations.organizationId, orgId),
      eq(conversations.userId, userId),
    ),
  })

  if (!conversation) {
    throw new AccessError('Conversation not found or access denied', 404)
  }

  const study = await validateStudyBelongsToOrg(conversation.studyId, orgId)

  return { userId, orgId, studyId: study.id, conversation, study }
}

export async function validateDocumentAccess(documentId: string): Promise<DocumentAccessContext> {
  const { userId, orgId } = await resolveActiveOrganization()

  const document = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.organizationId, orgId)),
  })

  if (!document) {
    throw new AccessError('Document not found or access denied', 404)
  }

  const study = await validateStudyBelongsToOrg(document.studyId, orgId)

  return { userId, orgId, studyId: study.id, document, study }
}

export async function validateDocumentVersionAccess(
  documentVersionId: string,
): Promise<DocumentVersionAccessContext> {
  const { userId, orgId } = await resolveActiveOrganization()

  const documentVersion = await db.query.documentVersions.findFirst({
    where: and(eq(documentVersions.id, documentVersionId), eq(documentVersions.organizationId, orgId)),
  })

  if (!documentVersion) {
    throw new AccessError('Document version not found or access denied', 404)
  }

  const document = await db.query.documents.findFirst({
    where: and(
      eq(documents.id, documentVersion.documentId),
      eq(documents.organizationId, orgId),
      eq(documents.studyId, documentVersion.studyId),
    ),
  })

  if (!document) {
    throw new AccessError('Document not found or access denied', 404)
  }

  const study = await validateStudyBelongsToOrg(documentVersion.studyId, orgId)

  return { userId, orgId, studyId: study.id, document, documentVersion, study }
}

export async function validateMessageAccess(messageId: string): Promise<MessageAccessContext> {
  const { userId, orgId } = await resolveActiveOrganization()

  const message = await db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.organizationId, orgId)),
  })

  if (!message) {
    throw new AccessError('Message not found or access denied', 404)
  }

  const study = await validateStudyBelongsToOrg(message.studyId, orgId)

  return { userId, orgId, studyId: study.id, message, study }
}

export async function validateDocumentPageAccess(
  documentId: string,
  pageNumber: number,
): Promise<DocumentPageAccessContext> {
  const documentContext = await validateDocumentAccess(documentId)

  const documentVersion = await db.query.documentVersions.findFirst({
    where: and(
      eq(documentVersions.documentId, documentId),
      eq(documentVersions.organizationId, documentContext.orgId),
      eq(documentVersions.studyId, documentContext.studyId),
    ),
  })

  if (!documentVersion) {
    throw new AccessError('Document version not found or access denied', 404)
  }

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.documentVersionId, documentVersion.id),
      eq(pages.organizationId, documentContext.orgId),
      eq(pages.studyId, documentContext.studyId),
      eq(pages.pageNumber, pageNumber),
    ),
  })

  if (!page) {
    throw new AccessError('Page not found or access denied', 404)
  }

  return { ...documentContext, documentVersion, page }
}
