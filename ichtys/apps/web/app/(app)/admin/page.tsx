export default function AdminPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Administración</h1>
      <p className="text-gray-600">
        Gestión de organización, estudios, documentos y usuarios. Restringido a
        roles <code>org_admin</code> / <code>study_admin</code>.
      </p>
      {/* TODO(paso-9): guard de rol + gestión de org/studies/users + audit dashboard. */}
    </section>
  )
}
