# Demo metrics — mock metabólico T2D

**Última actualización:** 2026-07-04  
**Estudio:** `MOCK-METABOLIC-T2D-v1` (`508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6`)  
**Estado:** Demo tenant listo; eval directa **12/12 PASS** (run `8d1c37ce-cbd1-4fc3-a416-6b20a6329e2d`).

---

## Infraestructura demo

| Métrica | Valor |
|---------|-------|
| Documentos mock | 5 (protocol, IB, lab, pharmacy, procedures) |
| Chunks con embeddings | 58 (text-embedding-3-small) |
| PHI en dataset | 0 (mock explícito) |
| Comando setup | `pnpm demo:setup` |

---

## Calidad RAG (targets — `docs/EVALS.md`)

| Métrica | Target | Notas |
|---------|--------|-------|
| Citation correctness | > 90% | Casos SM-001–006 protocolo |
| Cross-study leakage | **0%** | Bloqueante |
| Cross-tenant leakage | **0%** | Bloqueante |
| Latencia P90 chat | < 4 s | NFR PRD |
| Pass rate smoke 6Q | ≥ 5/6 | **6/6 PASS** (2026-07-04) |

### Eval automatizada (6 preguntas demo)

Ejecutar y **pegar resultados reales** tras correr:

```powershell
pnpm evals:mock-metabolic -- --filter SM-001,SM-002,SM-003,SM-004,SM-005,SM-006
```

| Campo | Valor (completar post-run) |
|-------|----------------------------|
| Run ID | `8d1c37ce-cbd1-4fc3-a416-6b20a6329e2d` |
| PASS | **12** / 12 (suite completa) |
| FAIL | 0 |
| ERROR | 0 |
| Pass rate | **100%** |
| Latencia P50 | ~7.9 s |
| Latencia P90 | ~17.7 s |

Smoke 6Q (SM-001–006): run `c4e15c07-e5de-4b54-8e24-466bcb729244` — **6/6 PASS**.

Comando usado: `pnpm evals:direct` (RAG directo, sin HTTP/Clerk). Para eval vía API: `pnpm evals:mock-metabolic` con org **INNOVA TRIALS** activa en Clerk.

---

## ROI — estimaciones para calculadora (`/roi`)

Constantes usadas en la UI. **Etiquetadas como estimaciones internas**, no resultados clínicos ni de ensayos reales.

| Constante | Valor | Fuente / supuesto |
|-----------|-------|-------------------|
| Minutos búsqueda manual / consulta protocolo | 8 min (default slider) | Estimación operacional: PDF 200–400 págs, CRC en sala (PRD §2) |
| Rango típico manual | 5–15 min | Mismo |
| Tiempo respuesta Ichtys (con cita) | ~30–90 s | Target latencia eval + observación dev |
| Ahorro por consulta | manual − asistente | Derivado en calculadora |
| Horas ahorradas / mes / sitio | consultas × ahorro / 60 | Derivado |
| Costo hora CRC (referencia LATAM) | USD 25 (default, editable) | Benchmark mercado — **no dato del producto** |

### Fórmula (calculadora)

```
ahorroMinPorConsulta = minutosManual − (segundosAsistente / 60)
horasAhorradasMes = estudios × consultasMes × ahorroMinPorConsulta / 60
ahorroUsdMes = horasAhorradasMes × costoHoraCrc
```

Footnote obligatorio en UI: *Estimaciones basadas en eval interna mock y supuestos operacionales; no resultados clínicos.*

---

## Referencias

- Casos: [`mock-metabolic-smoke-test-cases.json`](mock-metabolic-smoke-test-cases.json)
- Guion demo: [`demo-script.md`](demo-script.md)
- Eval runbook: [`mock-metabolic-real-eval-summary.md`](mock-metabolic-real-eval-summary.md)
