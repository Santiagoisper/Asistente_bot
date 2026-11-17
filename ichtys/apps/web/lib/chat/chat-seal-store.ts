/**
 * Sellado del chat: lo que necesita de la base (`chat-seal.ts` decide y recorre).
 * `chatSealOverview` cuenta por organización, para el operador. `orgChatSealStore` trabaja
 * **dentro de una organización**: toda consulta la lleva, y una tanda nunca mezcla dos centros.
 *
 * La columna `annotations` ya no está en el schema (las anotaciones se dejaron de guardar),
 * así que se cuenta y se vacía con SQL crudo.
 */
import { and, conversations, db, eq, isNotNull, messages, patientProfiles, sql } from '@ichtys/db'
import { insertAuditLog } from '../audit/audited-write'
import { batchWrote, emptyBatch, planTextSeal, type ChatSealOverviewRow, type ChatSealStore } from './chat-seal'

const KEY_SAMPLES = 20
const hasAnnotations = sql`"messages"."annotations" IS NOT NULL`

/** Cantidades por organización. Sin contenido. */
export async function chatSealOverview(): Promise<ChatSealOverviewRow[]> {
  const byMessages = await db
    .select({
      organizationId: messages.organizationId,
      messages: sql<number>`count(*)::int`,
      plainMessages: sql<number>`(count(*) FILTER (WHERE ${messages.content} IS NOT NULL))::int`,
      annotations: sql<number>`(count(*) FILTER (WHERE ${hasAnnotations}))::int`,
    })
    .from(messages)
    .groupBy(messages.organizationId)
  const byTitles = await db
    .select({
      organizationId: conversations.organizationId,
      plainTitles: sql<number>`(count(*) FILTER (WHERE ${conversations.title} IS NOT NULL))::int`,
    })
    .from(conversations)
    .groupBy(conversations.organizationId)

  const rows = new Map<string, ChatSealOverviewRow>()
  const at = (organizationId: string): ChatSealOverviewRow => {
    let row = rows.get(organizationId)
    if (!row) {
      row = { organizationId, messages: 0, plainMessages: 0, plainTitles: 0, annotations: 0 }
      rows.set(organizationId, row)
    }
    return row
  }
  for (const org of byMessages) Object.assign(at(org.organizationId), { messages: org.messages, plainMessages: org.plainMessages, annotations: org.annotations })
  for (const org of byTitles) at(org.organizationId).plainTitles = org.plainTitles
  return [...rows.values()].sort((a, b) => a.organizationId.localeCompare(b.organizationId))
}

/**
 * Textos ya cifrados de la base: perfiles y mensajes que ya se guardaron cifrados. Solo para
 * comprobar que la clave de la aplicación los abre. No se devuelven a nadie.
 */
export async function chatSealKeySamples(): Promise<string[]> {
  const profiles = await db.select({ payload: patientProfiles.profileEncrypted }).from(patientProfiles).limit(KEY_SAMPLES)
  const sealed = await db.select({ payload: messages.contentEncrypted }).from(messages).where(isNotNull(messages.contentEncrypted)).limit(KEY_SAMPLES)
  return [...profiles, ...sealed].map((sample) => sample.payload).filter((payload): payload is string => typeof payload === 'string')
}

export function orgChatSealStore(orgId: string): ChatSealStore {
  const messageInOrg = eq(messages.organizationId, orgId)
  const conversationInOrg = eq(conversations.organizationId, orgId)

  return {
    sealBatch(limit, audit) {
      return db.transaction(async (tx) => {
        const count = emptyBatch()

        const messageRows = await tx
          .select({ id: messages.id, content: messages.content, contentEncrypted: messages.contentEncrypted, hasAnnotations: sql<boolean>`${hasAnnotations}` })
          .from(messages)
          .where(and(messageInOrg, sql`(${messages.content} IS NOT NULL OR ${hasAnnotations})`))
          .orderBy(messages.id)
          .limit(limit)
          .for('update', { skipLocked: true })

        for (const row of messageRows) {
          const here = and(eq(messages.id, row.id), messageInOrg)
          // Tira si lo cifrado no vuelve igual: la transacción se revierte y la tanda no queda.
          const plan = planTextSeal('message', { id: row.id, plain: row.content, encrypted: row.contentEncrypted })
          if (plan.action === 'blocked') {
            // No se toca el cuerpo ni las anotaciones: la fila queda entera para quien la revise.
            count.blocked += 1
            continue
          }
          if (plan.action === 'seal') {
            await tx.update(messages).set({ contentEncrypted: plan.encrypted, content: null }).where(here)
            count.messages += 1
          } else if (plan.action === 'clear_plain') {
            await tx.update(messages).set({ content: null }).where(here)
            count.messages += 1
          }
          if (row.hasAnnotations) {
            await tx.execute(sql`UPDATE "messages" SET "annotations" = NULL WHERE "id" = ${row.id} AND "organization_id" = ${orgId}`)
            count.annotationsCleared += 1
          }
        }

        const titleRows = await tx
          .select({ id: conversations.id, title: conversations.title, titleEncrypted: conversations.titleEncrypted })
          .from(conversations)
          .where(and(conversationInOrg, isNotNull(conversations.title)))
          .orderBy(conversations.id)
          .limit(limit)
          .for('update', { skipLocked: true })

        for (const row of titleRows) {
          const here = and(eq(conversations.id, row.id), conversationInOrg)
          const plan = planTextSeal('title', { id: row.id, plain: row.title, encrypted: row.titleEncrypted })
          if (plan.action === 'blocked') {
            count.blocked += 1
            continue
          }
          // `updatedAt` no se toca: sellar no es una edición de la conversación.
          if (plan.action === 'seal') await tx.update(conversations).set({ titleEncrypted: plan.encrypted, title: null }).where(here)
          else if (plan.action === 'clear_plain') await tx.update(conversations).set({ title: null }).where(here)
          else continue
          count.titles += 1
        }

        // Dato y registro en la misma transacción (R3).
        if (batchWrote(count) > 0) await insertAuditLog(tx, audit(count))
        return count
      })
    },
  }
}
