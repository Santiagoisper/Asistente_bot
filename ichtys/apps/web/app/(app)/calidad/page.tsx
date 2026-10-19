// ichtys/apps/web/app/(app)/calidad/page.tsx
// Stub ALPHI 2.0 — datos sintéticos. Vestido con el design system consolidado.
export default function CalidadPage() {
  return (
    <main className="min-h-screen bg-alphi-slate p-6 md:p-10">
      <h1 className="text-2xl font-semibold text-alphi-navy">Calidad y CRF</h1>
      <p className="mt-1 text-alphi-muted">Prototipo ALPHI 2.0 — datos sintéticos.</p>

      <div className="mt-6 max-w-2xl space-y-3">
        <section className="alphi-card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-alphi-navy">CRF S-003 — Screening</p>
            <p className="text-xs text-alphi-muted">12/12 campos completos (sintético)</p>
          </div>
          <span className="alphi-pill border-alphi-sage/30 bg-alphi-green-soft text-alphi-sage">Limpio</span>
        </section>
        <section className="alphi-card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-alphi-navy">CRF S-007 — Día 7</p>
            <p className="text-xs text-alphi-muted">Falta laboratorio (sintético)</p>
          </div>
          <span className="alphi-pill border-alphi-rose/30 bg-alphi-rose-soft text-alphi-rose">Incompleto</span>
        </section>
        <section className="alphi-card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-alphi-navy">Query abierta — S-010</p>
            <p className="text-xs text-alphi-muted">Fecha de consentimiento ilegible (sintético)</p>
          </div>
          <span className="alphi-pill border-alphi-amber/30 bg-alphi-amber-soft text-alphi-amber">Query</span>
        </section>
      </div>
    </main>
  );
}
