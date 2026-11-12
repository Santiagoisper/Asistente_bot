import { OrgLlmSettingsForm } from '../../../components/settings/org-llm-settings-form'
import { getOsContext } from '../../../lib/os/context'
import { canChangeOrgSettings } from '../../../lib/settings/permissions'

export default async function SettingsPage() {
  // La misma decisión que toma la ruta al guardar (lib/settings/permissions):
  // por rol en modo `open`, por función en modo estricto.
  const ctx = await getOsContext()
  const canEdit = ctx ? canChangeOrgSettings(ctx.access) : false

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-alphi-navy">Ajustes</h1>
        <p className="mt-1 text-sm text-alphi-muted">
          Configuración de la organización activa en Clerk.
        </p>
      </div>

      {!canEdit ? (
        <p className="rounded-lg border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-amber">
          No tenés permiso para cambiar el proveedor de IA. Podés ver el estado actual pero no
          guardar cambios.
        </p>
      ) : null}

      <OrgLlmSettingsForm canEdit={canEdit} />
    </section>
  )
}
