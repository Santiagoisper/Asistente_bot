import { auth } from '@clerk/nextjs/server'
import { OrgLlmSettingsForm } from '../../../components/settings/org-llm-settings-form'

function normalizeRole(orgRole: string | null | undefined): string {
  if (!orgRole) return 'read_only_monitor'
  const stripped = orgRole.replace(/^org:/, '')
  if (stripped === 'admin') return 'org_admin'
  return stripped
}

export default async function SettingsPage() {
  const { orgRole } = await auth()
  const role = normalizeRole(orgRole)
  const canEdit = role === 'org_admin' || role === 'study_admin'

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-alphi-navy">Ajustes</h1>
        <p className="mt-1 text-sm text-alphi-muted">
          Configuración de la organización activa en Clerk.
        </p>
      </div>

      {!canEdit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Solo <code>org_admin</code> o <code>study_admin</code> pueden cambiar el proveedor de IA.
          Podés ver el estado actual pero no guardar cambios.
        </p>
      ) : null}

      <OrgLlmSettingsForm canEdit={canEdit} />
    </section>
  )
}
