# PRD — Ichtys Clinical Document Assistant
## MVP v1.0

**Fecha**: Junio 2026
**Owner**: CINME / Innova Trials
**Estado**: En desarrollo

---

## 1. Propósito

Ichtys es un asistente documental clínico multi-tenant que responde preguntas operacionales en lenguaje natural sobre documentos de estudio (protocolo, IB, manual de laboratorio, manual de farmacia), devolviendo respuestas grounded con citas exactas al documento fuente.

El producto reduce el tiempo que equipos de sitio pierden buscando en documentos de 200–400 páginas durante screening, visitas, manejo de muestras, safety reporting y cierre de estudios.

**Referencia de mercado**: Peter the Protocol Reader (Care Access / Reify Health). Ichtys apunta a superar ese benchmark en precisión de citas, trazabilidad y profundidad clínica para estudios metabólicos y cardiometabólicos en LATAM.

---

## 2. Problema

Los equipos de sitio (CRCs, nurses, PIs, monitors) pierden tiempo crítico buscando respuestas en documentos fragmentados y extensos durante operaciones en vivo. El dolor es mayor cuando:

- Un paciente está en sala y la coordinadora no puede salir a buscar en el protocolo
- Un monitor pide evidencia de dónde sale una decisión operacional
- Un sitio onboarda staff nuevo que no conoce el estudio
- Hay un evento adverso y hay que verificar el timeline de reporte en minutos

---

## 3. Usuarios

### Usuarios primarios (usan el producto a diario)
| Rol | Necesidad central |
|---|---|
| Research Assistant / soporte de sitio | Orientación rápida sobre tareas de visita y ubicación de documentos |
| Clinical Research Coordinator (CRC) | Respuestas rápidas de elegibilidad, visita, labs, medicación concomitante |
| Research Nurse | Instrucciones de manejo de muestras, timing, procedimientos |
| Site Manager | Consistencia del equipo, onboarding, reducción de carga operacional |

### Usuarios secundarios
| Rol | Necesidad central |
|---|---|
| PI / Sub-I | Verificación rápida de protocolo y reglas de seguridad con evidencia |
| Monitor / CRA | Validar que las respuestas tienen fuente trazable |
| Sponsor / Network Admin | Gobernanza, métricas de adopción, aislamiento por tenant |

---

## 4. Jobs to Be Done (priorizados)

1. **Elegibilidad**: determinar criterios de inclusión/exclusión durante screening
2. **Pre-visita**: confirmar instrucciones específicas de visita antes o durante la misma
3. **Medicación prohibida**: verificar si un medicamento está contraindicado o permitido
4. **Labs y muestras**: confirmar procesamiento, envío, timing de muestras PK
5. **Safety reporting**: verificar obligaciones y timelines (SAE, SUSAR)
6. **Preparación monitor**: responder preguntas de monitoreo y closeout

---

## 5. Propuesta de valor

> El asistente responde solo desde documentos cargados y siempre muestra la fuente exacta. Si no tiene evidencia suficiente, lo dice. La fuente trazable es el producto, no el chat.

---

## 6. Scope del MVP

### ✅ In scope
- Web app multi-tenant (organizations → studies → documents)
- Auth con roles por organización y estudio (Clerk Organizations)
- Upload de documentos PDF por estudio
- Parsing por página + chunking con metadata estructurado
- Vector search sobre contenido por org/study (pgvector en Neon)
- Chat con respuestas grounded y citas obligatorias
- Filtro estricto: las respuestas nunca mezclan documentos de distintos estudios
- Visor de citas con navegación al documento fuente
- Historial de conversaciones por estudio
- Admin básico: orgs, estudios, documentos, usuarios
- Audit log completo

### ❌ Out of scope v1
- App móvil nativa
- OCR para PDFs escaneados de baja calidad
- Integración con EDC / CTMS / eSource
- Hybrid retrieval y reranking avanzado
- Agentes autónomos de múltiples pasos
- Notificaciones push

---

## 7. Requisitos funcionales

### 7.1 Auth y tenancy
- Login / signup con Clerk
- Organización activa: cada sesión opera dentro de una org
- Roles: `org_admin`, `study_admin`, `site_coordinator`, `principal_investigator`, `read_only_monitor`
- Todo acceso a datos validado server-side por org y estudio
- Invitaciones por email a miembros

### 7.2 Ingestion documental
- Upload PDF (máx 50MB por documento)
- Tipos: `protocol`, `investigator_brochure`, `lab_manual`, `pharmacy_manual`, `other`
- Pipeline: upload → store → parse por página → chunk → embed → indexar
- Chunking: section-aware si hay headings; fallback token window 800–1200 tokens con overlap
- Metadata por chunk: `organization_id`, `study_id`, `document_id`, `document_version_id`, `document_type`, `page_start`, `page_end`, `section_title`
- Versionado: cada re-upload genera nueva `document_version`; se mantiene el historial
- Estado de procesamiento visible para el usuario

### 7.3 Retrieval
- Embeddings almacenados en Neon + pgvector
- Búsqueda semántica filtrada por `organization_id` + `study_id` (nunca sin filtro)
- Top-k configurable; score threshold mínimo
- Aislamiento entre tenants verificado en tests automatizados

### 7.4 Answer engine
- Responde **solo** desde chunks recuperados
- Salida JSON estructurada: `{ answer, confidence, citations[], retrieved_chunk_count }`
- Niveles de confianza: `high`, `medium`, `low`, `insufficient_evidence`
- Si `insufficient_evidence`: no inventa — devuelve mensaje explícito
- Citas incluyen: document_name, document_type, page_start, page_end, section_title, excerpt

### 7.5 UX de citas
- Cada respuesta muestra footnotes numerados
- Click en footnote → panel de fuente con excerpt
- Botón para navegar al PDF en la página citada
- PDF viewer con highlight de la sección relevante

### 7.6 Audit
- Log de: uploads, procesamiento, preguntas, fuentes recuperadas, respuestas, acciones admin
- Asociado a: user_id, org_id, study_id, timestamp, action_type
- Inmutable (append-only)

---

## 8. Requisitos no funcionales

| Requisito | Target |
|---|---|
| Latency respuesta P90 | < 4 segundos |
| Leakage entre tenants | 0% (bloqueante para release) |
| Uptime | 99.5% |
| Tamaño PDF máximo | 50 MB |
| Estudios concurrentes por org | Sin límite en MVP |
| PDFs por estudio | Sin límite en MVP |

---

## 9. Métricas de éxito

### Producto
- Median answer time
- % de respuestas con ≥ 1 cita válida (target: >90%)
- % de sesiones donde el usuario abre una cita (proxy de confianza)
- WAU por estudio activo

### Calidad técnica
- Grounded answer rate
- Citation correctness rate (eval set)
- Cross-tenant leakage rate (target: 0%)
- Cross-study leakage rate (target: 0%)

---

## 10. User stories prioritarias

1. Como CRC, quiero preguntar si un paciente con HbA1c > 9% cumple criterios durante screening para no tener que buscar en 300 páginas.
2. Como CRC, quiero las instrucciones específicas de la visita 4 antes de que entre el paciente.
3. Como nurse, quiero saber cómo procesar y enviar muestras PK con la cita exacta del manual de laboratorio.
4. Como PI, quiero verificar el timeline de reporte de un SAE con la fuente del protocolo.
5. Como monitor, quiero ver de dónde viene cada respuesta para validar la información durante la visita.

---

## 11. Principios de UX

- Mobile-friendly first (coordinadores en el piso, no solo en escritorio)
- Respuesta concisa primero, fuente expandible
- Si hay incertidumbre, decirlo claramente — nunca aparentar certeza
- Optimizar para confianza, no para impresionar

---

## 12. Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js App Router + TypeScript + Tailwind |
| Chat / Streaming | Vercel AI SDK |
| Hosting | Vercel |
| Database | Neon Postgres |
| Vector search | pgvector (en Neon) |
| File storage | Vercel Blob |
| Auth / Multi-tenant | Clerk Organizations |
| Source control | GitHub |
| CI/CD | GitHub Actions + Vercel |

---

## 13. Modelo comercial (hipótesis v1)

- **Unidad de pricing**: por estudio activo o por sitio/red — no por usuario individual
- **Buyer**: sponsor, CRO, o red de sitios — no el coordinador
- **Acceso al usuario final**: gratuito con credenciales provistas por el buyer
- Pricing negociado por contrato (no self-serve en v1)

---

## 14. Decisiones no patear

- Tenant isolation desde el día 1
- Cita obligatoria desde el día 1
- Audit log desde el día 1
- Dataset de evaluación clínica desde el día 1

## 15. Decisiones postergar

- OCR complejo para scans de baja calidad
- Hybrid retrieval / reranking avanzado
- App móvil nativa
- Integraciones EDC/CTMS/eSource
- Workflows agentic multi-step
