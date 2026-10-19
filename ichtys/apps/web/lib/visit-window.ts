// ichtys/apps/web/lib/visit-window.ts
// Motor de ventanas de visita (ALPHI 2.0). Aritmética pura en UTC sobre fechas
// ISO YYYY-MM-DD. Falla cerrado: cualquier entrada inválida devuelve null.
// Portado y endurecido desde el prototipo de Asistente-CRF (validado por BOPE).

export type VisitWindow = {
  targetDate: string;
  windowStart: string;
  windowEnd: string;
  version: string;
};

const VERSION = 'visit-window-motor v0.1.0 (TS mirror)';
const MS_POR_DIA = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeVisitWindow({
  anchorDate,
  targetDay,
  toleranceBefore,
  toleranceAfter,
}: {
  anchorDate: string;
  targetDay: number;
  toleranceBefore: number;
  toleranceAfter: number;
}): VisitWindow | null {
  if (toleranceBefore < 0 || toleranceAfter < 0) return null;
  if (!Number.isInteger(targetDay)) return null;
  if (!isValidIsoDate(anchorDate)) return null;

  // Normalizamos el anclaje a medianoche UTC: evita deriva por zona horaria
  // del parser (p. ej. UTC-3 corre el día anterior) y hace el motor determinista.
  const base = Date.parse(`${anchorDate}T00:00:00.000Z`);
  const targetMs = base + targetDay * MS_POR_DIA;
  const target = new Date(targetMs);
  const start = new Date(targetMs - toleranceBefore * MS_POR_DIA);
  const end = new Date(targetMs + toleranceAfter * MS_POR_DIA);

  return {
    targetDate: toIso(target),
    windowStart: toIso(start),
    windowEnd: toIso(end),
    version: VERSION,
  };
}
