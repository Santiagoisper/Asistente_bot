import { UsagePanel } from '../../../components/usage/usage-panel'

export default function UsagePage() {
  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-alphi-navy">Consumo</h1>
        <p className="mt-1 text-sm text-alphi-muted">
          Cuánto lleva gastado tu organización este mes y qué le queda del cupo incluido.
        </p>
      </div>

      <UsagePanel />
    </section>
  )
}
