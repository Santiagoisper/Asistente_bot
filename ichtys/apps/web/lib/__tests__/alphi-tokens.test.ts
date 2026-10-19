// H2 — Drift guard de la paleta ALPHI: una sola fuente de verdad.
// globals.css (:root) y tailwind.config.ts (theme.colors.alphi) deben exponer
// el mismo hex para cada token compartido. Si cambiás la paleta a propósito,
// actualizá globals.css + tailwind.config.ts + los valores dorados de acá.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(here, "../../app/globals.css"), "utf8");
const tailwindTs = readFileSync(join(here, "../../tailwind.config.ts"), "utf8");

/** Extrae los `--alphi-<name>: #hex` de globals.css. */
function tokensDeCss(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, hex] of source.matchAll(/--alphi-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    if (!name || !hex) continue
    out[name] = hex.toLowerCase();
  }
  return out;
}

/** Extrae las entradas `name: '#hex'` (o `'name': '#hex'`) del bloque colors.alphi. */
function tokensDeTailwind(source: string): Record<string, string> {
  const inicio = source.indexOf("alphi: {");
  expect(inicio, "tailwind.config.ts debe tener bloque colors.alphi").toBeGreaterThanOrEqual(0);
  const bloque = source.slice(inicio, source.indexOf("}", inicio));
  const out: Record<string, string> = {};
  for (const [, name, hex] of bloque.matchAll(/([a-z][a-z0-9-]*)'?\s*:\s*'(#[0-9a-fA-F]{6})'/g)) {
    if (!name || !hex) continue
    out[name] = hex.toLowerCase();
  }
  return out;
}

// Valores dorados de la paleta consolidada (fuente: globals.css :root).
const PALETA_DORADA: Record<string, string> = {
  navy: "#192337",
  teal: "#6855b6", // acento violeta; conserva el nombre histórico `teal`
  sage: "#059669",
  amber: "#d97706",
  rose: "#dc2626",
  slate: "#f7f8fc",
  border: "#e5e8f0",
  muted: "#667085",
  "violet-soft": "#f1edfa",
  "green-soft": "#e9f7f0",
  "blue-soft": "#eaf3fc",
  "amber-soft": "#fff4e2",
  "rose-soft": "#fceef1",
};

// Extras intencionales de tailwind (documentados en el propio config):
// navydim = navy para hover; teallit = alias legacy de violet-soft.
const EXTRAS_TAILWIND = { navydim: "#222c42", teallit: "#f1edfa" };

describe("alphi tokens — una sola fuente de verdad (globals.css ↔ tailwind.config.ts)", () => {
  const css = tokensDeCss(globalsCss);
  const tw = tokensDeTailwind(tailwindTs);

  it("globals.css :root define exactamente la paleta consolidada", () => {
    expect(css).toEqual(PALETA_DORADA);
  });

  it("tailwind colors.alphi cubre todos los tokens de globals.css (sin huérfanos CSS)", () => {
    for (const name of Object.keys(css)) {
      expect(tw, `token --alphi-${name} existe en globals.css pero no en tailwind colors.alphi`).toHaveProperty(name);
    }
  });

  it("cada token compartido tiene el mismo hex en ambas fuentes", () => {
    for (const [name, hex] of Object.entries(css)) {
      expect(tw[name], `drift en "${name}": globals.css=${hex}, tailwind=${tw[name]}`).toBe(hex);
    }
  });

  it("los extras de tailwind son solo los documentados y teallit es alias de violet-soft", () => {
    const extras = Object.fromEntries(
      Object.entries(tw).filter(([name]) => !(name in PALETA_DORADA)),
    );
    expect(extras).toEqual(EXTRAS_TAILWIND);
    expect(tw.teallit).toBe(tw["violet-soft"]);
  });
});
