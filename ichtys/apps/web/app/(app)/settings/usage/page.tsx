import Link from 'next/link'
import { UsagePanel } from '../../../../components/usage/usage-panel'

export default function UsagePage() {
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-alphi-muted underline hover:text-alphi-navy">
          ← Ajustes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-alphi-navy">Consumo</h1>
        <p className="mt-1 text-sm text-alphi-muted">
          Cuánto consumió tu organización este mes y cuánto le queda del cupo de su plan.
        </p>
      </div>

      <UsagePanel />
    </section>
  )
}
