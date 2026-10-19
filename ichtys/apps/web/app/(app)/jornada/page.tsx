// ichtys/apps/web/app/(app)/jornada/page.tsx
// Stub ALPHI 2.0 — datos sintéticos. Vestido con el design system consolidado.
export default function JornadaPage() {
  return (
    <main className="min-h-screen bg-alphi-slate p-6 md:p-10">
      <h1 className="text-2xl font-semibold text-alphi-navy">Mi jornada</h1>
      <p className="mt-1 text-alphi-muted">Prototipo ALPHI 2.0 — datos sintéticos.</p>

      <div className="mt-6 max-w-2xl space-y-3">
        <section className="alphi-card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-alphi-navy">Visita Día 21 — Sujeto S-001</p>
            <p className="text-xs text-alphi-muted">Ventana 20–24 oct · Estudio ALPHA-X (sintético)</p>
          </div>
          <span className="alphi-pill border-alphi-teal/30 bg-alphi-violet-soft text-alphi-teal">En ventana</span>
        </section>
        <section className="alphi-card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-alphi-navy">Revisión de CRF — Sujeto S-014</p>
            <p className="text-xs text-alphi-muted">3 queries abiertas (sintético)</p>
          </div>
          <span className="alphi-pill border-alphi-amber/30 bg-alphi-amber-soft text-alphi-amber">Pendiente</span>
        </section>
        <section className="alphi-card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-alphi-navy">Carga de documento fuente</p>
            <p className="text-xs text-alphi-muted">Consentimiento S-022 (sintético)</p>
          </div>
          <span className="alphi-pill border-alphi-sage/30 bg-alphi-green-soft text-alphi-sage">Completo</span>
        </section>
      </div>
    </main>
  );
}
