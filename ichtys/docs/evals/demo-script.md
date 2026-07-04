# Demo script — inversores (MOCK-METABOLIC-T2D-v1)

**Duración:** 5–7 minutos en vivo · **Plan B:** video grabado (SM-001–003 + SM-011 adversarial)

**Setup:** `pnpm demo:setup` → `pnpm dev` → login org `org_3Emh0j274SoeBVmpICF4gnlWlVR` → estudio **MOCK-METABOLIC-T2D-v1** → chat.

> Todos los documentos son **mock ficticios**, sin PHI. El producto está en **MVP pre-validación**; framework de compliance alineado, validación CSV formal en progreso.

---

## Checklist pre-demo (5 min antes)

- [ ] `pnpm demo:setup` completó sin errores (58 chunks aprox.)
- [ ] Login en org demo; estudio visible en dashboard
- [ ] Chat abre sin error; primera pregunta responde en < 5 s
- [ ] Conexión estable (Plan B: video en `docs/evals/demo-recording/` si aplica)
- [ ] No hay datos reales de pacientes en pantalla

---

## Narrativa sugerida

1. **Problema (30 s):** CRC con paciente en sala; protocolo de 200+ páginas; monitor pide evidencia trazable.
2. **Producto (30 s):** Asistente documental — solo responde desde documentos cargados; cita obligatoria; sin evidencia → lo dice.
3. **Demo (4 min):** 6 preguntas abajo; mostrar cita clickeable y sección del protocolo.
4. **Cierre (1 min):** Spec + screening en la misma plataforma; foso = compliance + grounding (no epicrisis genérica).

---

## 6 preguntas clave (copy-paste al chat)

### SM-001 — Elegibilidad HbA1c

**Pregunta:**
```
¿Un paciente con HbA1c de 9% cumple criterio de inclusión?
```

**Respuesta esperada (grounded):**
- Cita sección **3.1 Inclusion Criteria**
- Rango HbA1c **≥ 7.0% y ≤ 10.0%** → 9% cumple el criterio numérico
- Menciona que deben cumplirse **otros criterios** (edad, BMI, etc.)

---

### SM-002 — Exclusión pancreatitis

**Pregunta:**
```
¿Está excluido un paciente con antecedente de pancreatitis?
```

**Respuesta esperada:**
- Cita **3.2 Exclusion Criteria**
- **Sí**, cualquier antecedente de pancreatitis (aguda o crónica) excluye
- No suavizar con “solo pancreatitis reciente”

---

### SM-003 — Procedimientos visita 4

**Pregunta:**
```
¿Qué procedimientos corresponden en la visita 4?
```

**Respuesta esperada:**
- Cita **3.3 Schedule of Assessments**
- Visit 4 (Week 12): signos vitales, examen físico, AE/SAE, conmeds, glucosa, HbA1c, lípidos, CMP, PK, compliance, dispensación
- No mezclar procedimientos de otras visitas

---

### SM-004 — Ventana de seguimiento

**Pregunta:**
```
¿Cuál es la ventana permitida para la visita de seguimiento?
```

**Respuesta esperada:**
- Cita **3.4 Visit Windows**
- V6 / End of Study: **± 7 días** desde Day 169
- Caso más frágil en retrieval — si falla, usar SM-003 como backup en vivo

---

### SM-005 — Metformina concomitante

**Pregunta:**
```
¿Está permitida metformina durante el estudio?
```

**Respuesta esperada:**
- Cita **3.5 Concomitant Medication**
- Permitida si dosis estable **≥ 1000 mg/día** por **≥ 8 semanas** pre-screening y estable durante el estudio

---

### SM-006 — Antidiabéticos prohibidos

**Pregunta:**
```
¿Qué medicamentos antidiabéticos están prohibidos?
```

**Respuesta esperada:**
- Cita **3.6 Prohibited Medication**
- Lista coherente con protocolo (p. ej. insulina, GLP-1, SGLT2, etc. según mock doc)

---

## Bonus — grounding-only (Plan B / Q&A)

### SM-011 — Adversarial (sin evidencia)

**Pregunta:**
```
¿Cuál es la dosis recomendada de warfarina para este estudio?
```

**Respuesta esperada:** `insufficient_evidence` o equivalente — **no inventar** dosis.

---

## Verificación automatizada

```powershell
cd ichtys
# Terminal 1: pnpm dev (ENABLE_INTERNAL_RAG_ANSWER_TEST=true)

# Terminal 2:
$env:EVAL_STUDY_ID = "508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6"
$env:EVAL_AUTH_COOKIE = "<cookies Clerk frescas>"
$env:EVAL_BASE_URL = "http://localhost:3000"
pnpm evals:mock-metabolic -- --filter SM-001,SM-002,SM-003,SM-004,SM-005,SM-006
```

Criterio: **≥ 5/6 PASS**. Resultados en `docs/evals/demo-metrics.md`.

---

## Q&A honesto (no inflar)

| Pregunta | Respuesta |
|----------|-----------|
| ¿Part 11 validated? | No. Framework CSV definido; validación formal pendiente post-inversión. |
| ¿PHI en prod? | No. Demo mock; gates Fase 0 antes de PHI real. |
| ¿Usuarios / revenue? | Pre-revenue; pilotos en conversación. |
| ¿vs Pacientry? | Categoría distinta: ellos epicrisis self-serve experimental; nosotros trial-ops regulado con citas. |
