import { UnassignedAudiosPanel } from '../../../components/dictation/unassigned-audios-panel'

export const dynamic = 'force-dynamic'

/**
 * Las grabaciones que una persona hizo y que se retiraron de un sujeto porque la evolución se
 * registró ahí por error (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 3).
 * La lista la arma la ruta, que es la que decide qué le corresponde a quien mira.
 */
export default function GrabacionesSinSujetoPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-alphi-navy">Grabaciones sin sujeto</h1>
      <UnassignedAudiosPanel variant="page" />
    </div>
  )
}
