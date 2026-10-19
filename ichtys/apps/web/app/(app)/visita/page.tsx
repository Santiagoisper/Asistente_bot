// ichtys/apps/web/app/(app)/visita/page.tsx
// Stub ALPHI 2.0 — motor real (computeVisitWindow) con datos sintéticos.
import { computeVisitWindow } from '../../../lib/visit-window';

export default function VisitaPage() {
  const visitWindow = computeVisitWindow({ anchorDate: "2025-10-01", targetDay: 21, toleranceBefore: 2, toleranceAfter: 2 });

  return (
    <main className="min-h-screen bg-alphi-slate p-6 md:p-10">
      <h1 className="text-2xl font-semibold text-alphi-navy">Visit Assistant</h1>
      <p className="mt-1 text-alphi-muted">Prototipo ALPHI 2.0 — datos sintéticos.</p>

      <div className="mt-6 max-w-2xl space-y-4">
        <section className="alphi-card p-5">
          <p className="alphi-label">Ventana de visita</p>
          <p className="mt-2 text-sm text-alphi-navy">
            Día objetivo <strong>{visitWindow?.targetDate}</strong> · Tolerancia ±2 días
          </p>
          <p className="mt-1 text-lg font-semibold text-alphi-teal">
            {visitWindow?.windowStart} – {visitWindow?.windowEnd}
          </p>
          <p className="mt-2 text-xs text-alphi-muted">
            Anclaje 2025-10-01 (sintético) · Motor v{visitWindow?.version}, aritmética UTC.
          </p>
        </section>
        <section className="alphi-card p-5">
          <p className="alphi-label">Procedimientos de la visita</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-alphi-navy">
            <li>Signos vitales (sintético)</li>
            <li>Laboratorio central (sintético)</li>
            <li>Escala EVA (sintético)</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
