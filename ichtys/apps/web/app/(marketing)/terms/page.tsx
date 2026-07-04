import type { Metadata } from 'next'
import { MarketingShell } from '../../../components/marketing/marketing-shell'

export const metadata: Metadata = {
  title: 'Términos de servicio — Ichtys/ALPHI',
  description: 'Términos de uso públicos Fase 0 del asistente documental Ichtys.',
}

export default function TermsPage() {
  return (
    <MarketingShell
      eyebrow="Legal · Fase 0"
      title="Términos de servicio"
      description="Versión pública simplificada — julio 2026. Sujeto a revisión legal antes de procesamiento de PHI real."
    >
      <article className="prose-alphi space-y-6 text-sm leading-relaxed text-alphi-navy/90">
        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">1. Naturaleza del servicio</h2>
          <p className="mt-3">
            Ichtys/ALPHI es un <strong>asistente documental clínico</strong> para equipos de sitio
            durante ensayos clínicos. Responde preguntas operacionales sobre documentos de estudio
            (protocolo, IB, manuales) con citas a la fuente.{' '}
            <strong>No reemplaza el juicio clínico</strong> del investigador ni constituye asesoramiento
            médico.
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">2. Estado del producto</h2>
          <p className="mt-3">
            El producto se encuentra en <strong>MVP pre-validación (Fase 0)</strong>. No está certificado
            bajo FDA 21 CFR Part 11 ni validado formalmente bajo CSV/GAMP 5 en producción. La
            validación formal está planificada como parte del roadmap post-inversión.
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">3. Grounding-only</h2>
          <p className="mt-3">
            Las respuestas se generan únicamente a partir de documentos cargados en el estudio activo.
            Si no hay evidencia suficiente, el sistema indica{' '}
            <em>evidencia insuficiente</em> — no inventa contenido clínico.
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">4. Uso autorizado</h2>
          <p className="mt-3">
            El acceso requiere cuenta y organización autorizada. El cliente es responsable de no cargar
            PHI real hasta completar los gates de compliance acordados (DPA/BAA, DPIA, claves de
            cifrado, etc.).
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">5. Limitación de responsabilidad</h2>
          <p className="mt-3">
            En Fase 0 el servicio se provee &quot;tal cual&quot; para evaluación y pilotos acordados.
            Las decisiones de elegibilidad, manejo de AE/SAE y cumplimiento protocolar son
            responsabilidad del equipo clínico y del sponsor.
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">6. Contacto</h2>
          <p className="mt-3">
            Consultas legales o comerciales:{' '}
            <a href="mailto:sisbert@cinme.com.ar" className="text-alphi-teal hover:underline">
              sisbert@cinme.com.ar
            </a>
          </p>
        </section>

        <p className="text-xs text-alphi-muted">
          Documento derivado de políticas internas en <code>docs/compliance/</code>. Versión completa
          disponible bajo NDA para sponsors enterprise.
        </p>
      </article>
    </MarketingShell>
  )
}
