import { eq } from 'drizzle-orm'
import { db } from './client'
import { organizations, type OrgRagConfig } from './schema/organizations'

// Defaults mirrored from @ichtys/rag to avoid circular dependency (db → rag → db).
const MIN_SIMILARITY_THRESHOLD = 0.15
const DEFAULT_TOP_K = 12
const MAX_TOP_K = 20

export type OrgLlmProvider = NonNullable<OrgRagConfig['llmProvider']>

/**
 * org-config.ts — per-org RAG configuration with system defaults.
 *
 * Allows tuning similarity threshold and topK per org without a redeploy.
 * Falls back to system defaults (MIN_SIMILARITY_THRESHOLD, DEFAULT_TOP_K)
 * when rag_config is null or a field is not set.
 *
 * Values are clamped to safe ranges to prevent misconfiguration:
 *   - threshold: [0.05, 0.95]
 *   - topK: [1, MAX_TOP_K]
 */

export interface ResolvedOrgRagConfig {
  similarityThreshold: number
  topK: number
  llmProvider: OrgLlmProvider
}

function normalizeLlmProvider(value: unknown): OrgLlmProvider {
  if (value === 'anthropic' || value === 'google' || value === 'auto') return value
  return 'auto'
}

export async function getOrgRagConfig(orgId: string): Promise<ResolvedOrgRagConfig> {
  const rows = await db
    .select({ ragConfig: organizations.ragConfig })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  const raw: OrgRagConfig | null | undefined = rows[0]?.ragConfig

  const threshold = typeof raw?.similarityThreshold === 'number'
    ? Math.min(0.95, Math.max(0.05, raw.similarityThreshold))
    : MIN_SIMILARITY_THRESHOLD

  const topK = typeof raw?.topK === 'number'
    ? Math.min(MAX_TOP_K, Math.max(1, Math.round(raw.topK)))
    : DEFAULT_TOP_K

  const llmProvider = normalizeLlmProvider(raw?.llmProvider)

  return { similarityThreshold: threshold, topK, llmProvider }
}

export async function updateOrgRagConfig(
  orgId: string,
  patch: Partial<OrgRagConfig>,
): Promise<ResolvedOrgRagConfig> {
  const current = await getOrgRagConfig(orgId)

  const next: OrgRagConfig = {
    similarityThreshold:
      typeof patch.similarityThreshold === 'number'
        ? Math.min(0.95, Math.max(0.05, patch.similarityThreshold))
        : current.similarityThreshold,
    topK:
      typeof patch.topK === 'number'
        ? Math.min(MAX_TOP_K, Math.max(1, Math.round(patch.topK)))
        : current.topK,
    llmProvider:
      patch.llmProvider !== undefined
        ? normalizeLlmProvider(patch.llmProvider)
        : current.llmProvider,
  }

  await db
    .update(organizations)
    .set({ ragConfig: next, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))

  return getOrgRagConfig(orgId)
}
