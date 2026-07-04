# Verificación pre-presentación (T-3)

Checklist del plan de pitch — marcar manualmente antes de la reunión con inversores.

## Build y código

- [x] `pnpm typecheck` OK
- [x] `pnpm build` OK
- [x] Páginas GTM públicas en build: `/pricing`, `/trust`, `/terms`, `/privacy`, `/roi`

## Demo tenant

- [ ] `pnpm demo:setup` (requiere `DATABASE_URL` + `OPENAI_API_KEY`)
- [ ] SM-001–006 responden con citas (manual o `pnpm evals:mock-metabolic -- --filter SM-001,...,SM-006`)
- [ ] Video Plan B grabado (ver `demo-recording/README.md`)

## Contenido honesto

- [x] Pitch docs sin claims inflados (revisión anti-inflación en `docs/pitch/`)
- [x] Trust center indica: no certificado Part 11, validación en progreso
- [x] Pricing sin checkout Stripe; pre-revenue declarado

## Dry-run

- [ ] 15 min demo en vivo con guion `docs/evals/demo-script.md`
- [ ] 10 min Q&A con `docs/pitch/speaker-notes.md`
- [ ] Credenciales Clerk demo en 1Password (no en repo)

## Deploy prod (opcional)

- [ ] Push + Vercel deploy con rutas GTM
- [ ] `CRON_SECRET` configurado (scheduler SD)
