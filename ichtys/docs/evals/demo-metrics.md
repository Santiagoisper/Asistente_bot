# Demo metrics — mock metabólico T2D

**Última actualización:** 2026-07-04  
**Estudio:** `MOCK-METABOLIC-T2D-v1` (`508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6`)  
**Estado:** Infraestructura lista vía `pnpm demo:setup`; eval automatizada requiere `EVAL_AUTH_COOKIE` + servidor local.

---

## Infraestructura demo

| Métrica | Valor |
|---------|-------|
| Documentos mock | 5 (protocol, IB, lab, pharmacy, procedures) |
| Chunks con embeddings | ~58 (text-embedding-3-small) |
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
| Pass rate smoke 6Q | ≥ 5/6 | Aceptación demo inversores |

### Eval automatizada (6 preguntas demo)

Ejecutar y **pegar resultados reales** tras correr:

```powershell
pnpm evals:mock-metabolic -- --filter SM-001,SM-002,SM-003,SM-004,SM-005,SM-006
```

| Campo | Valor (completar post-run) |
|-------|----------------------------|
| Run ID | _pending_ |
| PASS | _pending_ / 6 |
| FAIL | _pending_ |
| ERROR | _pending_ |
| Pass rate | _pending_ % |
| Latencia P50 | _pending_ ms |
| Latencia P90 | _pending_ ms |

> **Honestidad:** hasta que no se ejecute el runner con cookie válida, usar “eval en progreso” en pitch — no inventar pass rates.

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
