// ichtys/apps/web/lib/asim.ts
// ASIM — Modelo estructurado de protocolo (ALPHI 2.0). Portado desde el
// prototipo de Asistente-CRF. Los tipos gobiernan el compile-time;
// validateASIM gobierna el runtime (los tipos no existen post-compilación).

export type ASIMProtocolVersion = {
  id: string;
  protocolId: string;
  version: string;
  status: 'draft' | 'reviewed' | 'approved';
  approvedBy?: string;
  approvedAt?: string; // ISO YYYY-MM-DD (o datetime ISO completo)
};

export type ASIMVisit = {
  id: string;
  name: string;
  targetDay: number;
  toleranceBefore: number;
  toleranceAfter: number;
  procedures: string[];
  requiredDocs: string[];
};

export type ASIMSourceRef = {
  doc: string;
  section: string;
  page?: number;
};

export type ASIM = {
  studyId: string;
  sponsor: string;
  protocolVersion: ASIMProtocolVersion;
  visits: ASIMVisit[];
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  sourceRefs: ASIMSourceRef[];
};

export type ASIMValidationResult = { ok: true } | { ok: false; errors: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function esFechaIso(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const fecha = v.slice(0, 10);
  if (!ISO_DATE.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

function esArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export function validateASIM(input: unknown): ASIMValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['ASIM debe ser un objeto'] };
  }
  const a = input as Record<string, unknown>;

  if (!esTextoNoVacio(a.studyId)) errors.push('studyId: texto no vacío requerido');
  if (!esTextoNoVacio(a.sponsor)) errors.push('sponsor: texto no vacío requerido');

  // Versión de protocolo
  const pv = a.protocolVersion;
  if (typeof pv !== 'object' || pv === null || Array.isArray(pv)) {
    errors.push('protocolVersion: objeto requerido');
  } else {
    const p = pv as Record<string, unknown>;
    for (const campo of ['id', 'protocolId', 'version'] as const) {
      if (!esTextoNoVacio(p[campo])) errors.push(`protocolVersion.${campo}: texto no vacío requerido`);
    }
    if (p.status !== 'draft' && p.status !== 'reviewed' && p.status !== 'approved') {
      errors.push('protocolVersion.status: debe ser draft | reviewed | approved');
    }
    if (p.status === 'approved') {
      if (!esTextoNoVacio(p.approvedBy)) errors.push('protocolVersion.approvedBy: requerido cuando status=approved');
      if (!esFechaIso(p.approvedAt)) errors.push('protocolVersion.approvedAt: fecha ISO requerida cuando status=approved');
    }
  }

  // Visitas
  if (!esArray(a.visits) || a.visits.length === 0) {
    errors.push('visits: se requiere al menos una visita');
  } else {
    const vistos = new Set<string>();
    (a.visits as unknown[]).forEach((v, i) => {
      const prefijo = `visits[${i}]`;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        errors.push(`${prefijo}: objeto requerido`);
        return;
      }
      const vis = v as Record<string, unknown>;
      if (!esTextoNoVacio(vis.id)) {
        errors.push(`${prefijo}.id: texto no vacío requerido`);
      } else if (vistos.has(vis.id)) {
        errors.push(`${prefijo}.id: id duplicado ("${vis.id}")`);
      } else {
        vistos.add(vis.id);
      }
      if (!Number.isInteger(vis.targetDay)) errors.push(`${prefijo}.targetDay: entero requerido`);
      if (typeof vis.toleranceBefore !== 'number' || vis.toleranceBefore < 0) {
        errors.push(`${prefijo}.toleranceBefore: número ≥ 0 requerido`);
      }
      if (typeof vis.toleranceAfter !== 'number' || vis.toleranceAfter < 0) {
        errors.push(`${prefijo}.toleranceAfter: número ≥ 0 requerido`);
      }
    });
  }

  // Criterios
  if (!esArray(a.inclusionCriteria)) errors.push('inclusionCriteria: array requerido');
  if (!esArray(a.exclusionCriteria)) errors.push('exclusionCriteria: array requerido');

  // Fuentes
  if (!esArray(a.sourceRefs)) {
    errors.push('sourceRefs: array requerido');
  } else {
    (a.sourceRefs as unknown[]).forEach((s, i) => {
      const prefijo = `sourceRefs[${i}]`;
      if (typeof s !== 'object' || s === null || Array.isArray(s)) {
        errors.push(`${prefijo}: objeto requerido`);
        return;
      }
      const ref = s as Record<string, unknown>;
      if (!esTextoNoVacio(ref.doc)) errors.push(`${prefijo}.doc: texto no vacío requerido`);
      if (!esTextoNoVacio(ref.section)) errors.push(`${prefijo}.section: texto no vacío requerido`);
      if (ref.page !== undefined && (!Number.isInteger(ref.page) || (ref.page as number) < 1)) {
        errors.push(`${prefijo}.page: entero ≥ 1 requerido si está presente`);
      }
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
