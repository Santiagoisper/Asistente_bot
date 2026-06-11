# Study Spec Extraction Decision

## Decision

El protocolo no solo alimenta el RAG: de él se extrae un **study spec** tipado
(criterios de elegibilidad, endpoints, visitas del SoA, identificación) que se
persiste versionado en `study_specs` y queda como base para las capas
operativas (checklists de elegibilidad, ventanas de visita, análisis de
enmiendas). Los chunks y el spec son complementarios — el spec no reemplaza
el retrieval.

## Contrato

`packages/ingestion/study-spec.ts` define el schema Zod que valida **todo**
insert en `study_specs.spec` (jsonb). Reglas del contrato:

- Cada item lleva provenance (`sourcePages`, 1-based, mínimo 1 página) y
  `confidence` (`high | medium | low`) reportada por el extractor.
  **Sin provenance no hay item** — el schema lo rechaza.
- El texto se preserva verbatim en el idioma original del protocolo.
  El extractor no traduce ni parafrasea.
- La numeración original de los criterios se preserva como string
  ("3", "10a") tal como aparece impresa.

## Extracción en dos fases

`packages/ingestion/spec-extractor.ts`:

1. **Localización determinística** de secciones por heading (regex sobre las
   páginas parseadas, sin LLM). Headings ICH M11 en español: `5.1 Criterios
   de inclusión`, `3 Objetivos`, `1.3 Cronograma de actividades`. Se toma la
   **última** ocurrencia del heading de apertura (salta la tabla de
   contenidos) y la primera del heading siguiente como cierre.
2. **Extracción estructurada por grupo** con `generateObject`
   (claude-sonnet-4-6, configurable vía `SPEC_EXTRACTION_MODEL`) sobre SOLO
   las páginas localizadas, marcadas con `[PAGE N]` para que el modelo cite
   provenance. Cuatro grupos en paralelo: identificación, elegibilidad,
   endpoints, visitas.

Fallo de localización o de extracción de un grupo ⇒ grupo vacío + warning
con la causa. El spec nace `draft` y la revisión humana es obligatoria
(ALPHI), así que un parcial es útil; un throw no.

## Lecciones de la validación con protocolos reales

Validado contra 4 protocolos Lilly reales en español (GZBP, GZBZ, GZBO,
GZQD; 170–217 páginas). Dos bugs encontrados y corregidos:

1. **`maxTokens` explícito (16k).** El default del AI SDK (4096) trunca el
   JSON de secciones grandes (SoA con 25+ visitas, 44 criterios de
   exclusión) y el grupo entero falla validación con "response did not
   match schema".
2. **`[ \t]+` en vez de `\s+` en los patrones de heading.** `\s` cruza
   saltos de línea: el número de página suelto `53\n` matcheaba
   `^5\.?3\.?\s+` y cerraba la sección de elegibilidad en la página del
   heading 5.2 — las exclusiones quedaban fuera del contexto y el modelo
   devolvía 0 sin error.

Resultado post-fix (cero warnings en los 4):

| Protocolo | Inclusión | Exclusión | Endpoints | Visitas |
|-----------|-----------|-----------|-----------|---------|
| GZBP      | 7         | 44        | 38        | 25      |
| GZBZ      | 9         | 31        | 37        | 28      |
| GZBO      | 8         | 35        | 14        | 35      |
| GZQD      | 11        | 48        | 33        | 23      |

## Persistencia versionada

`packages/db/schema/study-specs.ts` + `packages/ingestion/spec-store.ts`:

- `version` incrementa por estudio en cada extracción. El diff entre
  versiones es la base del análisis de enmiendas.
- Ciclo de vida: nace `draft` SIEMPRE → aprobación humana lo pasa a
  `approved` y marca la anterior `superseded`. La extracción LLM nunca
  produce un spec operativo sin revisión.
- `extraction_model` se persiste por trazabilidad regulatoria.
- El caller resuelve `orgId` desde el token (nunca del input del cliente) y
  valida acceso al study antes de llamar — mismo contrato que el resto del
  pipeline de ingestion.

## Fuera de alcance de esta fase

- Endpoint HTTP / integración con el pipeline de ingestion (el extractor no
  persiste; expone `extractStudySpec` + `saveStudySpec` para la capa que siga).
- UI de revisión/aprobación del spec.
- Diff entre versiones (análisis de enmiendas).
