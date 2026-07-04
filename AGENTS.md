## Learned User Preferences

- Responder siempre en español.
- El usuario prefiere que el agente ejecute las tareas directamente (p. ej. "hacelo vos") en lugar de pedirle que corra pasos manuales.
- Hacer commits git solo cuando el usuario lo pide explícitamente, **excepto al cerrar una fase de producto**: ahí el agente debe auditar, commitear, pushear a `main` y desplegar a prod sin pedir confirmación intermedia.
- Al cerrar cualquier fase de producto: **auditoría completa → reporte de auditoría/pruebas → commit → push `main` → deploy prod** (`pnpm validate:product`, `pnpm iq:check`, `pnpm verify:phi-prod`, `vercel --prod --yes`). Ver `ichtys/docs/OPERATIONS.md` §2.
- Commitear por feature al terminarla; evitar acumular cambios sin commit en el working tree.
- Al implementar un plan adjunto, no editar el archivo del plan.
- Prioridad actual: desarrollo del producto final (ingeniería Etapa 2+), no preparación de demos/pitch.
- Metodología de trabajo: implementar → probar → corregir en loop hasta verde → seguir con la siguiente fase (misma lógica).
- Para estilos y paleta de UI, usar como referencia https://www.ichtys.com.ar/.
- Antes de commit/push/deploy, correr la batería completa de tests; el usuario espera ≥60 tests unitarios pasando.
- En pitch/demo/inversores: comunicación honesta — sin claims de «certificado Part 11», conteos de usuarios inventados ni certificaciones formales inexistentes; framing correcto = «framework de compliance alineado, validación formal en progreso».

## Learned Workspace Facts

- Producto comercial **ALPHI** (asistente documental clínico con RAG); monorepo en `ichtys/` (pnpm/turbo, Next.js 15, Clerk, Neon/pgvector, Vercel); el repo raíz es contenedor del código.
- Remote GitHub: `Santiagoisper/Asistente_bot`; rama default `main`.
- CI en `.github/workflows/` (`working-directory: ichtys`); deploy prod en `https://asistente-bot-five.vercel.app` (proyecto `asistente-bot`, config `ichtys/vercel.json`); push a `main` dispara build automático; cron `recover-stuck-docs` en `/api/cron/*` (auth `CRON_SECRET`, ruta excluida de Clerk en middleware) requiere el secret en Vercel y GitHub Secrets; Etapa 0 cerrada (T2 sliders RAG en `/settings`, SD cron, `PHI_ENCRYPTION_KEY` en prod Vercel); runbooks en `ichtys/docs/OPERATIONS.md`.
- En PowerShell (Windows), evitar encadenar comandos con `&&`; usar `;` y comprobar `$LASTEXITCODE`.
- Las migraciones Drizzle **NO se aplican automáticamente** en el deploy de Vercel; hay que correrlas manualmente contra Neon (`fragrant-sun-79639780`, proyecto `Asistente_bot`) antes de promover a producción (lección del incidente 2026-06-28: columna `rag_config` faltante rompió todas las queries a `organizations`).
- JIT org provisioning implementado en `POST /api/studies` y `studies/page.tsx`: si el `clerkOrgId` del token es válido pero no tiene fila en la tabla `organizations`, se auto-provisiona en lugar de retornar 403.
- En Vercel production, las variables Clerk deben ser claves de producción (`pk_live_`/`sk_live_`), no development (`pk_test_`/`sk_test_`).
- Proveedor LLM multi-tenant en `@ichtys/llm`: `LLM_PROVIDER=auto` (Claude → OpenAI → Gemini → Groq → GLM; salta proveedores sin key); keys por org cifradas (`organizations.llm_api_keys_encrypted`, `ORG_LLM_KEYS_ENCRYPTION_SECRET`, migración `0005`); preferencia en `organizations.rag_config.llmProvider`; UI en `/settings` (`/api/org/settings`); embeddings en prod con `EMBEDDING_PROVIDER=openai` (Groq nomic-embed retirado).
- Org de trabajo única **INNOVA TRIALS** (`DEMO_ORG_ID`/`DEMO_CLERK_ORG_ID` en `scripts/lib/mock-demo-constants.ts`); estudio demo `MOCK-METABOLIC-T2D-v1`; limpiar orgs extras en Neon con `pnpm orgs:consolidate -- --confirm`.
- Scripts de validación producto: `pnpm validate:product`, `pnpm validate:product:ci`, `pnpm test:integration`, `pnpm e2e:product`, `pnpm evals:direct`, `pnpm test:oq` (29 tests), `pnpm iq:check`, `pnpm verify:phi-prod`.
- Troubleshooting RAG: extracción de specs **siempre Claude** (`SPEC_EXTRACTION_LLM_PROVIDER=anthropic`), independiente del LLM de chat en `/settings`; modelo `SPEC_EXTRACTION_MODEL` (default claude-sonnet-4-6); re-extract síncrono; bulk import puede dejar specs parciales si falló en ingestion; chat con doc `ready` pero «evidencia insuficiente» suele ser retrieval (pregunta corta o umbral en `rag_config`, ver `query-expander`).
- Módulo clínico (Fase 0–2.5): tablas `subjects`/`clinical_evolutions`/`patient_profiles` (`0006`), `screening_assessments` (`0007`); PHI cifrado en reposo (`@ichtys/crypto`); pre-redacción PHI antes del LLM (`phi-redact`, `extract-merge` en `@ichtys/clinical`); badges de confianza en UI; rutas bajo estudios.
