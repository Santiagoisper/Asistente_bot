import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingShell } from '../../components/marketing/marketing-shell'
import { aiDataFlows, flowChoiceNote, SELECTABLE_PROVIDER_NAMES } from '../../lib/trust/ai-data-flows'

export const metadata: Metadata = {
  title: 'Trust Center — Ichtys/ALPHI',
  description: 'Procesadores de datos, cifrado y cumplimiento del asistente documental clínico Ichtys.',
}

const SUBPROCESSORS = [
  {
    name: 'Neon',
    service: 'PostgreSQL (datos de aplicación)',
    region: 'US/EU (confirmar proyecto)',
    phi: 'Metadatos de estudio, perfiles cifrados, audit logs',
    baa: 'DPA pendiente',
  },
  {
    name: 'Vercel',
    service: 'Hosting, Blob storage',
    region: 'Global (edge + US)',
    phi: 'PDFs de protocolo (privados), tráfico TLS',
    baa: 'DPA disponible',
  },
  {
    name: 'Clerk',
    service: 'Autenticación y organizaciones',
    region: 'US',
    phi: 'Identidad de usuarios del site (no pacientes)',
    baa: 'N/A (no procesa PHI clínica)',
  },
  {
    name: 'Anthropic',
    service: 'Modelos de lenguaje',
    region: 'US',
    phi: 'Ver «Qué proveedor de IA recibe qué dato», más abajo',
    baa: 'Acuerdo pendiente de firma',
  },
  {
    name: 'OpenAI',
    service: 'Vectores de búsqueda de los documentos',
    region: 'US',
    phi: 'Ver «Qué proveedor de IA recibe qué dato», más abajo',
    baa: 'Acuerdo pendiente de firma',
  },
  {
    name: 'Upstash',
    service: 'Rate limiting Redis',
    region: 'EU/US',
    phi: 'Solo metadata — sin contenido clínico',
    baa: 'N/A',
  },
] as const

const POLICY_INDEX = [
  {
    title: 'Clasificación de datos',
    bullets: ['Niveles D1–D7', 'PHI vs metadatos vs mock', 'Controles por clase'],
  },
  {
    title: 'Manejo de PHI',
    bullets: ['AES-256-GCM at-rest', 'Pre-redacción antes de LLM', 'Sin PHI real en prod Fase 0'],
  },
  {
    title: 'Control de acceso',
    bullets: ['RBAC por org/study', 'Clerk Organizations', 'Audit log de acciones'],
  },
  {
    title: 'Retención y purga',
    bullets: ['Política por contrato sponsor', 'Purga bajo solicitud', 'Backups Neon PITR'],
  },
  {
    title: 'Gobernanza de IA',
    bullets: ['Grounding-only', 'Screening determinista post-LLM', 'Sin decision support generativo'],
  },
  {
    title: 'CSV / Validación',
    bullets: ['Plan GAMP 5 definido', 'Validación formal en progreso', 'No certificado Part 11 hoy'],
  },
  {
    title: 'ISMS / Seguridad',
    bullets: ['Framework ISO 27001 lite', 'Breach notification 72h GDPR', 'RPO ≤24h / RTO ≤4h'],
  },
] as const

export default function TrustPage() {
  return (
    <MarketingShell
      eyebrow="Compliance"
      title="Trust Center"
      description="Transparencia para equipos de calidad, monitores y compradores enterprise. Ichtys es el asistente del site durante el ensayo — no epicrisis de consultorio ni matching externo."
    >
      <section className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-sm font-bold text-alphi-navy">Estado de validación (honesto)</h2>
        <ul className="mt-3 space-y-2 text-sm text-alphi-navy/90">
          <li>
            <strong>Fase 0 (actual):</strong> MVP pre-validación · 13 políticas documentadas ·
            implementación técnica (cifrado, audit, tenant isolation) ·{' '}
            <strong>sin PHI real en producción</strong>.
          </li>
          <li>
            <strong>CSV / Part 11:</strong> marco definido (URS→RTM, IQ/OQ/PQ planificado) ·{' '}
            <strong>validación formal no completada</strong> · no presentar como certificado.
          </li>
          <li>
            <strong>DPAs/BAAs:</strong> tracker activo · acuerdos con subprocesadores{' '}
            <strong>pendientes de firma</strong> pre go-live PHI.
          </li>
        </ul>
      </section>

      <section className="mb-8 rounded-lg border border-alphi-border bg-white p-6">
        <h2 className="text-lg font-bold text-alphi-navy">Cifrado y manejo de PHI</h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-alphi-navy/90">
          <li>
            <strong>Evoluciones y perfiles:</strong> cifrado field-level <strong>AES-256-GCM</strong>{' '}
            at-rest con clave <code className="rounded bg-alphi-slate/50 px-1">PHI_ENCRYPTION_KEY</code>.
          </li>
          <li>
            <strong>En tránsito:</strong> TLS 1.2+ entre cliente, Vercel y proveedores.
          </li>
          <li>
            <strong>Antes de enviar una evolución a un modelo:</strong> se reemplazan algunos
            formatos de documento, correo y teléfono. No se garantiza que se quite todo dato
            personal. <strong>Los nombres propios no se quitan.</strong>
          </li>
          <li>
            <strong>Dictado:</strong> la transcripción corre en el navegador de quien dicta; el audio
            no va a ningún proveedor de IA.
          </li>
          <li>
            <strong>Importante:</strong> no ofrecemos E2EE cuando hay procesamiento por proveedores
            de IA — formulación criptográfica precisa.
          </li>
        </ul>
      </section>

      <section className="mb-8 rounded-lg border border-alphi-border bg-white p-6">
        <h2 className="text-lg font-bold text-alphi-navy">Marcos alineados (no certificados)</h2>
        <p className="mt-2 text-sm text-alphi-muted">
          Framework documental alineado a: FDA 21 CFR Part 11, EMA Annex 11, ICH E6 GCP, GDPR, HIPAA,
          ISO 27001/27701 lite. <strong>Alineación ≠ certificación formal.</strong>
        </p>
      </section>

      <section className="mb-8 rounded-lg border border-alphi-border bg-white p-6">
        <h2 className="text-lg font-bold text-alphi-navy">Índice de políticas</h2>
        <p className="mt-2 text-xs text-alphi-muted">
          Extractos públicos. Documentos completos disponibles bajo NDA para due diligence.
        </p>
        <ul className="mt-4 space-y-4">
          {POLICY_INDEX.map((p) => (
            <li key={p.title} className="border-b border-alphi-border/60 pb-3 last:border-0">
              <p className="font-semibold text-alphi-navy">{p.title}</p>
              <ul className="mt-1 list-inside list-disc text-sm text-alphi-navy/80">
                {p.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8 rounded-lg border border-alphi-border bg-white p-6">
        <h2 className="text-lg font-bold text-alphi-navy">Subprocesadores</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-alphi-border text-alphi-muted">
                <th className="py-2 pr-3 font-semibold">Proveedor</th>
                <th className="py-2 pr-3 font-semibold">Servicio</th>
                <th className="py-2 pr-3 font-semibold">Región</th>
                <th className="py-2 font-semibold">PHI / BAA</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((row) => (
                <tr key={row.name} className="border-b border-alphi-border/60 align-top">
                  <td className="py-3 pr-3 font-medium text-alphi-navy">{row.name}</td>
                  <td className="py-3 pr-3 text-alphi-navy/80">{row.service}</td>
                  <td className="py-3 pr-3 text-alphi-muted">{row.region}</td>
                  <td className="py-3 text-alphi-navy/80">
                    {row.phi}
                    <br />
                    <span className="text-alphi-muted">{row.baa}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-alphi-border bg-white p-6" data-testid="flujos-de-ia">
        <h2 className="text-lg font-bold text-alphi-navy">Qué proveedor de IA recibe qué dato</h2>
        <p className="mt-2 text-xs text-alphi-muted">
          Esta tabla sale de la misma configuración que decide el destino en el sistema. Si un
          proveedor no responde, la función falla: el dato no se envía a otro.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-alphi-border text-alphi-muted">
                <th className="py-2 pr-3 font-semibold">Para qué</th>
                <th className="py-2 pr-3 font-semibold">Qué se envía</th>
                <th className="py-2 font-semibold">A quién</th>
              </tr>
            </thead>
            <tbody>
              {aiDataFlows().map((flow) => (
                <tr key={flow.purpose} className="border-b border-alphi-border/60 align-top">
                  <td className="py-3 pr-3 font-medium text-alphi-navy">{flow.use}</td>
                  <td className="py-3 pr-3 text-alphi-navy/80">{flow.data}</td>
                  <td className="py-3 text-alphi-navy/80">
                    {flow.providers.join(', ')}
                    <br />
                    <span className="text-alphi-muted">{flowChoiceNote(flow)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-alphi-muted">
          Proveedores que una organización puede elegir en Ajustes para el asistente:{' '}
          {SELECTABLE_PROVIDER_NAMES.join(', ')}. Lo que una persona escribe en el asistente puede
          incluir datos de un paciente: va al proveedor de ese uso tal como se escribió.
        </p>
      </section>

      <section className="mb-8 rounded-lg border border-alphi-border bg-white p-6">
        <h2 className="text-lg font-bold text-alphi-navy">Gobernanza de IA</h2>
        <p className="mt-3 text-sm leading-relaxed text-alphi-navy/90">
          La IA <strong>extrae</strong> datos estructurados del texto libre; las{' '}
          <strong>reglas deterministas</strong> evalúan elegibilidad contra el study spec aprobado. El
          LLM no decide inclusión/exclusión final — el investigador sí. Sin evidencia → sin respuesta.
        </p>
      </section>

      <section className="rounded-lg border border-alphi-border bg-white p-6 text-sm">
        <h2 className="text-lg font-bold text-alphi-navy">Contacto compliance</h2>
        <p className="mt-3 text-alphi-navy/90">
          Due diligence y pack completo de políticas:{' '}
          <a href="mailto:sisbert@cinme.com.ar" className="text-alphi-teal hover:underline">
            sisbert@cinme.com.ar
          </a>
        </p>
        <p className="mt-4 text-xs text-alphi-muted">
          Última actualización: noviembre 2026 (la tabla de proveedores de IA) · Ver también{' '}
          <Link href="/privacy" className="text-alphi-teal hover:underline">
            Privacidad
          </Link>{' '}
          y{' '}
          <Link href="/terms" className="text-alphi-teal hover:underline">
            Términos
          </Link>
        </p>
      </section>
    </MarketingShell>
  )
}
