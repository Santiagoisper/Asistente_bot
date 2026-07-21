# SD — Scheduler para recuperación de stuck docs

**Diseño para ejecutar en sesión nueva (mount fresco).** Plan Vercel: **Hobby**.

## Objetivo
`checkAndRecoverStuckDocs()` (ya existe en `packages/ingestion/pipeline.ts`, idempotente)
corre sola cada hora en vez de a mano, para recuperar document versions atascadas en
`status='processing'` por crash de worker.

## Arquitectura
Scheduler externo → endpoint con auth → función existente.
En Hobby, los crons nativos de Vercel corren **máx 1 vez/día**, así que para frecuencia
horaria usamos **GitHub Actions** (gratis) que le pega al endpoint. El endpoint es el mismo
en cualquier caso.

---

## Pieza 1 — Endpoint nuevo
`ichtys/apps/web/app/api/cron/recover-stuck-docs/route.ts`

```ts
import { NextResponse } from 'next/server'
import { checkAndRecoverStuckDocs } from '@ichtys/ingestion'

export const runtime = 'nodejs'        // DB access, no puede ser edge
export const dynamic = 'force-dynamic'  // nunca cachear

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const threshold = Number(process.env.STUCK_DOCS_THRESHOLD_MINUTES ?? 60)
  try {
    const result = await checkAndRecoverStuckDocs(threshold)
    return NextResponse.json({ ok: true, threshold, result })
  } catch (err) {
    console.error('[cron/recover-stuck-docs]', err)
    return NextResponse.json({ ok: false, error: 'recovery failed' }, { status: 500 })
  }
}
```

> Verificar en la sesión nueva: el path de export real de `checkAndRecoverStuckDocs`
> (mirar cómo lo importa `scripts/fix-stuck-docs.ts`) y su tipo de retorno.

## Pieza 2 — Scheduler horario (GitHub Actions — recomendado para Hobby)
`.github/workflows/recover-stuck-docs.yml`

```yaml
name: recover-stuck-docs
on:
  schedule:
    - cron: '0 * * * *'      # cada hora (puede demorarse bajo carga de GH)
  workflow_dispatch: {}       # permite dispararlo a mano
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Call recovery endpoint
        run: |
          curl -fsS -X GET \
            "https://asistente-bot-five.vercel.app/api/cron/recover-stuck-docs" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

## Pieza 2b — Alternativa simple (cron nativo Vercel, diario)
Si no querés el workflow, agregá a `ichtys/vercel.json` (mergear la key, no reescribir):

```json
"crons": [
  { "path": "/api/cron/recover-stuck-docs", "schedule": "0 3 * * *" }
]
```
En Hobby esto corre 1 vez/día (03:00 UTC). Menos frecuente que Actions, pero cero setup extra.

## Pieza 3 — Secret compartido
Generá un secret: `openssl rand -hex 32`

- **Vercel:** Project → Settings → Environment Variables → `CRON_SECRET` = <secret> (production).
- **GitHub (si usás Actions):** repo → Settings → Secrets and variables → Actions →
  New repository secret → `CRON_SECRET` = <mismo secret>.

Ambos lados comparten el mismo valor: el endpoint valida el header, el scheduler lo manda.

---

## Verificación (sesión nueva)
- [ ] Confirmar export/retorno de `checkAndRecoverStuckDocs` contra `scripts/fix-stuck-docs.ts`.
- [ ] `curl` sin Bearer → 401; con Bearer correcto → 200 + JSON con el resultado.
- [ ] Disparar el workflow con `workflow_dispatch` y ver 200 en los logs.
- [ ] `pnpm build` OK.
- [ ] Commit: `feat(ingestion): cron horario de recuperación de stuck docs (SD)`.

## Decisión pendiente
GitHub Actions (horario, gratis) vs cron nativo Vercel (diario). Recomendado: **Actions**,
porque venís de un crash y una red de seguridad horaria vale más que una diaria.
