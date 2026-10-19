// ichtys/apps/web/app/(app)/protocolo/page.tsx
// Stub ALPHI 2.0 — datos sintéticos. Vestido con el design system consolidado.
export default function ProtocoloPage() {
  return (
    <main className="min-h-screen bg-alphi-slate p-6 md:p-10">
      <h1 className="text-2xl font-semibold text-alphi-navy">Protocolo inteligente</h1>
      <p className="mt-1 text-alphi-muted">Prototipo ALPHI 2.0 — datos sintéticos.</p>

      <div className="mt-6 max-w-2xl space-y-4">
        <section className="alphi-card p-5">
          <p className="alphi-label">Criterios de inclusión</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-alphi-navy">
            <li>Adultos 18–75 años (sintético)</li>
            <li>Diagnóstico confirmado &lt; 5 años (sintético)</li>
          </ul>
        </section>
        <section className="alphi-card p-5">
          <p className="alphi-label">Criterios de exclusión</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-alphi-navy">
            <li>Embarazo o lactancia (sintético)</li>
            <li>Tratamiento previo con el fármaco en estudio (sintético)</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
