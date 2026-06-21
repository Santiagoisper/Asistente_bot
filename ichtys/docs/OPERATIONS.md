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
