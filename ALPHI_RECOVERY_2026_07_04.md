# ALPHI / ichtys — Guía de recuperación

**Fecha:** 2026-07-04
**Incidente:** Corrupción de filesystem por apagado sucio / crash de Windows.
**Diagnóstico:** Git HEAD (commit "Fase 2.5", 2026-07-03) quedó **intacto**. El trabajo
sin commitear del 2026-07-04 estaba en el cache de escritura y se dañó. Firma confirmada:
archivos con código completo + relleno de bytes NUL (0x00), y otros truncados a mitad de
token. **No es problema de código ni de git — es corrupción de disco.**

---

## Estado por archivo

### Intactos en git (HEAD)
Base limpia y compilable. Contiene EV, T1, T2 (org-config + migración 0003), FW (seed),
SD (fix-stuck-docs), y todo Fase 0–2.5.

### Archivos NUEVOS del 07-04 que SOBREVIVIERON (untracked — NO borrar)
- `apps/web/lib/spec-diff.ts` — motor de diff (T3) ✅
- `apps/web/app/api/studies/[id]/specs/route.ts` (T3) ✅ *(relleno NUL al final — recortar)*
- `apps/web/app/api/studies/[id]/specs/diff/route.ts` (T3) ✅ *(relleno NUL al final — recortar)*
- `apps/web/app/api/studies/[id]/spec/[specId]/export/route.ts` — export Word/PDF (E3) ✅
- `packages/db/migrations/0008_spec_amendment_tracking.sql` (E2) ✅

### Dañados con features del 07-04 que HEAD NO tiene (recuperar de Local History)
| Archivo | HEAD | Marcadores a verificar |
|---|---|---|
| `apps/web/components/spec/spec-review.tsx` | 42864B (bueno ~50KB) | "Comparar versiones", "AmendmentBanner", "format=docx", reAnnotateCriterion, saveEndpoint, saveVisit |
| `apps/web/components/chat/chat-client.tsx` | 33920B | StreamTitleFrame, isTitleFrame, searchScope, pills de filtro |
| `apps/web/package.json` | 1293B | `"docx": "^9.3.0"` |
| `packages/db/schema/organizations.ts` | 1971B | ragConfig (T2) |
| `packages/db/schema/study-specs.ts` | 2966B | previousApprovedSpecId (E2) |
| `packages/db/index.ts` | 694B | re-export getOrgRagConfig / updateOrgRagConfig |
| `packages/ingestion/spec-store.ts` | 4595B | previousApprovedSpecId + `.limit(20)` |
| `packages/ingestion/pipeline.ts` | 13789B | checkAndRecoverStuckDocs (SD) |
| `packages/rag/answer-engine.ts` | 24003B | similarityThreshold?, llmProviderPreference? (T2) |
| `packages/rag/medical-annotator.ts` | 45310B | annotateAnswerSync export (T1) |
| `apps/web/app/api/chat/stream/route.ts` | 14525B | orgRagConfig + documentType (T2/E1) |
| `apps/web/app/(app)/studies/[id]/spec/page.tsx` | 3870B | previousApprovedSpecId prop (E2) |

Local History de Cursor: `%APPDATA%\Cursor\User\History\`

---

## Reglas de seguridad (no negociable)

1. **Backup primero:** copiá toda la carpeta del repo a otro lado antes de tocar nada.
2. **Nunca `git clean`** — mataría los archivos nuevos untracked que sobrevivieron.
   `git reset --hard` está OK (no borra untracked); `git clean` NO.
3. Reparar git antes que nada (ver comandos abajo).
4. Corré **`chkdsk`** en el disco — el filesystem tuvo corrupción real.

---

## Comandos de git — recuperación paso a paso

```powershell
# 0. Backup (PowerShell)
Copy-Item -Recurse "C:\Users\Santiago\source\repos\Santiagoisper\Asistente_bot" `
                   "C:\Users\Santiago\source\repos\Asistente_bot_BACKUP_20260704"

# 1. Sacar el lock fantasma y restaurar el índice (fue vaciado con `git rm --cached`)
cd C:\Users\Santiago\source\repos\Santiagoisper\Asistente_bot
del .git\index.lock
git reset
git status          # debería verse normal: modificaciones + untracked, sin "deleted" masivo

# 2. Ver qué difiere de HEAD ignorando CRLF (sanity check)
git diff --stat --ignore-cr-at-eol HEAD | tail -40
```

### Detectar archivos corruptos (Node)
```bash
node -e "const cp=require('child_process');const fs=require('fs');
const t=cp.execSync('git ls-tree -r HEAD',{maxBuffer:1e9}).toString().trim().split('\n');
for(const l of t){const[m,rest]=l.split('\t');const blob=m.split(' ')[2];
let disk;try{disk=fs.readFileSync(rest)}catch{console.log('MISSING',rest);continue;}
const nul=disk.includes(0);
const head=cp.execSync('git cat-file blob '+blob,{maxBuffer:1e9});
const diff=head.toString('binary').replace(/\r\n/g,'\n')!==disk.toString('binary').replace(/\r\n/g,'\n');
if(nul||diff)console.log((nul?'NUL ':'    ')+(disk.length<head.length*0.9?'TRUNC ':'DIFF  ')+rest+' head='+head.length+' disk='+disk.length);}"
```

### Restaurar los archivos SIN features del 07-04 desde HEAD
```bash
# Para cada archivo que solo difiere de HEAD por CRLF o truncación y NO está en la tabla
# de "features del 07-04", restauralo:
git checkout HEAD -- <ruta/al/archivo>
```

### Recortar relleno NUL de los archivos untracked sobrevivientes
```bash
# Ejemplo para specs/route.ts (repetir para specs/diff/route.ts):
node -e "const fs=require('fs');const f=process.argv[1];let b=fs.readFileSync(f);
let e=b.length;while(e>0&&b[e-1]===0)e--;fs.writeFileSync(f,b.subarray(0,e));console.log('trimmed',f,'->',e)" \
  "apps/web/app/api/studies/[id]/specs/route.ts"
```

### Validación final
```bash
pnpm install        # debe resolver docx@^9.3.0
pnpm db:migrate     # aplica 0008_spec_amendment_tracking.sql
pnpm typecheck      # debe pasar sin errores
pnpm test
pnpm build
```

---

## Después: commitear enseguida
Todo este incidente existió porque 10 features vivían sin commitear en el working tree.
Cuando esté sano, **un commit por feature** (o una PR de "feature batch") y esto no
vuelve a pasar.
