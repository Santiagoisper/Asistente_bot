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
  outcome con chequeos G1–G7 (G6 llamadas de nota sin texto, G7 texto
  pequeño no consumido en la zona de grilla; `rotated_text` acompaña como
  reason si hay ítems girados sin consumir).

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

`getDocument` corre endurecido: `disableFontFace: true`,
`useSystemFonts: false`, `verbosity: 0` — solo se lee texto y posición,
nunca se renderiza. (`isEvalSupported` no se pasa: pdfjs-dist 6 eliminó
esa opción de la API junto con el eval de font programs; con la versión
fijada ese endurecimiento viene de fábrica.)

## Límites conocidos

- **Marcas dibujadas como vectores**: en un SoA real las marcas (cruces,
  ticks) suelen dibujarse como trazos vectoriales, no como texto. Esos paths
  NO viven en la capa de texto y este lector no las ve: P2 lee marcas de
  texto (`X`, `✓`, `●`); las marcas vectoriales quedan para la verificación
  visual de P5. Este paquete no las reporta ni las estima.
- **G2 solo controla páginas con textos de ventana**: la cobertura
  (ventana ⊇ columnas con ficha de esa página) se verifica en las páginas
  donde la fila de ventana tiene textos dibujados (`hasText`); una página
  sin grupos de ventana no entra al recuento. La ausencia TOTAL de fila de
  ventana no la pesca G2 — eso queda del lado de `locate`
  (`not_located`/`grid_unreadable`).
- **`noteRefs` solo en celdas mark**: las llamadas de nota (superíndices
  junto a la marca) se matchean contra celdas de marca. Las celdas
  `merged`/`text` (rangos prn, fila de ventana) no reciben llamadas — el
  generador solo las dibuja junto a marcas.
- **Notas fuera de las zonas leídas quedan SEÑALADAS, no leídas**: el
  extractor toma notas de páginas dedicadas y de pies de grilla (fuente
  8–10). Texto diminuto (<6 pt) al costado de la grilla — el patrón de F2
  T2 — no se extrae: G6 cuenta las llamadas que quedaron sin texto y G7 el
  texto no consumido, y la tabla baja a `partial`. La señal es el contrato;
  leer esas notas es decisión de P3/P5.
