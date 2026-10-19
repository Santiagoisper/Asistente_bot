// H3 — Porte desde Asistente-CRF/__tests__/asim.test.ts (prototipo CRF).
// Tests de contrato para lib/asim.ts (ASIM — ALPHI Study Intelligence Model).
// Ajustes de porte: ASIMVersion → ASIMProtocolVersion (nombre del tipo ichtys)
// y el caso `amendment` del prototipo se adapta a approvedBy/approvedAt
// (el tipo ichtys no define amendment). El shape se verifica en compilación
// vía tsc --noEmit (los tipos viven en el import).
import { describe, it, expect } from "vitest";
import { validateASIM } from "../asim";
import type { ASIM, ASIMVisit, ASIMProtocolVersion } from "../asim";

const version: ASIMProtocolVersion = {
  id: "ver-001",
  protocolId: "PROT-2026-01",
  version: "1.0",
  status: "approved",
  approvedBy: "dr-sintetico",
  approvedAt: "2026-10-01T00:00:00.000Z",
};

const visit: ASIMVisit = {
  id: "vis-001",
  name: "Screening",
  targetDay: 0,
  toleranceBefore: 0,
  toleranceAfter: 0,
  procedures: ["consentimiento", "signos vitales"],
  requiredDocs: ["IEC aprobado"],
};

const asim: ASIM = {
  studyId: "EST-SIN-001",
  sponsor: "Sponsor Sintético SA",
  protocolVersion: version,
  visits: [visit],
  inclusionCriteria: ["edad >= 18"],
  exclusionCriteria: ["embarazo"],
  sourceRefs: [{ doc: "protocolo.pdf", section: "8.1", page: 42 }],
};

describe("asim (contrato de tipos con datos sintéticos)", () => {
  it("ASIMProtocolVersion: status dentro de la unión draft|reviewed|approved", () => {
    const statuses: ASIMProtocolVersion["status"][] = ["draft", "reviewed", "approved"];
    for (const s of statuses) expect(["draft", "reviewed", "approved"]).toContain(s);
    expect(version.status).toBe("approved");
  });

  it("ASIMVisit: campos obligatorios presentes y arrays inicializados", () => {
    expect(visit.id).toBeTruthy();
    expect(Number.isInteger(visit.targetDay)).toBe(true);
    expect(Array.isArray(visit.procedures)).toBe(true);
    expect(Array.isArray(visit.requiredDocs)).toBe(true);
  });

  it("ASIM: fixture completo valida en runtime", () => {
    expect(asim.studyId).toBe("EST-SIN-001");
    expect(asim.visits).toHaveLength(1);
    expect(asim.visits[0]?.name).toBe("Screening");
  });

  it("ASIM.sourceRefs: page es opcional", () => {
    const ref: ASIM["sourceRefs"][number] = { doc: "manual-investigador.pdf", section: "3" };
    expect(ref.page).toBeUndefined();
  });

  it("ASIMProtocolVersion: campos de aprobación son opcionales fuera de approved", () => {
    // Nota de porte: el prototipo CRF probaba `amendment` opcional; el tipo
    // ichtys no define amendment, sus opcionales reales son estos dos.
    const draft: ASIMProtocolVersion = { id: "ver-002", protocolId: "PROT-2026-01", version: "1.1", status: "draft" };
    expect(draft.approvedBy).toBeUndefined();
    expect(draft.approvedAt).toBeUndefined();
  });
});

// ---- Validador runtime validateASIM ----

describe("validateASIM", () => {
  // Fixture base válido: cada caso de fallo muta una sola cosa.
  const validAsim: ASIM = {
    studyId: "EST-SIN-001",
    sponsor: "Sponsor Sintético SA",
    protocolVersion: {
      id: "ver-001",
      protocolId: "PROT-2026-01",
      version: "1.0",
      status: "approved",
      approvedBy: "dr-sintetico",
      approvedAt: "2026-10-01T00:00:00.000Z",
    },
    visits: [
      { id: "vis-001", name: "Screening", targetDay: 0, toleranceBefore: 0, toleranceAfter: 0, procedures: [], requiredDocs: [] },
      { id: "vis-002", name: "Visita V4", targetDay: 21, toleranceBefore: 2, toleranceAfter: 2, procedures: ["ECG"], requiredDocs: ["consentimiento"] },
    ],
    inclusionCriteria: ["edad >= 18"],
    exclusionCriteria: ["embarazo"],
    sourceRefs: [{ doc: "protocolo.pdf", section: "8.1", page: 42 }],
  };

  it("acepta un ASIM completo y válido", () => {
    expect(validateASIM(validAsim)).toEqual({ ok: true });
  });

  it("rechaza entradas que no son objeto", () => {
    expect(validateASIM(null).ok).toBe(false);
    expect(validateASIM(undefined).ok).toBe(false);
    expect(validateASIM("asim").ok).toBe(false);
    expect(validateASIM(42).ok).toBe(false);
  });

  it("rechaza studyId o sponsor vacíos", () => {
    expect(validateASIM({ ...validAsim, studyId: "  " }).ok).toBe(false);
    expect(validateASIM({ ...validAsim, sponsor: "" }).ok).toBe(false);
  });

  it("rechaza status fuera de la unión", () => {
    const bad = { ...validAsim, protocolVersion: { ...validAsim.protocolVersion, status: "published" as unknown as ASIMProtocolVersion["status"] } };
    const r = validateASIM(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("approved sin approvedBy/approvedAt es inválido", () => {
    const bad = { ...validAsim, protocolVersion: { ...validAsim.protocolVersion, approvedBy: undefined, approvedAt: undefined } };
    const r = validateASIM(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("approvedBy"))).toBe(true);
      expect(r.errors.some((e) => e.includes("approvedAt"))).toBe(true);
    }
  });

  it("draft sin campos de aprobación es válido", () => {
    const draft: ASIM = {
      ...validAsim,
      protocolVersion: { id: "ver-003", protocolId: "PROT-2026-01", version: "1.1", status: "draft" },
    };
    expect(validateASIM(draft)).toEqual({ ok: true });
  });

  it("sin visitas es inválido", () => {
    const r = validateASIM({ ...validAsim, visits: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("visits"))).toBe(true);
  });

  it("ids de visita duplicados son inválidos", () => {
    const [vA, vB] = validAsim.visits;
    if (!vA || !vB) throw new Error("fixture: se esperaban 2 visitas");
    const dup: ASIM = { ...validAsim, visits: [vA, { ...vB, id: vA.id }] };
    const r = validateASIM(dup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("duplicado"))).toBe(true);
  });

  it("targetDay decimal y tolerancias negativas son inválidas", () => {
    const frac = { ...validAsim, visits: [{ ...validAsim.visits[0], targetDay: 1.5 }] };
    const negTol = { ...validAsim, visits: [{ ...validAsim.visits[0], toleranceBefore: -1 }] };
    expect(validateASIM(frac).ok).toBe(false);
    expect(validateASIM(negTol).ok).toBe(false);
  });

  it("acumula todos los errores, no corta en el primero", () => {
    const bad = validateASIM({ studyId: "", sponsor: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("sourceRef sin doc ni sección es inválido; page debe ser entero ≥ 1", () => {
    const badRef = { ...validAsim, sourceRefs: [{ doc: "", section: "", page: 0 }] };
    const r = validateASIM(badRef);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
