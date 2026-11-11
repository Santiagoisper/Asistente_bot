import { ComingSoonPage } from '../../../components/os/module-pages'

export default function Page() {
  return (
    <ComingSoonPage
      title="Visitas"
      subtitle="La hoja de cada visita, armada para el paciente que tenés adelante."
      stage="Llega con la etapa de Cabina de visita."
      points={[
        'Qué preparar antes y qué hacer el día, en el orden que fija el protocolo.',
        'Solo los procedimientos que le corresponden a ese paciente según su rama y sus condiciones.',
        'Cada casilla con la cita de la página del protocolo de donde salió.',
        'Bloqueos, datos no definidos y dudas para el patrocinador, a la vista.',
      ]}
    />
  )
}
