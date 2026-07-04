# Speaker notes + Q&A diligencia — pitch inversores

## Apertura (30 s)

«Somos ALPHI, Ichtys por dentro. Asistente documental para sitios de ensayo: el CRC pregunta en lenguaje natural y recibe respuesta **solo** si hay cita al protocolo. MVP pre-validación, sin PHI en prod. Les mostramos demo mock y el framework compliance — somos transparentes sobre qué falta.»

---

## Demo — guion oral

Ver [`docs/evals/demo-script.md`](../evals/demo-script.md).

**Frase clave:** «Si no está en el documento, no respondemos — mejor que inventar.»

**Si SM-004 falla en vivo:** pasar a SM-005 o usar video Plan B.

---

## Q&A — respuestas honestas (memorizar)

### ¿Están certificados Part 11 / Annex 11?

**No.** Tenemos framework alineado (políticas, arquitectura, plan CSV GAMP 5). Validación formal IQ/OQ/PQ pendiente — es parte del uso de capital.

### ¿Tienen PHI en producción?

**No.** Fase 0. Demo usa documentos mock T2D. Gates DPA/BAA, DPIA y clave PHI antes de go-live.

### ¿Cuántos usuarios / revenue?

**Pre-revenue.** Pilotos en conversación. No citar números inventados (1.200 usuarios, «desde 2020», etc.).

### ¿Cómo se comparan con Pacientry?

**Categoría distinta.** Ellos: epicrisis self-serve, ToS experimental, USD por epicrisis. Nosotros: trial-ops regulado, citas obligatorias, buyer sponsor/CRO. Pacientry valida demanda de IA sobre docs clínicos; **no pueden cruzar** el foso regulado sin años de CSV.

### ¿Qué pasa si el LLM alucina?

Grounding-only + umbral de similitud + fallback `insufficient_evidence`. Eval con casos adversariales (leakage 0% bloqueante). Screening: LLM extrae, **reglas deterministas** evalúan vs spec — PI decide.

### ¿Quién paga?

Sponsor, CRO o red — no el CRC individual. Pricing por estudio/sitio, contrato.

### ¿Barrera de entrada?

Profundidad compliance + validación + relaciones B2B reguladas. Competidor self-serve tarda años en CSV/GCP serio.

### ¿Riesgo regulatorio si fallan?

Por eso Fase 0 sin PHI; por eso no vendemos decision support diagnóstico; por eso audit log y citas desde día 1.

---

## Objeciones comunes

| Objeción | Respuesta |
|----------|-----------|
| «Es solo un chatbot» | Producto = **cita trazable** + spec + screening + audit. Chat es interfaz. |
| «OpenAI/Anthropic harán esto» | Generic LLM no tiene tenant isolation ni CSV ni responsabilidad GCP del site. |
| «Mercado chico LATAM» | Cardiometabólico LATAM en crecimiento; empezamos donde hay dolor y relaciones CINME. |
| «Necesitan más tracción» | Ask incluye primer piloto pagado; hoy mostramos profundidad técnica + compliance. |

---

## Cierre (30 s)

«Pacientry demostró que médicos pagan por IA sobre documentos. Nosotros vamos al nicho regulado que ellos no pueden servir con su ToS. Capital para cerrar validación y convertir profundidad en contratos. ¿Preguntas?»

---

## Anti-inflación — frases prohibidas

- ❌ «Certificado Part 11»
- ❌ «ISO 27001 certified»
- ❌ «1.200 usuarios» / «desde 2020»
- ❌ «Validado por FDA»
- ✅ «Framework alineado»
- ✅ «Validación formal en progreso»
- ✅ «MVP pre-validación, sin PHI en prod»
