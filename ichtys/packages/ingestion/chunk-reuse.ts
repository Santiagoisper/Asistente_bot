import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { auditLogs, chunks, db } from '@ichtys/db'
import { getEmbeddingFingerprint } from './embedding-config'

/**
 * chunk-reuse.ts - permite que un reintento de la ingesta retome lo ya embebido.
 *
 * Sin esto, cada reintento borra y recrea todos los fragmentos y vuelve a pagar
 * (y a esperar) todos los embeddings. Solo se reutiliza si es seguro:
 *   1. Los fragmentos nuevos son exactamente los ya guardados (misma página y contenido).
 *   2. Hay al menos uno ya embebido (si no, no hay nada que aprovechar).
 *   3. El modelo de embeddings es el mismo que el de la corrida anterior: vectores de
 *      distinto proveedor/modelo no son comparables y mezclarlos degrada la búsqueda.
 */

export interface ChunkReuseContext {
  orgId: string
  studyId: string
  documentId: string
  documentVersionId: string
}

export interface ChunkIdentity {
  pageStart: number
  pageEnd: number
  content: string
}

function identityKey(chunk: ChunkIdentity): string {
  const digest = createHash('sha1').update(chunk.content).digest('hex')
  return `${chunk.pageStart}|${chunk.pageEnd}|${digest}`
}

function sameChunkSet(existing: readonly ChunkIdentity[], incoming: readonly ChunkIdentity[]): boolean {
  if (existing.length !== incoming.length) return false

  const remaining = new Map<string, number>()
  for (const chunk of incoming) {
    const key = identityKey(chunk)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  for (const chunk of existing) {
    const key = identityKey(chunk)
    const count = remaining.get(key)
    if (!count) return false
    remaining.set(key, count - 1)
  }
  return true
}

async function lastEmbeddingFingerprint(ctx: ChunkReuseContext): Promise<string | null> {
  const [last] = await db
    .select({ metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, ctx.orgId),
        eq(auditLogs.studyId, ctx.studyId),
        eq(auditLogs.action, 'embeddings.started'),
        eq(auditLogs.resourceId, ctx.documentVersionId),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)

  const metadata = last?.metadata
  if (typeof metadata !== 'object' || metadata === null) return null
  const fingerprint = (metadata as Record<string, unknown>).embeddingFingerprint
  return typeof fingerprint === 'string' ? fingerprint : null
}

export async function canReuseEmbeddedChunks(
  ctx: ChunkReuseContext,
  incoming: readonly ChunkIdentity[],
): Promise<boolean> {
  if (incoming.length === 0) return false

  const existing = await db
    .select({
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      content: chunks.content,
      embedded: sql<boolean>`${chunks.embedding} is not null`,
    })
    .from(chunks)
    .where(
      and(
        eq(chunks.documentVersionId, ctx.documentVersionId),
        eq(chunks.documentId, ctx.documentId),
        eq(chunks.organizationId, ctx.orgId),
        eq(chunks.studyId, ctx.studyId),
      ),
    )

  if (!existing.some((row) => row.embedded)) return false
  if (!sameChunkSet(existing, incoming)) return false

  const previous = await lastEmbeddingFingerprint(ctx)
  return previous !== null && previous === getEmbeddingFingerprint()
}
