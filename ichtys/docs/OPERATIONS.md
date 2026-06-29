# OPERATIONS — Ichtys MVP Interno

Runbook operativo para despliegue, validación y respuesta rápida en el piloto interno.

## 1) Deploy de preview (staging)

1. Verificar branch objetivo:
   - `git checkout main`
   - `git pull --ff-only`
2. Ejecutar deploy de preview:
   - `cd ichtys`
   - `vercel --yes`
3. Confirmar estado `READY` en Vercel Inspector.
4. Verificar protección de entorno:
   - La URL preview puede responder `401` sin sesión (esperado).
5. Smoke mínimo:
   - Login Clerk
   - Abrir `/studies`
   - Abrir un estudio
   - Subir un PDF
   - Preguntar en chat y abrir al menos una cita

## 2) Deploy de producción

1. Confirmar CI verde en `main`.
2. Confirmar eval gate y smoke 10A en staging.
3. Promover:
   - `cd ichtys`
   - `vercel --prod --yes`
4. Verificar acceso y flujos críticos en producción.

## 3) Rollback rápido

1. Abrir Vercel Deployment History.
2. Identificar último deployment `READY` estable.
3. Promover deployment anterior a producción.
4. Re-ejecutar smoke mínimo de sección 1.
5. Registrar incidente en issue interno con causa y fix.

## 4) Re-ingest de documentos

Cuando un documento queda en `error` o con chunks inconsistentes:

1. Reintentar desde UI (`/studies/:id/documents`).
2. Si persiste:
   - validar estado en `GET /api/documents/:id/status`
   - revisar logs de ingestion
3. Si hay deuda de embeddings/index:
   - usar scripts en `scripts/reindex-chunks.ts`, `scripts/reindex-hnsw.ts` o `scripts/re-embed-study.ts` (solo operador técnico).

## 5) Eval gate manual (obligatorio pre-piloto)

Prerequisitos:
- `EVAL_STUDY_ID`
- `EVAL_AUTH_COOKIE` (cookie Clerk fresca)
- servidor con `ENABLE_INTERNAL_RAG_ANSWER_TEST=true`

Comando:

```bash
cd ichtys
EVAL_STUDY_ID=<study_uuid> \
EVAL_AUTH_COOKIE="<cookie>" \
EVAL_BASE_URL=<staging_or_local_url> \
pnpm --filter @ichtys/evals evals:mock-metabolic
```

Criterios bloqueantes:
- 0 leakage cross-tenant/cross-study
- SM-011 y SM-012 en `insufficient_evidence`
- Sin respuestas inventadas de confianza alta/media

Artefactos:
- `packages/evals/docs/evals/results/eval-results-<runId>.json`
- `packages/evals/docs/evals/results/eval-results-<runId>.csv`

## 6) Smoke 10A manual

Seguir:
- `docs/decisions/phase-10a-smoke-test.md`
- `docs/evals/mock-metabolic-smoke-test-runbook.md`

Salida requerida:
- CSV completo de los 12 casos
- Resultado global: `PASS` / `WARN` / `FAIL`

## 7) Pilot readiness checklist

Antes de abrir piloto de 5 usuarios:

- [ ] `main` estable y sin PRs críticos abiertos
- [ ] CI verde (typecheck/lint/test)
- [ ] Preview/staging `READY`
- [ ] Upload 50MB validado
- [ ] Viewer de citas validado en apertura y página correcta
- [ ] Eval gate PASS
- [ ] Smoke 10A manual completo

## 8) Contacto de escalamiento

Cuando falle un bloqueante:
- Seguridad/leakage: detener release y escalar inmediato.
- Build/deploy: escalar a owner de infraestructura.
- Calidad clínica: escalar a reviewer clínico del piloto.

---

## 9) Migraciones de base de datos (CRÍTICO — lección del incidente 2026-06-28)

Las migraciones Drizzle **NO se aplican automáticamente** en el deploy de Vercel.
Cada vez que se agrega o modifica el schema Drizzle, se debe ejecutar el siguiente paso **antes** de deployar a producción:

```bash
# Verificar qué migraciones están pendientes (solo lectura)
cd ichtys
pnpm --filter @ichtys/db drizzle-kit status

# Aplicar migraciones pendientes contra la DB de prod
# IMPORTANTE: requiere DATABASE_URL apuntando a prod (usar con cuidado)
pnpm --filter @ichtys/db drizzle-kit migrate
```

**Checklist pre-deploy cuando hay cambios de schema:**

- [ ] Revisar `packages/db/migrations/meta/_journal.json` — ¿hay entradas nuevas?
- [ ] Aplicar migración en staging primero, verificar funcionamiento
- [ ] Aplicar migración en producción ANTES de promover el deploy
- [ ] Confirmar con `SELECT column_name FROM information_schema.columns WHERE table_name = '<tabla>'`

**Referencia del incidente:** commit `39832d8` agregó `organizations.rag_config` pero la migración `0003_org_rag_config.sql` no fue aplicada en prod, causando un error `403` en Server Components que leen `organizations`. Fix: `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "rag_config" jsonb;` ejecutado manualmente.

---

## 10) Roadmap de features pendientes (estado al 2026-06-28)

### Implementado y en producción

| Feature | Descripción |
|---|---|
| FW — Few-shot seed | Ejemplos de specs aprobadas alimentan el extractor |
| SD — Stuck docs recovery | `checkAndRecoverStuckDocs()` limpia docs trabados |
| EV — Edición inline | Endpoints y visitas editables desde spec-review |
| T4 — Auto-title | Haiku genera títulos para conversaciones nuevas vía SSE |
| T1 — SNOMED re-anotación | Re-computa chips SNOMED/LOINC post-edición de criterio |
| T2 — Per-org RAG config | `organizations.rag_config` permite tuning de threshold y topK por org |

### Pendiente (en orden de prioridad/dependencia)

#### T3 — Spec version diff
- **Qué:** Comparar dos versiones de un spec para detectar cambios de criterios/endpoints/visitas.
- **Por qué:** Base para enmiendas (E2). Un diff legible permite al PI ver exactamente qué cambió al actualizar el protocolo.
- **Dependencias:** Requiere que `study_specs` tenga múltiples versiones por estudio (ya soportado via `version` int).
- **Estimación:** 1–2 días. Implementar `diff-spec.ts` + UI en `/studies/[id]/spec/diff`.

#### E1 — Filtrado por tipo de documento en chat
- **Qué:** Permitir al usuario filtrar la búsqueda RAG por tipo de documento (protocolo, IB, manual de laboratorio, etc.).
- **Por qué:** La UI de chat tiene un selector de tipo de documento, y el backend (`POST /api/chat/stream`) ya acepta `documentType` en el body. Solo falta conectar el selector en la UI con el parámetro de la llamada.
- **Dependencias:** Ninguna — el backend está listo.
- **Estimación:** 0.5 días. Wiring de `documentType` selector → request body en `chat-client.tsx`.

#### E3 — Export del spec aprobado (PDF/Word)
- **Qué:** Botón "Exportar spec" que genera un PDF o Word con el spec estructurado (criterios, endpoints, visitas) del spec aprobado.
- **Por qué:** Los monitors y el PI necesitan compartir el spec en formato imprimible para revisión regulatoria.
- **Dependencias:** Ninguna.
- **Estimación:** 1–2 días. Usar `@react-pdf/renderer` o exportación a Word vía `docx` npm.

#### E2 — Enmiendas de protocolo
- **Qué:** Cuando se sube una nueva versión del protocolo, detectar automáticamente cambios respecto al spec aprobado anterior, y presentar un flujo de revisión de enmiendas.
- **Por qué:** En investigación clínica, las enmiendas son eventos formales que requieren documentación y aprobación. Un flujo asistido reduce errores de omisión.
- **Dependencias:** T3 (spec version diff) debe estar implementado primero.
- **Estimación:** 3–5 días (incluye UI de revisión de enmiendas + persistencia).
