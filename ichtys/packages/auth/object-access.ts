import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import {
  db,
  documentVersions,
  documents,
  messages,
  organizations,
  pages,
  studies,
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
