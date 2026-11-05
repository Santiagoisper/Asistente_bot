# Fixtures sintéticos de cronograma (ADR-10, P1)

Nueve PDF inventados, F1 a F8 más F6b, y el JSON de verdad que sale del mismo generador. No hay patrocinador, fármaco, código de estudio ni analito real. Sirven para medir un extractor de cronogramas. No son un protocolo.

Semillas fijas: F1 `1001`, F2 `1002`, F3 `1003`, F4 `1004`, F5 `1005`, F6 `1006`, F6b `1009`, F7 `1007`, F8 `1008`. F1 a F5 salen del generador `1.1.0`. F6, F6b, F7 y F8 salen del generador `1.3.0`.

| Fixture | Páginas | Páginas de grilla | Celdas | Notas | Inconsistencias plantadas |
| --- | ---: | ---: | ---: | ---: | ---: |
| F1 | 60 | 9 | 729 | 25 | 4 |
| F2 | 50 | 17 | 651 (80 `prn_range`) | 26 | 4 |
| F3 | 90 | 49 | 572 | 27 | 3 |
| F4 | 8 | 2 | 45 | 5 | 2 |
| F5 | 40 | 6 | 198 | 10 | 3 |
| F6 | 24 | 22 | 513 | 0 | 0 |
| F6b | 24 | 22 | 513 | 0 | 0 |
| F7 | 6 | 4 | 208 | 0 | 0 |
| F8 | 7 | 5 | 256 | 0 | 0 |

Esas cifras son el inventario del gold, no una medición del extractor. F6, F6b, F7 y F8 no plantan inconsistencias: el rasgo que miden está en la geometría del encabezado.

## Qué trae cada trampa

- F1. Grilla densa por ramas. Ventanas combinadas, tokens partidos (`Hast` + `a` + `42` + `d`, `V` + `12`), columna sombreada con la X en el borde superior, notas en la página siguiente. La prosa corta el seguimiento en S104 y la grilla de rescate sigue con VR9 a VR12.
- F2. Varias páginas, filas de ayuno y de visita a la clínica (no son celdas) y ocho filas «según necesidad». V14 no tiene marca de clínica y sí tiene panel de laboratorio. Tres filas llevan la condición en Comentarios: subgrupo X, brazo A y brazo B.
- F3. Grilla muy partida: 2 o 3 filas por página, una continuación de columnas, tres columnas sin número y una fila duplicada. Pasa el tope de 30 páginas del extractor actual a propósito. Cuatro rótulos dicen el brazo o el subgrupo. La dispensación sin número queda solo para el brazo A, y V4 solo para el brazo B.
- F4. Ocho páginas. El índice, la sinopsis y la lista de tablas citan «1.3 Cronograma de actividades» antes de la grilla. La fila de ventana se llama «Margen de visita».
- F5. Inglés. La primera página de la segunda tabla se dibuja apaisada y después lleva `/Rotate 90`. Las cajas del gold quedan en el espacio sin rotar. El encabezado de esa tabla tiene dos niveles. Tres rótulos dicen el brazo o el subgrupo.
- F6. Generador `1.3.0`. 22 páginas apaisadas de una sola grilla. Encabezado numérico sin prefijo y sin etiqueta en la fila de enteros. Las fichas son enteros crecientes con tres guiones, en la secuencia `4 - 5 6 - 7 - 8`. Encima hay tres períodos agrupados (Selección, Tratamiento, Seguimiento). En otra banda, debajo, una fila «Día». A la derecha, una tira de comentarios que no es visita. El encabezado se repite en cada página. Cada página trae entre 2 y 6 filas de datos. La columna de etiquetas no es una visita. El gold lo deja en `header` con `label` null e `integerRowLabeled` false. Sirve de control sin etiqueta.
- F6b. El mismo F6, semilla `1009`, con la etiqueta de la fila de enteros. Son dos palabras, «Visita número», en la misma fuente que las fichas (7 pt). El techo de esa etiqueta queda 11,5 pt sobre el techo de las fichas, y el texto queda a la izquierda de la primera ficha. No comparte la línea de los enteros. El gold lo deja en `header.label` e `integerRowLabeled: true`. Es el caso en el que un recorte por el techo de las fichas deja la etiqueta afuera.
- F7. Generador `1.3.0`. Un solo encabezado de varias líneas, 26 columnas, repetido en 4 páginas apaisadas. Arriba, tres períodos (Selección, Tratamiento, Seguimiento). Después, la fila de ids de visita en celdas de dos líneas: las fichas largas van partidas (prefijo `V` arriba, número a 9 pt y en el mismo x, ± 1 pt) y 5 fichas cortas (`V1`, `ET`, `FA`, `VDT`, `EOS`) van enteras, centradas en altura. La etiqueta «Visita» sale en x = 82, en la línea del número. La primera ficha está en x = 220 (dentro de 213–237). Unos 39 pt más abajo hay una fila de semanas `S1`–`S26`; las largas (`S10` en adelante) también van partidas. Esas semanas son el tiempo de las mismas 26 columnas, no otra tabla ni más visitas. La columna de la etiqueta no es una visita. Antes de la grilla hay una página de figura: una línea de tiempo con 21 fichas `S…`, sin marcas. El origen de cada ficha queda a 6 pt del origen de la siguiente (`figure.separation` es `origin`). El gold lo deja en `header` (`kind: multiline_visit`) y en `figure`.
- F8. Generador `1.3.0`. Control de dos tablas apiladas de verdad. 5 páginas apaisadas. Cada una trae dos encabezados: 20 columnas con prefijo `V` desde x = 237 y 24 con prefijo `W` desde x = 213. No hay etiquetas «Serie» ni «Ficha». La ficha está partida: la letra a 7 pt y, 9 pt debajo, el número a 9 pt. La primera ficha de la tira W es `1/`. Las etiquetas de datos salen en x = 82. Hay 45 pt entre las filas de letras, 6 pt hasta la primera fila de datos de la tira V y 18 pt en la tira W. Entre los dos encabezados hay filas de datos con marcas. La tira V lleva 2 filas y la W lleva 4. El encabezado de las dos tiras se repite en cada página. La columna de etiquetas no es una visita (`labelColumn.countsAsVisit` es false). El gold lo deja en `strips` y en `cells`. El calificador, si las dos tablas comparten páginas, desempata por el solapamiento vertical de las cajas de las visitas.

El relleno no contiene «cronograma de actividades», «schedule of assessments», «plan de visitas» ni «SoA». Esas frases están solo en los falsos aciertos, en el encabezado de cada grilla y, en F7, en la página de figura.

## Glifos perdidos

`difficulty.glyphLoss` es `false` en los nueve. ReportLab no puede emitir un ToUnicode roto sin editar la capa de texto a mano, y eso está prohibido. F5 no incluye ese rasgo.

## Regenerar

Hace falta Python 3 y las librerías de `ichtys/scripts/soa-fixtures/requirements.txt` (reportlab 4.2.5, pypdf 5.1.0, pypdfium2 4.30.0). Dos corridas escriben los mismos bytes.

```bash
python3 -m venv /tmp/soa-venv
/tmp/soa-venv/bin/pip install -r ichtys/scripts/soa-fixtures/requirements.txt
/tmp/soa-venv/bin/python ichtys/scripts/soa-fixtures/generate.py
/tmp/soa-venv/bin/python ichtys/scripts/soa-fixtures/generate.py F6 F6b F7 F8
```

Sin argumentos se reescriben F1 a F5. Con `F6`, `F6b`, `F7` y `F8` solo salen esos cuatro, en el generador `1.3.0`.

Salida: `ichtys/fixtures/soa/F{n}.pdf`, `F{n}.gold.json` y `F{n}.render/pagina-{k}.png` a 72 dpi. El PDF y el gold quedan en el repositorio. Los PNG no: `ichtys/.gitignore` ignora `fixtures/soa/*.render/` y el generador los vuelve a escribir iguales. El PNG de la página rotada de F5 es la página como la muestra un visor. Las cajas del JSON siguen el espacio de usuario sin rotar.

## Calificar

El calificador compara una salida contra el gold. Las visitas con tiempo emparejan por la tabla alineada y el día canónico: una semana son 7 días, con tolerancia de un día. Las visitas sin tiempo emparejan por el id impreso normalizado, dentro de la tabla. El tipo de visita se mide solo en `types`. Antes de emparejar, las tablas se alinean por las páginas que comparten. Si empatan en páginas, desempata el solapamiento vertical de las cajas de las visitas; la clave alfabética queda última. Los procedimientos empatan por etiqueta normalizada, por la tabla de alias del gold, o por similitud de al menos 0,85. `prn_range` se cuenta aparte. La salida son solo contadores. Con `--private` no hay etiquetas ni texto de protocolo. `--legacy` adapta la forma plana de visitas del extractor de `090e506`.

`scoreGrid` califica la geometría cruda, sin modelo: páginas del cronograma, tablas, columnas, celdas marcadas, celdas combinadas y llamadas a nota. Una columna repetida en una página siguiente es acierto si su centro x cae en la caja de alguna visita de esa tabla. Para no perder la visita hace falta una columna en la página de su caja. `--grid` usa ese calificador. `--private` sigue devolviendo solo números.

```bash
cd ichtys
npx --yes vitest@2.1.8 run --config scripts/soa-fixtures/vitest.config.mjs --maxWorkers=1 scripts/soa-fixtures/score.test.ts
npx --yes vitest@2.1.8 run --config scripts/soa-fixtures/vitest.config.mjs --maxWorkers=1 scripts/soa-fixtures/score-grid.test.ts
npx --yes tsx scripts/soa-fixtures/score.ts --gold fixtures/soa/F4.gold.json --candidate salida.json --legacy --private
npx --yes tsx scripts/soa-fixtures/score.ts --grid --gold fixtures/soa/F4.gold.json --candidate grilla.json --private
```

Sale 0 aunque el puntaje sea malo. Sale 2 si faltan argumentos.

En CI, después de `pnpm install`, corre `pnpm test:fixtures`. Usa el vitest ya instalado en `@ichtys/web` y el mismo config. No entra en `pnpm test`.

## Línea de base

El extractor de `090e506c90775e9c6dba0478477405a0106192c1` solo llama a Anthropic. Esta copia no tiene `ANTHROPIC_API_KEY` en el entorno ni en `ichtys/.env.local`. `baseline.json` queda en `not_run` / `NO VERIFICADO`. No hay contadores inventados.

```bash
cd ichtys
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/soa-fixtures/baseline.ts
```

Ese comando sale con código 2 cuando no hay clave: escribe `baseline.json` y no llama a la red. Node avisa si se omite `--disable-warning`, porque `ichtys/package.json` no declara `"type": "module"`. No hace falta tocarlo. El archivo registra el hash real del árbol `ichtys/packages/ingestion`. Si no es el de `090e506c90775e9c6dba0478477405a0106192c1`, avisa por stderr, deja `extractorTreeMatches` en false y la etiqueta `NO COMPARABLE`, y sigue. No corta la corrida.

Con clave, Node plano no puede importar el extractor: los imports relativos no llevan extensión. El comando es este:

```bash
cd ichtys
npx --yes tsx scripts/soa-fixtures/baseline.ts
```

Corre `visitsOnly: true`, que es el camino de cronograma y cabe en el tope de 3 USD. `--full` también pide criterios y endpoints. No se pasa `orgId`, así que no se escribe consumo en la base. Si el gasto estimado llega a 3 USD, el fixture siguiente no arranca.
