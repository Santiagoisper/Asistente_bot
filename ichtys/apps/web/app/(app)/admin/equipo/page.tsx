import { TeamAccessScreen } from '../../../../components/access/team-access-screen'
import { canManageOrgAccess } from '../../../../lib/access/permissions'
import { getOsContext } from '../../../../lib/os/context'

export default async function EquipoPage() {
  const ctx = await getOsContext()

  if (!ctx) {
    return (
      <section className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold text-alphi-navy">Equipo y accesos</h1>
        <p className="text-sm text-alphi-muted">No hay una organización activa en la sesión.</p>
      </section>
    )
  }

  // Mismas reglas que la API: por rol en modo `open`, por función en modo
  // estricto (M11 a M14). Quien no administra accesos no ve el equipo.
  if (!canManageOrgAccess(ctx.access)) {
    return (
      <section className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold text-alphi-navy">Equipo y accesos</h1>
        <p className="rounded-md border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-amber">
          No tenés permiso para administrar el equipo de la organización.
        </p>
      </section>
    )
  }

  return <TeamAccessScreen />
}
