import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingShell, DEMO_MAILTO } from '../../../components/marketing/marketing-shell'

export const metadata: Metadata = {
  title: 'Precios — Ichtys/ALPHI',
  description: 'Modelo comercial para asistente documental clínico en ensayos regulados.',
}

interface PricingTier {
  name: string
  audience: string
  price: string
  features: string[]
  note: string
  highlighted?: boolean
}

const TIERS: PricingTier[] = [
  {
    name: 'Pilot',
    audience: '1 estudio, hasta 10 documentos',
    price: 'Contactar',
    features: [
      'Chat RAG con citas obligatorias',
      'Extracción de study spec',
      'Screening orientativo (determinista)',
      'Onboarding asistido',
    ],
    note: 'Ideal para evaluación en sitio único antes de escalar.',
  },
  {
    name: 'Site / Red',
    audience: 'Por sitio activo o red de sitios',
    price: 'Contactar',
    features: [
      'Multi-estudio por organización',
      'Config RAG por org',
      'Audit log y aislamiento tenant',
      'Soporte operacional',
    ],
    note: 'Pricing negociado por contrato — no self-serve en v1.',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    audience: 'Sponsor / CRO',
    price: 'Custom',
    features: [
      'DPA/BAA con subprocesadores',
      'Trust center y políticas bajo NDA',
      'Roadmap CSV / validación formal',
      'SLA y despliegue dedicado',
    ],
    note: 'Incluye acompañamiento compliance pre-PHI.',
  },
] 

export default function PricingPage() {
  return (
    <MarketingShell
      eyebrow="Comercial"
      title="Precios"
      description="Modelo B2B para trial-ops regulado. Precios indicativos sujetos a contrato — no checkout self-serve en esta fase del producto."
    >
      <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-alphi-navy/90">
        <strong>Estado honesto:</strong> MVP pre-validación, pre-revenue. Billing automatizado (Stripe)
        planificado post go-live con PHI. Hoy el acceso es por acuerdo comercial.
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
          <section
            key={tier.name}
            className={`rounded-lg border bg-white p-6 ${
              tier.highlighted ? 'border-alphi-teal shadow-alphi-panel' : 'border-alphi-border'
            }`}
          >
            <h2 className="text-lg font-bold text-alphi-navy">{tier.name}</h2>
            <p className="mt-1 text-xs text-alphi-muted">{tier.audience}</p>
            <p className="mt-4 text-2xl font-bold text-alphi-teal">{tier.price}</p>
            <ul className="mt-4 space-y-2 text-sm text-alphi-navy/90">
              {tier.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-alphi-teal">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-alphi-muted">{tier.note}</p>
          </section>
        ))}
      </div>

      <section className="mt-10 rounded-lg border border-alphi-border bg-white p-6">
        <h2 className="text-lg font-bold text-alphi-navy">Unidad de valor</h2>
        <p className="mt-3 text-sm leading-relaxed text-alphi-navy/90">
          Cobramos por <strong>estudio activo</strong> o <strong>sitio en red</strong>, no por usuario
          individual. El coordinador accede con credenciales provistas por el sponsor — el buyer es
          sponsor, CRO o red de sitios.
        </p>
        <p className="mt-3 text-sm text-alphi-muted">
          Referencia de mercado general (no pricing ALPHI): herramientas self-serve de documentación
          clínica pueden cobrar por uso; nosotros priorizamos contratos regulados con trazabilidad.
        </p>
        <Link
          href={DEMO_MAILTO}
          className="mt-6 inline-block rounded-md bg-alphi-navy px-4 py-2 text-sm font-semibold text-white hover:bg-alphi-navydim"
        >
          Solicitar demo o cotización
        </Link>
      </section>
    </MarketingShell>
  )
}
