# ALPHI 2.0 — Reporte Scout (slot 07, Hermes)

Misión: OPERACIÓN ALPHI 2.0 · FASE 1 (design system)
Repo: /home/companyos/company-os/repos/Asistente_bot (ichtys/)
Rama: feature/alphi-2.0-visual-redesign
Alcance: analizar referencias de UX (Concordare), tipografía y colores. Sin cambios de código.
Método: inspección real del DOM/CSS de los sitios de referencia (tokens computados, no estimados) + auditoría de contraste WCAG sobre la paleta actual de ichtys.

---

## 1. Referencia: Concordare

**Qué es.** Concordare Trials (concordare.com) es una plataforma real de digitalización de protocolos clínicos (CTPM: Clinical Trial Protocol Model). Es la referencia de UX elegida para ALPHI 2.0: convierte PDFs de protocolo en un modelo estructurado y genera documentos fuente, EDC, CTMS y billing grids desde la misma fuente. Mismo problema que ALPHI (documento → operación), por eso es la referencia correcta.

**Productos observados (concordare.com/solutions):** Apta (conversión PDF→CTPM), Structura (documentos operativos), Porta (integración eClinical), Censa (billing grid / MCA), Iter (plan de activación).

### 1.1 Patrones UX extraídos del sitio real

- **Human-in-the-loop explícito.** "AI extracts. Humans approve." / "Nothing ships without human approval." → en ALPHI esto ya existe (respuestas grounded + revisión humana); reforzar el patrón visual de "aprobado por humano" vs "sugerido por IA".
- **Un solo modelo, muchas salidas.** El CTPM es la fuente de verdad; cada salida (worksheet, EDC, CTMS, billing) deriva de él. → ALPHI debe mostrar procedencia: cada valor debe poder trazarse a una línea del documento fuente (cita).
- **Navegación por visita.** "Scroll through visits, each one generated from the same CTPM." → la Visita es la unidad de navegación, no el documento.
- **Densidad controlada, no minimalismo.** El sitio muestra tablas densas (billing grid 7×7, 42 forms, 186 fields, 12 edit checks) con contadores. Los CRC trabajan con datos densos; la UI debe soportar densidad sin ruido.
- **Estados funcionales con color.** Los mockups del sitio usan estados claros (Healthy, Last sync, All validations passing) con acento de marca.
- **Jerarquía tipográfica fuerte.** Titulares grandes (72px) con tracking negativo; subtítulos de sección pequeños (18px) con peso 500.
- **Superficie cálida.** Fondo "paper" (#F0F1FB) y tarjetas off-white cálidas (#fdfcf9), no blanco frío sobre gris.

### 1.2 Lo que NO copiar

- Concordare es un producto B2B de escritorio con densidad de data-grid; ALPHI es un asistente conversacional + operativo. No importar la densidad de sus tablas de billing.
- Su paleta de marca (violeta #575FCF) es cercana a la de ALPHI pero no idéntica; no reemplazar la identidad ALPHI por la de Concordare.

---

## 2. Tipografía

### 2.1 Concordare (medido del DOM real)

| Token | Valor |
|---|---|
| `--font-display` | "League Spartan", "League Spartan Fallback", sistema |
| `--font-sans` | "Noto Sans", "Noto Sans Fallback", sistema |
| `--font-mono` | ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace |
| H1 | 72px · peso 600 · letter-spacing −1.8px · line-height 1.05 (75.6px) |
| H2 | 18px · peso 500 · line-height 28px (1.556) |
| Body | 16px · line-height 24px (1.5) |
| Tracking | tight −.025em · wide .025em · wider .05em · widest .1em |

**Lectura:** dos familias — una display (League Spartan, geométrica, con carácter) para titulares y una sans humanista (Noto Sans) para interfaz y cuerpo. Hay stack mono dedicado para valores de datos/protocolo.

### 2.2 ichtys.com.ar (medido del DOM real)

| Token | Valor |
|---|---|
| Fuente única | Montserrat (body y headings) |
| H1 | 40px · peso 400 |
| H3 | 20.8px · peso 400 |

**Lectura:** una sola familia (Montserrat) con pesos ligeros; jerarquía por tamaño, no por familia. Es la referencia corporativa de marca, no de producto.

### 2.3 Estado actual de ichtys (Asistente_bot)

| Token | Valor |
|---|---|
| Fuente | Inter (next/font/google), variable `--font-sans` |
| Feature settings | cv02, cv03, cv04, cv11 (variantes estilísticas de Inter) |
| Body | 16px · line-height 1.6 (globals.css) |
| Answer text | 15px · line-height 1.7 (estilo Claude) |
| Radios | rounded-lg (0.5rem), rounded-xl (0.75rem) |
| Mono | **ausente** (no hay stack mono definido) |

### 2.4 Brechas tipográficas

1. **Sin fuente display diferenciada.** Todo es Inter. Concordare separa display/sans; ALPHI hoy no. Recomendado: agregar una familia display para H1/H2 (o, si se mantiene Inter, diferenciar por peso 600–700 + tracking −0.02em en titulares).
2. **Sin stack mono.** Los valores de protocolo (ventanas, dosis, números de protocolo) se muestran en la misma sans. Concordare usa mono para valores estructurados. Recomendado: definir `--font-mono` y aplicarlo a valores de datos, citas y spec.
3. **Inconsistencia de interlineado.** Body 1.6 en `globals.css` vs 1.7 en `.alphi-answer-text` vs 1.5 de Concordare. Recomendado: unificar escala (sugerido: 1.5 UI, 1.7 solo para prosa de respuesta larga).
4. **Tracking de titulares.** Los H1 actuales no definen letter-spacing; Concordare usa −1.8px en 72px. Recomendado: tracking negativo leve (−0.02em) en titulares grandes.

---

## 3. Colores

### 3.1 Concordare (medido del DOM real)

**Marca (violeta):**
| Token | Hex |
|---|---|
| brand-50 | #eef0fe |
| brand-100 | #d9defc |
| brand-300 | #8e9bf2 |
| brand-400 | #6f7ce4 |
| brand-500 (primario) | #575FCF |
| brand-600 (hover) | #4148b3 |
| brand-700 | #4a50b8 |

**Superficie y texto:**
| Token | Hex |
|---|---|
| paper (fondo página) | #F0F1FB |
| paper-surface (tarjeta) | #fdfcf9 |
| paper-edge (borde) | #eae8e1 |
| texto | #0B0D1A (rgb 11,13,26) |
| footer bg | rgba(0,0,0,0.02) |
| nav link | rgba(0,0,0,0.7) → hover #575FCF |
| sidebar accent / accent-bar | #575FCF |

**Semánticos:** emerald #00d294 / #007956 · amber #b75000 · red #e40014 / #bf000f · sky #0069a4 · violet #8d54ff / #7f22fe
**Acentos hero:** check #B85647 · circle #FF9781 · #f07a60
**Oscuros:** #262070 · #1d2050

### 3.2 ichtys.com.ar (medido del DOM real)

| Token | Hex |
|---|---|
| dark-blue | #0a3d5c |
| light-blue | #277ebd |
| fluo-green | #1ecb7f |
| light-green | #1fad9c |
| purple (botón) | #7066e0 |
| fondo landing | rgb(0,18,32) (navy oscuro) |

### 3.3 Estado actual de ichtys (Asistente_bot)

| Token | Hex | Uso |
|---|---|---|
| alphi-navy | #192337 | texto, header |
| alphi-teal | #6855B6 | **acento primario (realmente violeta)** |
| alphi-sage | #059669 | OK / completo |
| alphi-amber | #D97706 | pendiente / query |
| alphi-rose | #DC2626 | error / vencido |
| alphi-slate | #F7F8FC | fondo página |
| alphi-border | #E5E8F0 | bordes |
| alphi-muted | #667085 | texto secundario |
| violet-soft | #F1EDFA | pill acento |
| green-soft | #E9F7F0 | pill OK |
| blue-soft | #EAF3FC | pill revisión |
| amber-soft | #FFF4E2 | pill pendiente |
| rose-soft | #FCEEF1 | pill error |

### 3.4 Auditoría de contraste (WCAG, calculado)

**Paleta actual de ichtys:**
| Par | Ratio | Veredicto |
|---|---|---|
| navy #192337 sobre white | 15.71 | AA texto |
| teal/violet #6855B6 sobre white | 5.89 | AA texto |
| teal/violet sobre slate #F7F8FC | 5.55 | AA texto |
| sage #059669 sobre white | 3.77 | solo AA grande |
| amber #D97706 sobre white | 3.19 | solo AA grande |
| rose #DC2626 sobre white | 4.83 | AA texto |
| muted #667085 sobre white | 4.97 | AA texto |
| muted sobre slate | 4.69 | AA texto |
| sage sobre green-soft | 3.41 | solo AA grande |
| **amber sobre amber-soft** | **2.93** | **FAIL** |
| rose sobre rose-soft | 4.29 | solo AA grande |
| teal sobre violet-soft | 5.12 | AA texto |

**Referencia Concordare:**
| Par | Ratio | Veredicto |
|---|---|---|
| brand #575FCF sobre white | 5.33 | AA texto |
| texto #0B0D1A sobre paper #F0F1FB | 17.19 | AA texto |
| emerald-700 #007956 sobre white | 5.43 | AA texto |
| amber-700 #b75000 sobre white | 5.05 | AA texto |
| red-700 #bf000f sobre white | 6.52 | AA texto |
| sky-700 #0069a4 sobre white | 5.90 | AA texto |
| brand-300 #8e9bf2 sobre white | 2.59 | FAIL (no usar como texto) |

### 3.5 Brechas de color

1. **Amber pill falla contraste (2.93).** `alphi-amber #D97706` sobre `amber-soft #FFF4E2` no alcanza ni AA grande. Es el pill "Pendiente/Query" más usado. Recomendado: oscurecer el texto del pill a un ámbar-700 (#b75000, ratio 5.05) manteniendo el fondo suave.
2. **Sage solo AA grande (3.77).** El texto sage sobre blanco es borderline para cuerpo pequeño. Recomendado: usar sage-700 (#047857) para texto y reservar #059669 para iconos/acentos grandes.
3. **Nomenclatura engañosa.** El token `--alphi-teal` porta un violeta (#6855B6), no un teal. Es deuda de nomenclatura: las clases `text-alphi-teal`, `bg-alphi-teal/30` se leen como "teal" pero pintan violeta. Recomendado: renombrar a `--alphi-violet` (con alias `teal` para no romper el layout actual) o migrar las clases.
4. **Sin superficie cálida.** Las tarjetas son blanco puro (#FFFFFF) sobre slate frío (#F7F8FC). Concordare usa paper cálido (#F0F1FB / #fdfcf9). Recomendado: evaluar un off-white cálido para tarjetas o mantener blanco pero subir el slate a un tono menos azul.
5. **Acento cercano pero no igual al de Concordare.** #6855B6 (ALPHI) vs #575FCF (Concordare). Coincidencia de familia (violeta) pero distinto valor. No es problema; es identidad propia. No perseguir igualación exacta.
6. **Faltan tokens de radio y blur.** Solo existen rounded-lg/xl. Concordare define sm/md/lg/xl/2xl y blur sm/md. Recomendado: incorporar escala de radios y blur para sombras/glass.

---

## 4. Recomendaciones para FASE 1 (design system)

**Tipografía**
- R1. Definir `--font-display` (nueva familia o Inter con peso/tracking diferenciado) y aplicarlo a H1/H2.
- R2. Definir `--font-mono` (ui-monospace stack) y aplicarlo a valores de protocolo, ventanas, citas y spec.
- R3. Unificar interlineado: 1.5 para UI, 1.7 solo para prosa de respuesta larga.
- R4. Agregar tracking negativo (−0.02em) a titulares grandes.

**Color**
- R5. Corregir el pill ámbar: texto ámbar-700 (#b75000) sobre amber-soft → ratio 5.05 (AA).
- R6. Subir sage a sage-700 (#047857) para texto pequeño.
- R7. Renombrar `--alphi-teal` → `--alphi-violet` (mantener alias) y documentar la semántica real.
- R8. Incorporar escala de radios (sm/md/lg/xl/2xl) y blur (sm/md).
- R9. Documentar semántica de estado: sage=OK, amber=pendiente, blue/sky=revisión, slate=histórico, rose=error/vencido (ya coincide con la referencia; solo falta fijarlo en tokens).

**Patrones UX (de Concordare, aplicables)**
- R10. Reforzar procedencia: cada valor debe enlazar a su cita en el documento fuente (patrón "trace back to a line in the source document").
- R11. Human-in-the-loop visual: distinguir "sugerido por IA" de "aprobado por humano" con un estado explícito.
- R12. Navegar por visita (no por documento) como unidad principal.
- R13. Soportar densidad controlada (tablas, contadores) sin sacrificar legibilidad.

---

## 5. Evidencia y reproducibilidad

- Tokens de Concordare: extraídos de `getComputedStyle(document.documentElement)` y `document.styleSheets` en https://concordare.com/ (sesión browser `concordare`).
- Tokens de ichtys.com.ar: mismo método en https://www.ichtys.com.ar/ (sesión browser `ichtys`).
- Paleta actual: `ichtys/apps/web/app/globals.css` (tokens `:root`) y `ichtys/apps/web/tailwind.config.ts` (mapeo a clases).
- Contraste: cálculo WCAG relativo de luminancia sobre los pares listados en §3.4.
- No se modificó código. No se pusheó. No se tocó `main`.

## 6. Fuente

- https://concordare.com/ · /about · /solutions · /solutions/sites
- https://www.ichtys.com.ar/
- ichtys/apps/web/app/globals.css · tailwind.config.ts · app/layout.tsx · app/(app)/layout.tsx
