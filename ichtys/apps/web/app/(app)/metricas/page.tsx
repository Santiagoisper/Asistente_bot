import { ComingSoonPage } from '../../../components/os/module-pages'

export default function Page() {
  return (
    <ComingSoonPage
      title="Métricas"
      subtitle="Cómo viene el sitio a lo largo del tiempo."
      stage="Llega con la etapa de Métricas."
      points={[
        'Variación de cada indicador respecto del día anterior, con una foto diaria como respaldo.',
        'Cumplimiento de visitas y de ventanas por estudio.',
        'Tiempos de respuesta de queries y de revisión de laboratorios.',
      ]}
    />
  )
}
