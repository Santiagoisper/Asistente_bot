## Learned User Preferences

- Responder siempre en español.
- El usuario prefiere que el agente ejecute las tareas directamente (p. ej. "hacelo vos") en lugar de pedirle que corra pasos manuales.
- Hacer commits git solo cuando el usuario lo pide explícitamente.
- Al implementar un plan adjunto, no editar el archivo del plan.
- Para estilos y paleta de UI, usar como referencia https://www.ichtys.com.ar/.
- Antes de commit/push/deploy, correr la batería completa de tests; el usuario espera ≥60 tests unitarios pasando.

## Learned Workspace Facts

- El monorepo Ichtys (asistente documental clínico con RAG) vive bajo `ichtys/` (pnpm/turbo, Next.js 15, Clerk, Neon/pgvector, Vercel); el repo raíz es contenedor del código.
- Remote GitHub: `Santiagoisper/Asistente_bot`; rama default `main`.
- CI en `.github/workflows/` (`working-directory: ichtys`); deploy prod en `https://asistente-bot-five.vercel.app` (proyecto `asistente-bot`, config `ichtys/vercel.json`); push a `main` dispara build automático.
- Runbooks MVP/piloto interno: `ichtys/docs/OPERATIONS.md` y `ichtys/docs/evals/pilot-cinme-checklist.md`.
- En PowerShell (Windows), evitar encadenar comandos con `&&`; usar `;` y comprobar `$LASTEXITCODE`.
- Las migraciones Drizzle **NO se aplican automáticamente** en el deploy de Vercel; hay que correrlas manualmente contra Neon (`fragrant-sun-79639780`, proyecto `Asistente_bot`) antes de promover a producción (lección del incidente 2026-06-28: columna `rag_config` faltante rompió todas las queries a `organizations`).
- JIT org provisioning implementado en `POST /api/studies` y `studies/page.tsx`: si el `clerkOrgId` del token es válido pero no tiene fila en la tabla `organizations`, se auto-provisiona en lugar de retornar 403.
- En Vercel production, las variables Clerk deben ser claves de producción (`pk_live_`/`sk_live_`), no development (`pk_test_`/`sk_test_`).
- Proveedor LLM multi-tenant en `@ichtys/llm`: `LLM_PROVIDER=auto` (Claude → OpenAI → Gemini → Groq → GLM; salta proveedores sin key); keys por org cifradas (`organizations.llm_api_keys_encrypted`, `ORG_LLM_KEYS_ENCRYPTION_SECRET`, migración `0005`); preferencia en `organizations.rag_config.llmProvider`; UI en `/settings` (`/api/org/settings`). Embeddings siguen en OpenAI.
- Extracción de specs: localizador semántico usa `samplePageTextForMap` para saltar headers repetidos (p. ej. Sanofi); re-extract (`POST .../spec/reextract`) es síncrono con errores visibles; bulk import (`/studies/import`) puede dejar specs parciales — re-extraer manualmente.
- Chat con documento `ready` pero respuesta «evidencia insuficiente» suele ser retrieval (pregunta muy corta o similitud bajo umbral), no fallo de upload; ver `query-expander` y umbral en `rag_config`.
- Módulo clínico (Fase 0–2.5): tablas `subjects`/`clinical_evolutions`/`patient_profiles` (`0006`), `screening_assessments` (`0007`); PHI cifrado en reposo (`@ichtys/crypto`); extracción de perfil con pre-redacción PHI antes del LLM (`phi-redact`, `extract-merge` en `@ichtys/clinical`); badges de confianza en UI; trust center público en `/trust`; rutas bajo estudios.
