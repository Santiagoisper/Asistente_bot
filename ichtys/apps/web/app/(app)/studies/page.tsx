export default function StudiesPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Estudios</h1>
      <p className="text-gray-600">
        Lista de estudios de la organización activa. El acceso se filtra
        server-side por <code>organization_id</code>.
      </p>
      {/* TODO(paso-9): listar studies de la org activa (Server Component + @ichtys/db). */}
    </section>
  )
}
