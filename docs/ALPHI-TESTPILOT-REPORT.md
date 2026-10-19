# Informe Testpilot — OPERACIÓN ALPHI 2.0 (FASE 0 + FASE 1)

- **Slot**: 05 — testpilot (GLM)
- **Fecha**: 2026-10-19 (re-verificado 13:44 UTC — ver §0)
- **Repo**: Asistente_bot (ichtys/apps/web)
- **Rama**: `feature/alphi-2.0-visual-redesign` (main intacto, sin commits ni push)
- **Alcance**: verificación (build / test / typecheck / capturas visuales) + auditoría de FASE 0 y estado del design system de FASE 1
- **Archivos modificados por este slot**: solo este informe y `docs/capturas/*.png`

---

## 0. Re-verificación (13:43–13:44 UTC)

El builder (slot 03) editó el árbol **en vivo** entre 13:22 y 13:37 mientras yo verificaba. Este informe refleja el estado del árbol a las **13:44 UTC**: re-corregí typecheck y tests sobre el árbol final, y la réplica para capturas se construyó a las 13:33 (incluye todo lo anterior a eso). Los hallazgos H1, H2, H3 y H6 marcados abajo como **RESUELTO** lo están *en árbol sin commitear* (H8 sigue en pie).

---

## 1. Tríada de verificación (FASE 0)

| Verificación | Comando | Resultado |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ PASS (exit 0, re-corrido 13:43 UTC sobre árbol final) |
| Tests | `npx vitest run` | ⚠️ 270 pass · 1 fail · 4 skip (re-corrido 13:44 UTC sobre árbol final) |
| Build | `npx next build` | ✅ PASS (con `DATABASE_URL` sintético — ver hallazgo H5; réplica de capturas compilada 13:33) |

### 1.1 Tests — detalle

- **Línea base previa**: 212 pass. **Primera corrida (13:22)**: 250. **Árbol final (13:44)**: **270 pass** → **+58 en total**, en tres suites nuevas del builder:
  - `lib/__tests__/visit-window.test.ts` (38): contrato básico (4), falla cerrada (9), invariantes (25 = 5 anchors × 5 combos: orden, ISO, determinismo, ancho).
  - `lib/__tests__/alphi-tokens.test.ts` + `lib/__tests__/asim.test.ts` (20 en conjunto): guard de deriva de la paleta (H2) y porte del validador ASIM desde Asistente-CRF (H3). Ambas verdes.
- **El único fail es preexistente** y no fue causado por el trabajo de ALPHI 2.0: `tests/leakage/api-auth-coverage.test.ts:127` — la ruta `/` es pública en el middleware (commit dac43eb, GTM) pero no está en la lista `EXPECTED_PUBLIC_ROUTES` del tripwire (última edición c40adbb). Igual fallaba antes de esta rama. Ver H4.
- Los 4 skip son deliberados (suites que requieren entorno/credenciales, sin cambios respecto de la base).

### 1.2 Build — detalle

- Primer intento **falla**: `Error: DATABASE_URL is not set. See .env.example.` durante "Collecting page data" (import de DB a nivel módulo en `/api/studies/[id]/specs`). En este host `.env.local` está vacío.
- Reintento con valor sintético (sin credenciales reales): `DATABASE_URL="postgresql://synthetic:synthetic@localhost:5432/synthetic" npx next build` → **exit 0**. Turbopack, compilado en 7.1 s.
- Manifiesto de rutas: `/calidad`, `/consulta`, `/jornada`, `/visita` generadas. **`/protocolo` ya existe** en el árbol final (creada por el builder 13:23:59; servida con HTTP 200 en la réplica de capturas — antes era 404, H1).

---

## 2. Auditoría FASE 1 — estado del design system

### 2.1 Lo que existe

| Pieza | Estado | Ubicación |
|---|---|---|
| Paleta Tailwind `alphi` (navy `#0D1F3C`, teal `#0891B2`, sage, amber, rose, slate, border, muted) + sombras + animaciones | ✅ Commiteada (HEAD) | `tailwind.config.ts` |
| Tokens CSS (`@layer base`, variables `--alphi-*`) + tipografía + scrollbar | ⚠️ Sin commitear (cambios del builder en curso) | `app/globals.css` |
| Librería de componentes: `.alphi-card`, `.alphi-btn-primary/secondary/ghost`, `.alphi-input`, `.alphi-label`, `.alphi-pill`, `.alphi-typing-dot`, `.alphi-footnote`, `.alphi-answer-text` | ⚠️ Sin commitear | `app/globals.css` |
| Overrides de Clerk (popovers forzados a paleta ALPHI) | ⚠️ Sin commitear | `app/globals.css` |
| Nav nueva (jornada / protocolo / visita / consulta / calidad) | ⚠️ Sin commitear | `app/(app)/layout.tsx` |
| Páginas nuevas: jornada (9 líneas), visita (12), consulta (9), calidad (9) | ⚠️ Sin commitear | `app/(app)/*/page.tsx` |
| Página `/protocolo` + primera adopción de la librería (`.alphi-card`, `.alphi-label`) | ⚠️ Sin commitear (nueva 13:23:59) | `app/(app)/protocolo/page.tsx` |
| Guard de deriva de paleta (globals.css ⇄ tailwind.config.ts) | ⚠️ Sin commitear (nueva 13:37) | `lib/__tests__/alphi-tokens.test.ts` |

### 2.2 Adopción real (medición, árbol final 13:44)

- jornada / visita / consulta / calidad usan **solo 3 clases alphi cada una**: `bg-alphi-slate` (fondo), `text-alphi-navy` (título), `text-alphi-muted` (subtítulo). Son esqueletos de prototipo, todas con "datos sintéticos".
- **`/protocolo` es el primer consumidor real de la librería**: usa `.alphi-card` y `.alphi-label` (antes la librería no tenía adoptantes).
- `/visita` ya consume el motor de ventanas: muestra `visitWindow?.windowStart – windowEnd` (integración real, no maqueta).
- **Las variables soft** (`--alphi-violet-soft`, `--alphi-green-soft`, `--alphi-blue-soft`, `--alphi-amber-soft`, `--alphi-rose-soft`) siguen definidas y **sin ningún uso** en `app/` ni `components/`.
- **El design system ahora tiene red**: `alphi-tokens.test.ts` fija la paleta y falla si `globals.css` y `tailwind.config.ts` divergen (responde a H2 y al gap de "sin tests de design system" de la primera corrida).

### 2.3 Veredicto FASE 1 (árbol final)

**Sólidamente empezada y saneada**: paleta unificada con guard (H2 resuelto), librería con primer consumidor (`/protocolo`), motor de ventanas con 38 tests, tripwire de paleta en CI. Deuda restante: variables soft sin uso, páginas esqueleto salvo protocolo/visita, y **todo sin commitear** (H8).

---

## 3. Hallazgos

**H1 — Link roto `/protocolo` (medio). → ✅ RESUELTO en árbol sin commitear (13:23:59).** El nav de `layout.tsx` linkeaba `/protocolo` pero la ruta no existía (404 en la primera corrida). El builder creó `app/(app)/protocolo/page.tsx`; verificada con HTTP 200 en la réplica de capturas + screenshot (§6).

**H2 — Paleta doble y divergente (medio, bloqueante de FASE 1). → ✅ RESUELTO en árbol sin commitear (13:37).** Original: `globals.css` y `tailwind.config.ts` definían hex distintos para los mismos tokens (navy `#192337` vs `#0D1F3C`; teal `#6855B6` —violeta— vs `#0891B2` —cyan—; etc.). El builder unificó ambas fuentes (navy/muted ahora `#192337`/`#667085` en las dos) y agregó `lib/__tests__/alphi-tokens.test.ts` como guard de deriva: si vuelven a divergir, CI rompe. Verificado en la corrida 13:44 (20 tests nuevos verdes).

**H3 — `asim.ts` portado sin tests (medio). → ✅ RESUELTO en árbol sin commitear (13:37).** `lib/__tests__/asim.test.ts` portado desde Asistente-CRF con ajustes documentados en el propio archivo (renombrado de tipo + adaptación del caso `amendment`). Pasa en la corrida 13:44.

**H4 — Tripwire de fuga "/" (preexistente, decisión pendiente).** `/` es pública en el middleware desde el commit GTM (dac43eb) y el test de cobertura de auth la reprueba porque no está en `EXPECTED_PUBLIC_ROUTES`. No lo arreglé: elegir entre sacar `/` del middleware o autorizarla concientemente en la lista es decisión de seguridad (carril sicario/reviewer + foreman). Mientras no se resuelva, la batería queda en rojo por ese único caso.

**H5 — Build exige `DATABASE_URL` (bajo, ambiente).** La importación de DB a nivel módulo hace que `next build` falle sin la variable aunque no toque la base. En Vercel/CI está provista; en bancos de prueba hace falta exportarla (sintética alcanza). Sugerencia: documentarlo en el README del repo o mover la conexión a lazy init.

**H6 — Stamp de versión divergente (bajo, trazabilidad). → ✅ RESUELTO en árbol sin commitear (13:31).** El motor reportaba `version: '1.0.0'` mientras el prototipo canónico de Asistente-CRF reporta `'visit-window-motor v0.1.0 (TS mirror)'`. El builder alineó `lib/visit-window.ts` al stamp canónico y actualizó el test que lo pinea (`visit-window.test.ts:18`). Internamente consistente y trazable entre repos.

**H7 — Deprecación Next 16: middleware → proxy (bajo, futuro).** El build tira warning: la convención "middleware" está deprecada a favor de "proxy". No bloquea; anotado para backlog.

**H8 — Trabajo del builder sin commitear (informative).** Toda la capa visual de FASE 1 (globals.css, layout, 4 páginas) y los tests nuevos viven sin commitear en la rama feature. La suite se ejecutó y pasa (era "tests escritos pero no corridos" al momento del STOP anterior — ahora verificados). Falta el commit del builder para dejar la rama coherente.

---

## 4. Cobertura de tests — delta

| Suite | Antes | Árbol final (13:44) |
|---|---|---|
| Total repo | 212 pass / 1 fail / 4 skip | **270 pass** / 1 fail / 4 skip |
| visit-window | 0 (no existía) | 38 pass |
| alphi-tokens (guard de paleta) | 0 | ✅ verde |
| asim (porte desde CRF) | 0 | ✅ verde |

Piso de AGENTS.md (≥60 tests de unidad): 270 ✅ (el único fail es el H4, ajeno a esta rama).

---

## 5. Recomendaciones (por destinatario, actualizadas 13:44)

- **Builder (03)**: H1/H2/H3/H6 ya resueltos por él mismo — queda **commitear la capa visual** (H8) para dejar la rama coherente.
- **Architect (02)**: revisar y refrendar la unificación de paleta hecha por el builder (H2) y el stamp canónico adoptado (H6); decidir destino de las variables soft sin uso.
- **Foreman (01)**: arbitrar H4 (autorizar o revertir la ruta pública "/") — desbloquea la batería en verde. Confirmar dónde vive el master plan (no encontré `docs/ALPHI-2.0-*` en este repo; usé como referencia el de Asistente-CRF + el informe del reviewer).

---

## 6. Capturas visuales (nuevo, 13:40 UTC)

**Método.** Sin credenciales reales de Clerk disponibles (y sin permiso de usarlas), monté una **réplica efímera en `/tmp/webcap`**: copia de la app sin `middleware.ts` (guard de auth removido), construida con `DATABASE_URL` sintético y servida con `next start -p 3100`. Navegué con Chromium headless (Playwright del caché del host; librerías NSS extraídas en `/tmp` porque el sandbox no las tiene). Viewport 1440×900, fullPage. **El árbol del repo no fue tocado** para esto; la réplica se destruyó al terminar.

**Resultado** — 6 capturas en `docs/capturas/`:

| Ruta | Archivo | HTTP | Tamaño | Observación |
|---|---|---|---|---|
| /jornada | `jornada.png` | 200 | 63.9 KB | Verificada visualmente: página real estilizada, nav ALPHI, tarjetas con datos sintéticos |
| /visita | `visita.png` | 200 | 66.9 KB | — |
| /consulta | `consulta.png` | 200 | 57.5 KB | — |
| /calidad | `calidad.png` | 200 | 59.5 KB | — |
| /protocolo | `protocolo.png` | 200 | 59.8 KB | Nueva página del builder (H1) renderizando |
| /sign-in | `sign-in.png` | 200 | **5.8 KB** | **Cuerpo vacío**: sin claves reales de Clerk el componente no dibuja. La captura documenta el estado, no es un render del login real |

- `/` (landing) **no capturada**: en la réplica devuelve 500 (necesita más variables de entorno que no tengo). Registrado tal cual.
- Las capturas reflejan el árbol a las 13:33–13:40 UTC (incluye las ediciones del builder hasta 13:31; el guard de paleta de 13:37 no cambia pixeles).

---

*Generado por testpilot slot 05. Datos sintéticos; sin deploy; sin push a main; sin invención de evidencia.*
