import { isProviderConfigured, type LlmProviderId } from '@ichtys/llm'
import type { OrgLlmKeyProvider, OrgLlmApiKeys } from '@ichtys/db'

/**
 * Guard de Ajustes: no dejar elegir un proveedor sin clave disponible.
 *
 * El 19/10 una org quedó con llmProvider="glm" y sin clave utilizable de GLM:
 * con la regla de cadena de 1, el chat respondía vacío (E2E 2026-10-22).
 * La validación corre en el PATCH del server — el cliente solo deshabilita
 * la opción, pero es salteable.
 */

/** Claves vigentes de la org + las que vienen en el mismo PATCH. */
export function mergeOrgKeys(
  current: OrgLlmApiKeys,
  patch: Partial<Record<string, string | null | undefined>> | undefined,
): OrgLlmApiKeys {
  const merged: OrgLlmApiKeys = { ...current }
  if (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k as OrgLlmKeyProvider]
      else if (typeof v === 'string') merged[k as OrgLlmKeyProvider] = v
    }
  }
  return merged
}

/** ¿El proveedor elegido tendrá al menos una clave (org o plataforma)? */
export function isProviderChoiceSupported(provider: string, keys: OrgLlmApiKeys): boolean {
  if (provider === 'auto') return true
  return isProviderConfigured(provider as LlmProviderId, keys)
}
