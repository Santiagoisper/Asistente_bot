# GTM — Ingeniería inversa Pacientry → takeaways para ALPHI

**Fecha:** 2026-07-04
**Fuentes:** pacientry.com (live), código ichtys (HEAD), `docs/compliance/`, `docs/evals/`.
**Contexto:** insumo para presentación a inversores (T-3 días) y roadmap GTM.

---

## Corrección de partida (no negociable para el pitch)

- **ALPHI/ichtys es un asistente documental clínico con RAG** (respuestas grounded + citas
  sobre documentos de ensayos: protocolos, IBs, manuales) + extracción de specs + screening.
  Es un **MVP pre-validación, sin PHI real en producción** (Fase 0). **NO** es un CTMS
  completo certificado. No presentar como "Alpha-CR certificado Part 11 / 1.200 usuarios /
  desde 2020" — inflar ante inversores mata el deal en diligence.
- **Pacientry** (live): IA que genera epicrisis, eventos clínicos, diagnósticos diferenciales
  y CIE-11 desde documentos médicos (20+ formatos, OCR, audio, DICOM). Self-serve.
  Precio por uso: **USD 0.59/epicrisis** o **USD 149/mes + USD 0.30/crédito**. 3 gratis sin
  tarjeta. 500+ profesionales, 10K+ epicrisis. Su ToS se declara **"experimental"** y declina
  responsabilidad clínica. Desarrollado por estudio externo (Spotibit).

Son **categorías distintas**. Se tocan solo en matching/screening paciente↔ensayo.

---

## Activos que ALPHI YA tiene (y no muestra)

| Activo | Ubicación | Uso GTM |
|---|---|---|
| Set completo de docs mock de un ensayo T2D (Protocolo, IB, Lab, Pharmacy, Procedures) | `docs/evals/mock-metabolic-documents/` | **Demo tenant sin PHI** |
| Scripts de seed de estudio/chunks mock | `scripts/seed-mock-study.ts`, `seed-mock-chunks.ts`, `upload-mock-docs.mjs` | Levantar el demo |
| 13 políticas de compliance | `docs/compliance/*.md` | **Trust center público** |
| Resumen de eval real | `docs/evals/mock-metabolic-real-eval-summary.md` | Métricas honestas para ROI |
| Export spec (E3) | `apps/web/app/api/studies/[id]/spec/[specId]/export/route.ts` | Reporte exportable |

---

## Adoptar directo (seguro, pre-PHI, pre-validación)

1. **Demo público con los mock docs T2D.** Un site pregunta al chat sobre un protocolo
   realista y ve las citas — sin subir nada. Equivalente al "3 gratis sin tarjeta" de
   Pacientry, pero ya construido. Máximo quick-win: producto tangible en 2 min, cero riesgo.
2. **Página de precios pública** (por estudio / por documento + enterprise contact). Rompe la
   barrera "todo por ventas" que hoy es la debilidad #1 de ALPHI.
3. **Trust / Compliance center público** desde las 13 políticas, con estado honesto
   ("validación formal en progreso"). Pacientry se declara "experimental" — **su mayor
   debilidad es tu mayor fortaleza, pero hoy no la mostrás.**
4. **Páginas legales públicas (ToS/Privacy).** Necesarias para Fase 0 igual.
5. **Calculadora de ROI** con números propios de eval (tiempo extracción spec vs manual,
   respuesta a consulta de protocolo). Copiar el patrón, no los números de ellos.

## Adaptar al contexto B2B/regulado

6. **Precio por uso / créditos** (por documento ingerido / spec extraída / estudio) en vez de
   tarifa opaca. Baja la barrera para sites chicos.
7. **OCR de PDFs escaneados** — muchos protocolos/manuales llegan escaneados; hoy solo PDF con
   texto. (Audio/DICOM NO — no aplica a trial-ops.)
8. **Reporte exportable de elegibilidad para comité de ética** — Pacientry lo tiene para
   reclutamiento; el screening de ALPHI puede generarlo **grounded + con audit trail** (vía
   E3). Mejorarlo, no copiarlo plano.
9. **Framing por outcome con métricas** en vez de specs técnicas.
10. **Onboarding self-serve de bajo friction** — pilot tier: 1 estudio, N docs, sin call.

## NO copiar (trampas)

- **Disclaimer "experimental / declinamos responsabilidad clínica"** — opuesto a la propuesta
  de valor de ALPHI. Copiarlo borra el diferenciador.
- **Diagnósticos diferenciales / decision support generativo** — rompe el contrato
  grounding-only (sin evidencia → sin respuesta) y la postura regulatoria. Elección distinta,
  correcta para el mercado de ALPHI.
- **Sobre-declarar métricas/certificaciones.**
- **Modelo marketing-first / dev-shop externo** — la profundidad es el foso.

---

## Lección de fondo

Pacientry **monetiza atención con una superficie de salida al mercado**; ALPHI tiene
**profundidad sin superficie**. Robar la superficie (demo, precios, trust center, ROI),
conservar la profundidad (grounding, citas, compliance real). Casi todo "adoptar directo" es
el *slice que puede salir antes de la validación CSV* — y es exactamente lo que hace demo-able
el producto para inversores.

## Tesis de inversión (honesta)

Pacientry prueba que hay demanda de IA sobre documentos clínicos — y **no puede tocar
trial-ops regulado** (sin Part 11, sin GCP, ToS "experimental"). ALPHI es dueño del nicho
difícil y defendible. Ask: capital para (a) cerrar validación CSV + gates de compliance, y
(b) construir la superficie GTM. El foso = la barrera regulatoria que a un competidor
self-serve le toma años cruzar.
