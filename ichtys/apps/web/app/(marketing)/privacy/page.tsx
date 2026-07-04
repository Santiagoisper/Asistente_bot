import type { Metadata } from 'next'
import { MarketingShell } from '../../../components/marketing/marketing-shell'

export const metadata: Metadata = {
  title: 'Política de privacidad — Ichtys/ALPHI',
  description: 'Privacidad y tratamiento de datos Fase 0 del asistente documental Ichtys.',
}

export default function PrivacyPage() {
  return (
    <MarketingShell
      eyebrow="Legal · Fase 0"
      title="Política de privacidad"
      description="Versión pública simplificada — julio 2026. Sujeto a revisión legal y DPIA formal."
    >
      <article className="space-y-6 text-sm leading-relaxed text-alphi-navy/90">
        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">1. Responsable</h2>
          <p className="mt-3">
            Ichtys/ALPHI es operado por CINME / Innova Trials. Contacto:{' '}
            <a href="mailto:sisbert@cinme.com.ar" className="text-alphi-teal hover:underline">
              sisbert@cinme.com.ar
            </a>
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">2. Datos que procesamos</h2>
          <ul className="mt-3 list-inside list-disc space-y-2">
            <li>
              <strong>Usuarios del site:</strong> identidad vía Clerk (email, nombre) — no datos de
              pacientes en Fase 0 prod actual.
            </li>
            <li>
              <strong>Documentos de estudio:</strong> PDFs de protocolo/manuales en almacenamiento
              privado (Vercel Blob), aislados por organización y estudio.
            </li>
            <li>
              <strong>PHI clínica (futuro):</strong> evoluciones y perfiles cifrados AES-256-GCM
              at-rest cuando se habiliten gates Fase 1 — ver Trust Center.
            </li>
            <li>
              <strong>Audit logs:</strong> acciones de usuario para trazabilidad operacional.
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">3. Subprocesadores</h2>
          <p className="mt-3">
            Neon (PostgreSQL), Vercel (hosting/Blob), Clerk (auth), Anthropic/OpenAI (IA bajo
            políticas de retención acordadas), Upstash (rate limit). Detalle y estado DPA/BAA en el{' '}
            <a href="/trust" className="text-alphi-teal hover:underline">
              Trust Center
            </a>
            .
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">4. Retención</h2>
          <p className="mt-3">
            Los datos se conservan según contrato con el sponsor y política interna de retención.
            Purga disponible bajo solicitud del responsable del ensayo. Ver{' '}
            <code className="rounded bg-alphi-slate/50 px-1 text-xs">DATA-RETENTION-POLICY</code>{' '}
            (documento completo bajo NDA).
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">5. IA y pre-redacción</h2>
          <p className="mt-3">
            Antes de enviar texto a proveedores LLM, aplicamos pre-redacción de identificadores
            directos (DNI, email, teléfono). No afirmamos cifrado E2EE cuando hay procesamiento por
            terceros — ver gobernanza de IA en Trust Center.
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">6. Derechos y incidentes</h2>
          <p className="mt-3">
            Solicitudes de acceso, rectificación o eliminación: contacto arriba. Procedimiento de
            breach notification documentado internamente (72 h GDPR cuando aplique).
          </p>
        </section>

        <p className="text-xs text-alphi-muted">
          Fase 0: producción actual sin PHI real de pacientes. DPIA formal en revisión legal.
        </p>
      </article>
    </MarketingShell>
  )
}
