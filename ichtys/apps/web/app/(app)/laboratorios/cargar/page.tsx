import { notFound } from 'next/navigation'
import { LabUploadForm } from '../../../../components/labs/upload-form'
import { ButtonLink, Card, EmptyState, LoadError, PageHeader } from '../../../../components/os/ui'
import { isOsEnabled } from '../../../../lib/flags'
import { getOsContext } from '../../../../lib/os/context'
import { evidenceRetention } from '../../../../lib/labs/evidence-policy'
import { listActiveStudies, type StudyWithSubjects } from '../../../../lib/os/inicio-data'

export const dynamic = 'force-dynamic'

export default async function CargarLaboratorioPage() {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()
  const header = (
    <PageHeader
      title="Cargar estudio de laboratorio"
      subtitle="Subí el PDF del laboratorio y revisá los valores antes de confirmarlos."
      action={<ButtonLink href="/laboratorios">Volver a Laboratorios</ButtonLink>}
    />
  )

  if (!ctx?.canSeeSubjects) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {header}
        <EmptyState
          title={ctx ? 'Sin acceso' : 'Elegí una organización'}
          detail={ctx ? 'Tu rol no tiene acceso a datos de sujetos.' : 'Para cargar un estudio necesitás tener una organización activa.'}
        />
      </div>
    )
  }

  let studies: StudyWithSubjects[]
  try {
    studies = await listActiveStudies(ctx.orgId)
  } catch {
    console.error('[os/laboratorios/cargar] studies failed')
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {header}
        <LoadError what="la lista de estudios" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {header}
      <Card labelledBy="cargar-estudio" title="¿De quién es el estudio?" subtitle="Paso 1 de 2 · Subir">
        {studies.length === 0 ? (
          <EmptyState title="No hay estudios activos" detail="Creá un estudio y sus sujetos antes de cargar laboratorios." action={<ButtonLink href="/studies" variant="solid">Ir a Protocolos</ButtonLink>} />
        ) : (
          <LabUploadForm studies={studies} evidenceKept={evidenceRetention() === 'keep'} />
        )}
      </Card>
    </div>
  )
}
