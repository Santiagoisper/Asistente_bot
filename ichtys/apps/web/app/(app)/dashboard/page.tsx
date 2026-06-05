import Link from 'next/link'

export default function DashboardPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-gray-600">
        Seleccioná un estudio para empezar a consultar sus documentos.
      </p>
      <Link href="/studies" className="text-blue-600 underline">
        Ver estudios →
      </Link>
      {/* TODO(paso-9): resumen de actividad reciente y estudios del usuario. */}
    </section>
  )
}
