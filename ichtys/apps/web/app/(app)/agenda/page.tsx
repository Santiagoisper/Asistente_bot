import { ComingSoonPage } from '../../../components/os/module-pages'

export default function Page() {
  return (
    <ComingSoonPage
      title="Agenda"
      subtitle="Las visitas del sitio, día por día."
      stage="Llega con la etapa de Agenda y Jornada de hoy."
      points={[
        'Visitas agendadas por sujeto, calculadas desde su fecha ancla y las ventanas del protocolo.',
        'La jornada de hoy con hora, sujeto, estudio, tipo de visita y estado.',
        'Aviso cuando una ventana está por cerrar.',
      ]}
    />
  )
}
