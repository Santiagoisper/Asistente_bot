// ichtys/apps/web/app/(app)/consulta/page.tsx
// Stub ALPHI 2.0 — datos sintéticos. Vestido con el design system consolidado.
export default function ConsultaPage() {
  return (
    <main className="min-h-screen bg-alphi-slate p-6 md:p-10">
      <h1 className="text-2xl font-semibold text-alphi-navy">Consulta con citas</h1>
      <p className="mt-1 text-alphi-muted">Prototipo ALPHI 2.0 — datos sintéticos.</p>

      <div className="mt-6 max-w-2xl space-y-4">
        <section className="alphi-card p-5">
          <p className="alphi-label">Pregunta</p>
          <p className="mt-2 text-sm text-alphi-navy">¿Cuál es la ventana de la visita Día 21? (sintético)</p>
        </section>
        <section className="alphi-card p-5">
          <p className="alphi-label">Respuesta con citas</p>
          <p className="alphi-answer-text mt-2 text-alphi-navy">
            La visita Día 21 admite una tolerancia de ±2 días según el protocolo
            <span className="alphi-footnote" title="Protocolo ALPHA-X, sección 4.2, pág. 18 (sintético)">1</span>.
            Fuera de ventana se requiere justificación por desviación
            <span className="alphi-footnote" title="SOP monitorización, sección 6 (sintético)">2</span>.
          </p>
        </section>
      </div>
    </main>
  );
}
