import type { Metadata } from 'next'
import Link from 'next/link'

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
    service: 'Inferencia LLM (extracción clínica, chat)',
    region: 'US',
    phi: 'Texto pre-redactado en tránsito — sin retención en prompts',
    baa: 'BAA enterprise / zero-retention API',
  },
  {
    name: 'OpenAI',
    service: 'Embeddings RAG',
    region: 'US',
    phi: 'Chunks de protocolo (sin evoluciones clínicas)',
    baa: 'BAA API disponible',
  },
  {
    name: 'Upstash',
    service: 'Rate limiting Redis',
    region: 'EU/US',
    phi: 'Solo metadata — sin contenido clínico',
    baa: 'N/A',
  },
] as const

export default function TrustPage() {
  return (
    <main className="min-h-screen bg-alphi-slate/30">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-alphi-teal">Ichtys / ALPHI</p>
          <h1 className="mt-2 text-3xl font-bold text-alphi-navy">Trust Center</h1>
          <p className="mt-3 text-sm leading-relaxed text-alphi-muted">
            Transparencia para equipos de calidad, monitores y compradores enterprise. Ichtys es el asistente
            del site <strong>durante el ensayo</strong> — no reemplaza la epicrisis del consultorio ni busca
            ensayos externos.
          </p>
        </header>

        <section className="mb-10 rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">Cifrado y manejo de PHI</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-alphi-navy/90">
            <li>
              <strong>Evoluciones y perfiles de sujeto:</strong> cifrado field-level{' '}
              <strong>AES-256-GCM</strong> at-rest con clave <code>PHI_ENCRYPTION_KEY</code> controlada por el
              operador.
            </li>
            <li>
              <strong>En tránsito:</strong> TLS 1.2+ entre cliente, Vercel y proveedores.
            </li>
            <li>
              <strong>Antes de terceros LLM:</strong> pre-redacción de DNI, email y teléfono; no persistimos
              prompts con contenido clínico.
            </li>
            <li>
              <strong>Importante:</strong> Ichtys <em>no</em> ofrece cifrado de extremo a extremo (E2EE) cuando
              hay procesamiento por proveedores de IA — formulamos esto con precisión criptográfica.
            </li>
          </ul>
        </section>

        <section className="mb-10 rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">Subprocesadores</h2>
          <p className="mt-2 text-xs text-alphi-muted">
            Estado DPA/BAA interno: ver{' '}
            <code className="rounded bg-alphi-slate/50 px-1">docs/compliance/DPA-BAA-TRACKER.md</code> en el
            repositorio del sponsor.
          </p>
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

        <section className="mb-10 rounded-lg border border-alphi-border bg-white p-6">
          <h2 className="text-lg font-bold text-alphi-navy">Gobernanza de IA</h2>
          <p className="mt-3 text-sm leading-relaxed text-alphi-navy/90">
            La IA <strong>extrae</strong> datos estructurados del texto libre; las{' '}
            <strong>reglas deterministas</strong> evalúan elegibilidad contra el study spec aprobado. El LLM no
            decide inclusión/exclusión final — el investigador sí.
          </p>
        </section>

        <footer className="text-center text-xs text-alphi-muted">
          <Link href="/sign-in" className="font-semibold text-alphi-teal hover:underline">
            Acceder a la aplicación
          </Link>
          <p className="mt-4">Última actualización: julio 2026 · Ichtys/ALPHI</p>
        </footer>
      </div>
    </main>
  )
}
