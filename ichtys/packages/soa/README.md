# @ichtys/soa

Lectura geométrica del cronograma (SoA) de un protocolo clínico en PDF —
ADR-10, etapa P2. Sin red, sin modelo, sin claves: `pdfjs-dist` build legacy
corriendo en Node puro.

## Qué hace

- `loadPageGeometry(pdf)` — ítems de texto con caja en puntos PDF (espacio de
  usuario sin rotar, el mismo del gold) + bordes de celda por página, con
  topes de lectura.
- `locateSchedule(pages)` — localiza las páginas del cronograma (dedicadas de
  notas incluidas).
- `readGrid(pages, located)` — grilla cruda por tabla: columnas, celdas
  (marcas/combinadas/texto), fila de ventana, llamadas de nota, notas y
  outcome con chequeos G1–G5.

## Topes de lectura (S5, paridad con ingestion)

Se aplican **antes** de leer contenido, con rechazo controlado fail-closed
(`PdfLimitError`, código estable):

| Tope | Valor | Código |
|------|-------|--------|
| Buffer de entrada | 50 MB | `file_too_large` |
| Páginas por documento | 300 | `too_many_pages` |
| Tiempo por página | 10 s | `page_timeout` |

Aparte, `readGrid` marca `page_limit` como reason si una **tabla** se extiende
a más de 100 páginas (`PAGE_LIMIT` de la grilla, distinto del tope del lector).

`getDocument` corre endurecido: `isEvalSupported: false`,
`disableFontFace: true`, `useSystemFonts: false`, `verbosity: 0` — solo se
lee texto y posición, nunca se renderiza.

## Límites conocidos

- **Marcas dibujadas como vectores**: en un SoA real las marcas (cruces,
  ticks) suelen dibujarse como trazos vectoriales, no como texto. Esos paths
  NO viven en la capa de texto y este lector no las ve: P2 lee marcas de
  texto (`X`, `✓`, `●`); las marcas vectoriales quedan para la verificación
  visual de P5. Este paquete no las reporta ni las estima.
