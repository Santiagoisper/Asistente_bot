# Inventario de sistemas de IA — Alphi

**Estado: BORRADOR — pendiente de revisión por Calidad, responsable clínico y Seguridad.**
**Fecha:** 2026-11-12
**Responsable propuesto:** dirección técnica hasta asignar dueño de gobernanza de IA.
**Base:** [`REGULATORY-BASELINE.md`](./REGULATORY-BASELINE.md), §§4 (R5, R6, R8, R9, R11) y 6.

Este es un **inventario de usos identificados en el código**, no una declaración de modelos desplegados. Proveedor y modelo pueden variar por organización, preferencia y variables del entorno; los valores efectivos se deben obtener de la ejecución y documentar por versión. «Impacto» es una prioridad preliminar de evaluación, no una clasificación regulatoria definitiva.

## 1. Sistemas identificados

| ID | Uso y entrada | Selección de modelo en código; versión efectiva | Salida y efecto | Impacto preliminar / supervisión | Evidencia de código |
|---|---|---|---|---|---|
| IA-01 | Asistente RAG: consulta y fragmentos de documentos de estudio. | Propósito `answer`; **sin verificar** por respuesta. | Respuesta con evidencia recuperada; puede influir en decisiones del equipo. | **Alto potencial:** revisión humana antes de usarla para una decisión clínica o del estudio. | [`answer-engine.ts`](../../packages/rag/answer-engine.ts), [`retriever.ts`](../../packages/rag/retriever.ts) |
| IA-02 | Embeddings: texto documental y consultas para recuperación. | `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`; **sin verificar** en producción. | Vectores e índice de búsqueda; pueden omitir evidencia relevante. | **Medio a alto**, según IA-01. Medir recuperación y cambios de espacio vectorial. | [`embedding-config.ts`](../../packages/ingestion/embedding-config.ts), [`embedder.ts`](../../packages/ingestion/embedder.ts) |
| IA-03 | Extracción de especificaciones y visitas desde protocolos o guías. | Propósito `spec`; **sin verificar** por extracción. | Criterios y estructura propuestos para el estudio. | **Alto:** aprobación humana antes de uso; gate efectivo pendiente de verificar. | [`spec-extractor.ts`](../../packages/ingestion/spec-extractor.ts) |
| IA-04 | Extracción de hechos de una evolución clínica. | Propósito `clinical-extract`; **sin verificar** por perfil. | Hechos estructurados fusionados con el perfil del sujeto. | **Alto; brecha C2:** el perfil se actualiza sin confirmación humana previa y alimenta la evaluación de elegibilidad. | [`patient-profile-service.ts`](../../apps/web/lib/subjects/patient-profile-service.ts) |
| IA-05 | Lectura de informes de laboratorio en texto o imagen. | Propósito `lab-read`; cadena Anthropic/OpenAI/Google; **sin verificar** por informe. | Valores propuestos que la persona compara con el informe. | **Alto:** la interfaz pide revisión y confirmación; falta verificar de extremo a extremo el bloqueo de escritura sin esa acción. | [`lab-model-reader.ts`](../../apps/web/lib/labs/lab-model-reader.ts), [`review-client.tsx`](../../apps/web/components/labs/review-client.tsx) |
| IA-06 | Título de conversación a partir del chat. | Propósito `title`; **sin verificar** por título. | Etiqueta auxiliar de navegación. | **Menor impacto directo:** revisar datos enviados y posible título engañoso; no es registro clínico. | [`persistence.ts`](../../apps/web/lib/chat/persistence.ts) |

El motor de elegibilidad de [`screening-engine.ts`](../../packages/clinical/screening-engine.ts) aplica reglas deterministas, no es un modelo generativo. Se registra como **dependencia de IA-04** porque puede recibir hechos extraídos por ese sistema; el riesgo de la extracción llega a su resultado. Este inventario no incorpora como activos modelos que solo figuran en documentos antiguos o en código sin uso confirmado.

## 2. Ficha de evaluación requerida por sistema

Antes de aprobar el inventario, completar una ficha por ID con:

1. **Uso previsto y dueño:** función, usuarios, organización/estudio, responsable técnico y clínico, límites de uso y decisión final humana.
2. **Datos:** categorías de entrada y salida, procedencia, seudonimización, proveedor que los recibe, ubicación, retención, acuerdo aplicable y evidencia. Ningún dato de paciente se usa para entrenar modelos sin autorización y evaluación específicas.
3. **Modelo efectivo:** proveedor, identificador y versión, configuración, origen de la clave, fecha de puesta en servicio y camino alternativo. [`provider.ts`](../../packages/llm/provider.ts) define propósitos y valores por defecto; no demuestra qué modelo respondió en producción.
4. **Impacto y fallas:** error plausible, consecuencia clínica u operativa, población afectada, autonomía real, control humano y posibilidad de detectar y revertir el error.
5. **Pruebas y operación:** casos representativos con datos sintéticos, métricas, umbrales acordados, registros de versión por respuesta, incidentes, responsable de monitoreo y fecha de reevaluación.

Como objetivo de R6, la salida de IA se identifica como propuesta y mantiene una persona responsable; no debe guardar, firmar, enviar ni cerrar por sí sola un registro clínico. IA-04 aún contradice ese objetivo. Un cambio de proveedor, modelo, prompt o uso previsto requiere evaluación de impacto, pruebas pertinentes, revisión independiente y aprobación nominal antes de activarse (R6 y R8). El inventario se revisa ante cada cambio y con una frecuencia periódica aún por aprobar.

Referencias de diseño: [ISO/IEC 42001:2023](https://www.iso.org/standard/42001) como norma de sistema de gestión y [guía EMA sobre sistemas informatizados](https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/guideline-computerised-systems-and-electronic-data-clinical-trials_en.pdf). Calidad y Legales determinan la aplicabilidad concreta.

## Sin verificar

- Inventario efectivo de modelos, versiones, proveedores y rutas alternativas **en producción**; ubicación, retención y acuerdos de cada proveedor. El registro documental de proveedores carece de evidencia enlazada según el marco.
- Registro de proveedor y versión **por respuesta**, relación entre respuesta y datos de origen, cobertura de monitoreo y capacidad de reconstruir una decisión pasada. Hay registros de uso en varios caminos de código, pero no equivalen por sí solos a trazabilidad por respuesta.
- Revisión humana efectiva y obligatoria en IA-01, IA-03 e IA-05, incluida la protección del servidor frente a rutas alternativas. IA-04 tiene la brecha C2 confirmada en el marco y el código.
- Resultados actuales de pruebas de calidad, sesgo, seguridad y estabilidad por sistema y población; los valores históricos de [`AI-GOVERNANCE.md`](./AI-GOVERNANCE.md) no son mediciones actuales.
- Inventario de prompts, versiones de configuraciones, responsables nominales, registro de incidentes de IA y fecha de la última revisión.
- Otros usos de modelos en scripts operativos, integraciones o despliegues fuera de las rutas examinadas; falta contrastar con el entorno real y los responsables del producto.
