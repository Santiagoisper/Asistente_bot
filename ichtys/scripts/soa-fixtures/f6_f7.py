"""Fixtures sintéticos F6 y F7. Generador 1.3.0.

F6: encabezado numérico sin prefijo, con etiqueta de fila, guiones y
períodos agrupados. 22 páginas de cronograma apaisadas; el encabezado
se repite en cada una. Tira de comentarios a la derecha. 2 a 6 filas
de datos por página.

F7: cada página de cronograma trae dos tiras apiladas (20 y 24 columnas
de visita). La ficha está partida en dos filas contiguas: prefijo de
letras arriba y número a 9 pt abajo. Las filas de datos cuelgan de su
tira. El encabezado de las dos tiras se repite en cada página. La
columna de etiquetas no es una visita.

Sin patrocinador, sin fármaco y sin protocolo real. No reescribe F1–F5.
"""
from __future__ import annotations

import io
import json

from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics

from generate import (
    FORBIDDEN,
    LANDSCAPE,
    OUT,
    SECTION_ES,
    W,
    Doc,
    catalog_es,
    draw_cover,
    draw_synopsis,
    gold_from,
    make_procedures,
    render,
    require_geometry,
    set_cell,
    visit,
    wrap,
    write_pngs,
)

VERSION = "1.3.0"
PAGE_W, PAGE_H = LANDSCAPE

F6_VALUES = [1, 2, 3, None, 4, 5, 6, 7, 8, None, 9, 10, 11, 12, 13, 14, 15, 16]
F6_PERIODS = ((0, 6, "Selección"), (6, 13, "Tratamiento"), (13, 18, "Seguimiento"))
F6_ROWS_PER_PAGE = [2, 6, 5, 4, 3] + [2] * 17


def box(x0, y0, x1, y1):
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def require_fit(text, font, size, width, where):
    got = pdfmetrics.stringWidth(text, font, size)
    if got > width - 1:
        raise SystemExit(f"{where}: {text!r} mide {got:.1f} y el hueco es {width:.1f}")


def hline(c, x0, x1, y):
    c.setStrokeColorRGB(0.35, 0.35, 0.35)
    c.setLineWidth(0.4)
    c.line(x0, y, x1, y)


def vline(c, x, y0, y1):
    c.setStrokeColorRGB(0.35, 0.35, 0.35)
    c.setLineWidth(0.4)
    c.line(x, y0, x, y1)


def center(c, text, x, w, baseline, size):
    c.setFillColorRGB(0, 0, 0)
    c.setFont("DejaVu", size)
    c.drawCentredString(x + w / 2.0, baseline, text)


def left_text(c, text, x, baseline, size):
    c.setFillColorRGB(0, 0, 0)
    c.setFont("DejaVu", size)
    c.drawString(x, baseline, text)


def new_grid(rows, visits):
    return [[None for _ in visits] for _ in rows], []


def numbered_visit(key, printed, label, day):
    return visit(key, printed, label, "scheduled", day, "day", "standard", W(3, 3, "day"))


def paint_title(c, doc, page, size, subtitle):
    doc.page_label(c, page, size)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("DejaVuBold", 8)
    c.drawString(18, size[1] - 32, SECTION_ES)
    c.setFont("DejaVu", 7)
    c.drawString(18, size[1] - 42, subtitle)


def f6_layout():
    proc_w, comment_w = 128.0, 64.0
    left = 18.0
    n = len(F6_VALUES)
    usable = PAGE_W - left - 18.0 - proc_w - comment_w
    vw = usable / n
    col_x = left + proc_w

    def vx(index):
        return col_x + index * vw

    require_fit("Número de visita", "DejaVu", 6, proc_w - 4, "F6 etiqueta")
    for start, end, label in F6_PERIODS:
        require_fit(label, "DejaVu", 6, (end - start) * vw, f"F6 período {label}")
    for value in F6_VALUES:
        glyph = "-" if value is None else str(value)
        require_fit(glyph, "DejaVu", 7, vw, "F6 ficha")
    return {
        "left": left,
        "proc_w": proc_w,
        "vw": vw,
        "vx": vx,
        "comment_x": vx(n),
        "right": vx(n) + comment_w,
        "n": n,
    }


def draw_f6_page(doc, table, r0, r1, layout):
    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Encabezado numérico, períodos agrupados.")
        left = layout["left"]
        proc_w = layout["proc_w"]
        vw = layout["vw"]
        vx = layout["vx"]
        comment_x = layout["comment_x"]
        right = layout["right"]
        n = layout["n"]
        y = size[1] - 52.0

        def band(height):
            nonlocal y
            top = y
            bottom = round(y - height, 2)
            y = bottom
            return top, bottom

        period_top, period_bottom = band(12)
        header_top, header_bottom = band(14)
        day_top, day_bottom = band(12)
        data = []
        for row_index in range(r0, r1):
            top, bottom = band(16)
            data.append((row_index, top, bottom))
        body_bottom = data[-1][2]

        # Períodos: solo los bordes del grupo. Por debajo, una línea por columna.
        for y_line in (period_top, period_bottom, header_bottom, day_bottom, body_bottom):
            hline(c, left, right, y_line)
        for _row_index, top, _bottom in data:
            hline(c, left, right, top)
        vline(c, left, body_bottom, period_top)
        vline(c, left + proc_w, body_bottom, period_top)
        vline(c, right, body_bottom, period_top)
        for start, end, _label in F6_PERIODS:
            vline(c, vx(start), period_bottom, period_top)
            vline(c, vx(end), period_bottom, period_top)
        for index in range(n + 1):
            vline(c, vx(index), body_bottom, period_bottom)
        vline(c, comment_x, body_bottom, period_bottom)

        periods = []
        for start, end, label in F6_PERIODS:
            center(c, label, vx(start), vx(end) - vx(start), period_bottom + 3, 6)
            periods.append({"label": label, "start": start, "end": end, "bbox": box(vx(start), period_bottom, vx(end), period_top)})

        left_text(c, "Número de visita", left + 2, header_bottom + 4, 6)
        left_text(c, "Día", left + 2, day_bottom + 3, 6)
        center(c, "Comentarios", comment_x, right - comment_x, header_bottom + 4, 6)

        columns = []
        days = []
        for index, value in enumerate(F6_VALUES):
            glyph = "-" if value is None else str(value)
            center(c, glyph, vx(index), vw, header_bottom + 3, 7)
            day = str((index + 1) * 7)
            center(c, day, vx(index), vw, day_bottom + 3, 6)
            number_box = box(vx(index), header_bottom, vx(index) + vw, header_top)
            columns.append({
                "index": index,
                "glyph": glyph,
                "dash": value is None,
                "text": "—" if value is None else str(value),
                "fontSize": 7,
                "bbox": number_box,
            })
            days.append({"index": index, "text": day, "bbox": box(vx(index), day_bottom, vx(index) + vw, day_top)})
            vis = table["visits"][index]
            if vis["page"] is None:
                vis["page"] = page
                vis["bbox"] = number_box

        data_rows = []
        for row_index, top, bottom in data:
            proc = table["rows"][row_index]
            lines = wrap(proc["label"], "DejaVu", 6, proc_w - 6)[:2]
            for i, line in enumerate(lines):
                left_text(c, line, left + 2, bottom + 3 + (len(lines) - 1 - i) * 7, 6)
            if proc["page"] is None:
                proc["page"] = page
                proc["bbox"] = box(left, bottom, left + proc_w, top)
            if (row_index % 2) == 0:
                left_text(c, "ver nota", comment_x + 2, bottom + 4, 6)
            for index in range(n):
                cell = table["grid"][row_index][index]
                cell_box = box(vx(index), bottom, vx(index) + vw, top)
                if cell is None:
                    continue
                center(c, "X", vx(index), vw, bottom + 4, 7)
                if cell["page"] is None:
                    cell["page"] = page
                    cell["bbox"] = cell_box
            data_rows.append({"procedureKey": proc["key"], "bbox": box(left, bottom, vx(n), top)})

        if not any(item["page"] == page for item in table["headerPages"]):
            table["headerPages"].append({
                "page": page,
                "rows": r1 - r0,
                "periods": periods,
                "label": {"text": "Número de visita", "bbox": box(left, header_bottom, left + proc_w, header_top)},
                "labelColumn": {"countsAsVisit": False, "bbox": box(left, body_bottom, left + proc_w, header_top)},
                "columns": columns,
                "timeRow": {"label": "Día", "bbox": box(left, day_bottom, left + proc_w, day_top), "values": days},
                "commentsStrip": {
                    "text": "Comentarios",
                    "countsAsVisit": False,
                    "bbox": box(comment_x, body_bottom, right, header_top),
                },
                "dataRows": data_rows,
            })

    return drawer


def build_f6():
    if F6_ROWS_PER_PAGE != [2, 6, 5, 4, 3] + [2] * 17:
        raise SystemExit("F6: el plan de filas no es el declarado")
    if sum(F6_ROWS_PER_PAGE) != 54 or len(F6_ROWS_PER_PAGE) != 22:
        raise SystemExit(f"F6 filas {sum(F6_ROWS_PER_PAGE)} páginas {len(F6_ROWS_PER_PAGE)}")
    if any(not 2 <= count <= 6 for count in F6_ROWS_PER_PAGE):
        raise SystemExit("F6: una página se sale de 2 a 6 filas")
    labels = catalog_es()
    rows = make_procedures(labels[:54], "F6")
    visits = []
    for index, value in enumerate(F6_VALUES):
        printed = None if value is None else str(value)
        label = "Sin número" if value is None else f"Visita {value}"
        visits.append(numbered_visit(f"T1-C{index:02d}", printed, label, (index + 1) * 7))
    grid, cells = new_grid(rows, visits)
    for r in range(len(rows)):
        for c in range(len(visits)):
            if (r + c) % 2 == 0:
                set_cell(grid, cells, r, c, rows, visits, "x")
    table = {
        "key": "T1",
        "title": "Cronograma numérico",
        "branch": None,
        "phase": "tratamiento",
        "visits": visits,
        "rows": rows,
        "grid": grid,
        "cells": cells,
        "notes": [],
        "narratives": [],
        "pages": [],
        "headerPages": [],
    }
    doc = Doc("F6", 1006, 24, "es")
    doc.tables.append(table)
    layout = f6_layout()
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: table["pages"][0]), (612.0, 792.0), "false"))
    cursor = 0
    for count in F6_ROWS_PER_PAGE:
        table["pages"].append(doc.add(draw_f6_page(doc, table, cursor, cursor + count, layout), LANDSCAPE, "grid"))
        cursor += count
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F6 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f6_table = table
    return doc, []


def f7_layout(columns):
    left, proc_w = 16.0, 108.0
    usable = PAGE_W - left - 16.0 - proc_w
    vw = usable / columns
    col_x = left + proc_w

    def vx(index):
        return col_x + index * vw

    return {"left": left, "proc_w": proc_w, "vw": vw, "vx": vx, "right": vx(columns), "n": columns}


def draw_f7_page(doc, slices):
    """slices: list of (table, r0, r1, prefix, layout) in orden vertical."""

    def drawer(c, page, size):
        paint_title(c, doc, page, size, "Dos tiras. La ficha está partida.")
        y = size[1] - 52.0
        for table, r0, r1, prefix, layout in slices:
            left = layout["left"]
            proc_w = layout["proc_w"]
            vw = layout["vw"]
            vx = layout["vx"]
            n = layout["n"]
            right = layout["right"]

            def band(height):
                nonlocal y
                top = y
                bottom = round(y - height, 2)
                y = bottom
                return top, bottom

            prefix_top, prefix_bottom = band(11)
            number_top, number_bottom = band(13)
            if prefix_bottom != number_top:
                raise SystemExit(f"F7 página {page}: la ficha no es contigua")
            data = []
            first_data_top = y
            for row_index in range(r0, r1):
                top, bottom = band(15)
                data.append((row_index, top, bottom))
            if data[0][1] != first_data_top or first_data_top != number_bottom:
                raise SystemExit(f"F7 página {page}: las filas no cuelgan de la tira")
            body_bottom = data[-1][2]

            for y_line in (prefix_top, prefix_bottom, number_bottom, body_bottom):
                hline(c, left, right, y_line)
            for _row_index, top, _bottom in data:
                hline(c, left, right, top)
            for index in range(n + 1):
                vline(c, vx(index), body_bottom, prefix_top)
            vline(c, left, body_bottom, prefix_top)

            left_text(c, "Serie", left + 2, prefix_bottom + 2, 7)
            left_text(c, "Ficha", left + 2, number_bottom + 3, 7)
            columns = []
            for index, vis in enumerate(table["visits"]):
                center(c, prefix, vx(index), vw, prefix_bottom + 2, 7)
                center(c, vis["number"], vx(index), vw, number_bottom + 2, 9)
                prefix_box = box(vx(index), prefix_bottom, vx(index) + vw, prefix_top)
                number_box = box(vx(index), number_bottom, vx(index) + vw, number_top)
                columns.append({
                    "index": index,
                    "prefix": prefix,
                    "number": vis["number"],
                    "printedId": vis["printedId"],
                    "numberFontSize": 9,
                    "prefixBBox": prefix_box,
                    "numberBBox": number_box,
                    "bbox": box(vx(index), number_bottom, vx(index) + vw, prefix_top),
                })
                if vis["page"] is None:
                    vis["page"] = page
                    vis["bbox"] = number_box

            data_rows = []
            for row_index, top, bottom in data:
                proc = table["rows"][row_index]
                lines = wrap(proc["label"], "DejaVu", 6, proc_w - 6)[:2]
                for i, line in enumerate(lines):
                    left_text(c, line, left + 2, bottom + 2 + (len(lines) - 1 - i) * 7, 6)
                if proc["page"] is None:
                    proc["page"] = page
                    proc["bbox"] = box(left, bottom, left + proc_w, top)
                for index in range(n):
                    cell = table["grid"][row_index][index]
                    cell_box = box(vx(index), bottom, vx(index) + vw, top)
                    if cell is None:
                        continue
                    center(c, "X", vx(index), vw, bottom + 3, 8)
                    if cell["page"] is None:
                        cell["page"] = page
                        cell["bbox"] = cell_box
                data_rows.append({"procedureKey": proc["key"], "bbox": box(left, bottom, right, top)})

            if not any(item["page"] == page for item in table["stripPages"]):
                table["stripPages"].append({
                    "page": page,
                    "visitColumns": n,
                    "labelColumn": {"countsAsVisit": False, "bbox": box(left, body_bottom, left + proc_w, prefix_top)},
                    "headerRows": [
                        {"role": "prefix", "fontSize": 7},
                        {"role": "number", "fontSize": 9},
                    ],
                    "prefixRow": {"fontSize": 7, "bbox": box(left, prefix_bottom, right, prefix_top)},
                    "numberRow": {"fontSize": 9, "bbox": box(left, number_bottom, right, number_top)},
                    "columns": columns,
                    "dataRows": data_rows,
                })
            y -= 14.0

    return drawer


def make_strip(key, title, prefix, columns, labels, mark_shift):
    rows = make_procedures(labels, key)
    visits = []
    for index in range(columns):
        number = str(index + 1)
        printed = f"{prefix}{number}"
        item = numbered_visit(f"{key}-C{index:02d}", printed, f"Visita {printed}", (index + 1) * 7)
        item["prefix"] = prefix
        item["number"] = number
        visits.append(item)
    grid, cells = new_grid(rows, visits)
    for r in range(len(rows)):
        for c in range(columns):
            if (r + c + mark_shift) % 3 == 0:
                set_cell(grid, cells, r, c, rows, visits, "x")
    return {
        "key": key,
        "title": title,
        "branch": None,
        "phase": f"serie {prefix}",
        "visits": visits,
        "rows": rows,
        "grid": grid,
        "cells": cells,
        "notes": [],
        "narratives": [],
        "pages": [],
        "stripPages": [],
        "prefix": prefix,
    }


def build_f7():
    labels = catalog_es()
    # 5 páginas × 4 filas por tira.
    per_page = 4
    pages = 5
    need = per_page * pages
    strip_a = make_strip("T1", "Tira de la serie V", "V", 20, labels[:need], 0)
    strip_b = make_strip("T2", "Tira de la serie W", "W", 24, labels[need:need * 2], 1)
    for layout, prefix in ((f7_layout(20), "V"), (f7_layout(24), "W")):
        for index in range(layout["n"]):
            require_fit(prefix, "DejaVu", 7, layout["vw"], "F7 prefijo")
            require_fit(str(index + 1), "DejaVu", 9, layout["vw"], "F7 número")
    doc = Doc("F7", 1007, 7, "es")
    doc.tables.extend([strip_a, strip_b])
    doc.add(draw_cover(doc), (612.0, 792.0), "cover")
    doc.false_hit_pages.append(doc.add(draw_synopsis(doc, lambda: strip_a["pages"][0]), (612.0, 792.0), "false"))
    layout_a, layout_b = f7_layout(20), f7_layout(24)
    for index in range(pages):
        r0 = index * per_page
        r1 = r0 + per_page
        page = doc.add(
            draw_f7_page(doc, [
                (strip_a, r0, r1, "V", layout_a),
                (strip_b, r0, r1, "W", layout_b),
            ]),
            LANDSCAPE,
            "grid",
        )
        strip_a["pages"].append(page)
        strip_b["pages"].append(page)
    if len(doc.items) != doc.n_pages:
        raise SystemExit(f"F7 páginas {len(doc.items)} != {doc.n_pages}")
    doc.f7_strips = (strip_a, strip_b)
    return doc, []


def page_content(page):
    data = page.get_contents()
    if data is None:
        return b""
    parts = data if isinstance(data, list) else [data]
    return b"\n".join(part.get_data() for part in parts)


def check_common(pdf, doc):
    reader = PdfReader(io.BytesIO(pdf))
    if len(reader.pages) != doc.n_pages:
        raise SystemExit(f"{doc.fixture} pdf {len(reader.pages)} != {doc.n_pages}")
    texts = []
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        texts.append(text)
        item = doc.items[index - 1]
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        folded = text.casefold()
        locator = "cronograma de actividades"
        if item["kind"] == "grid":
            if not width > height:
                raise SystemExit(f"{doc.fixture} página {index} no está apaisada ({width}×{height})")
            if abs(width - PAGE_W) > 0.5 or abs(height - PAGE_H) > 0.5:
                raise SystemExit(f"{doc.fixture} página {index} mide {width}×{height}")
            if locator not in folded:
                raise SystemExit(f"{doc.fixture} página {index} no tiene el título de la grilla")
            content = page_content(page)
            item["content"] = content
        elif item["kind"] == "false":
            if locator not in folded:
                raise SystemExit(f"{doc.fixture} falso acierto sin localizador")
            if index not in doc.false_hit_pages:
                raise SystemExit(f"{doc.fixture} página {index} es falso acierto y no está en el gold")
        elif locator in folded:
            raise SystemExit(f"{doc.fixture} página {index} ({item['kind']}) repite el localizador")
    folded = "\n".join(texts).casefold()
    for word in FORBIDDEN:
        if word in folded:
            raise SystemExit(f"{doc.fixture} contiene un término prohibido: {word}")
    return reader


def check_f6(pdf, doc, gold):
    check_common(pdf, doc)
    header = gold["header"]
    pages = header["pages"]
    if len(pages) < 20 or len(gold["document"]["sopPages"]) < 20:
        raise SystemExit("F6 no llega a 20 páginas de cronograma")
    glyphs = [column["glyph"] for column in pages[0]["columns"]]
    if glyphs != ["-" if value is None else str(value) for value in F6_VALUES]:
        raise SystemExit(f"F6 fichas {glyphs}")
    integers = [int(column["text"]) for column in pages[0]["columns"] if not column["dash"]]
    if integers != sorted(integers) or len(integers) < 3 or len({column["index"] for column in pages[0]["columns"] if column["dash"]}) < 2:
        raise SystemExit("F6 no tiene enteros crecientes y dos guiones")
    for period in header["periods"]:
        if period["end"] - period["start"] < 2:
            raise SystemExit("F6 período sin agrupar")
    for page in pages:
        if [column["glyph"] for column in page["columns"]] != glyphs:
            raise SystemExit(f"F6 página {page['page']} no repite el encabezado")
        if page["label"]["text"] != "Número de visita":
            raise SystemExit("F6 sin etiqueta de fila")
        if page["labelColumn"]["countsAsVisit"] or page["commentsStrip"]["countsAsVisit"]:
            raise SystemExit("F6 cuenta la etiqueta o los comentarios como visita")
        if not 2 <= page["rows"] <= 6:
            raise SystemExit("F6 filas fuera de 2–6")
    reader = PdfReader(io.BytesIO(pdf))
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        text = reader.pages[item["page"] - 1].extract_text() or ""
        for needle in ("Número de visita", "Selección", "Tratamiento", "Seguimiento", "Día"):
            if needle not in text:
                raise SystemExit(f"F6 página {item['page']} no muestra {needle}")


def check_f7(pdf, doc, gold):
    check_common(pdf, doc)
    strips = gold["strips"]
    if [strip["visitColumns"] for strip in strips] != [20, 24]:
        raise SystemExit("F7 no tiene tiras de 20 y 24")
    if len(strips[0]["pages"]) < 4:
        raise SystemExit("F7 no llega a 4 páginas")
    pages = [page["page"] for page in strips[0]["pages"]]
    if pages != [page["page"] for page in strips[1]["pages"]] or pages != gold["document"]["sopPages"]:
        raise SystemExit("F7 las dos tiras no comparten las páginas de cronograma")
    for strip, prefix in zip(strips, ("V", "W")):
        for page in strip["pages"]:
            if page["headerRows"] != [{"role": "prefix", "fontSize": 7}, {"role": "number", "fontSize": 9}]:
                raise SystemExit("F7 la ficha no está partida en prefijo y número a 9 pt")
            if page["prefixRow"]["bbox"][1] != page["numberRow"]["bbox"][3]:
                raise SystemExit("F7 filas de la ficha separadas")
            if page["dataRows"][0]["bbox"][3] != page["numberRow"]["bbox"][1]:
                raise SystemExit("F7 las filas de datos no cuelgan de la tira")
            if page["labelColumn"]["countsAsVisit"]:
                raise SystemExit("F7 la columna de etiquetas cuenta como visita")
            if len(page["columns"]) != strip["visitColumns"]:
                raise SystemExit("F7 columnas distintas del ancho de la tira")
            for column in page["columns"]:
                if column["prefix"] != prefix or column["numberFontSize"] != 9:
                    raise SystemExit("F7 ficha mal partida")
                if column["printedId"] != f"{prefix}{column['number']}":
                    raise SystemExit("F7 el id no junta prefijo y número")
    reader = PdfReader(io.BytesIO(pdf))
    for item in doc.items:
        if item["kind"] != "grid":
            continue
        content = page_content(reader.pages[item["page"] - 1])
        # 20 números de la tira V + 24 de la tira W, cada uno a 9 pt.
        if content.count(b"9 Tf") < 44:
            raise SystemExit(f"F7 página {item['page']} no dibuja los números a 9 pt ({content.count(b'9 Tf')})")


def attach_f6(doc, gold):
    table = doc.f6_table
    pages = table["headerPages"]
    gold["header"] = {
        "kind": "numeric_visit",
        "label": "Número de visita",
        "repeatedOnEveryGridPage": True,
        "rowsPerPage": [page["rows"] for page in pages],
        "tokens": [
            {"index": column["index"], "text": column["text"], "dash": column["dash"], "glyph": column["glyph"]}
            for column in pages[0]["columns"]
        ],
        "periods": [
            {"label": label, "start": start, "end": end}
            for start, end, label in F6_PERIODS
        ],
        "timeRowLabel": "Día",
        "commentsStripCountsAsVisit": False,
        "labelColumnCountsAsVisit": False,
        "pages": pages,
    }


def attach_f7(doc, gold):
    strips = []
    for table in doc.f7_strips:
        strips.append({
            "key": "A" if table["prefix"] == "V" else "B",
            "tableKey": table["key"],
            "prefix": table["prefix"],
            "visitColumns": len(table["visits"]),
            "labelColumnCountsAsVisit": False,
            "repeatedOnEveryGridPage": True,
            "pages": table["stripPages"],
        })
    gold["strips"] = strips


def emit_doc(doc, extra, attach, check):
    pdf = render(doc)
    difficulty = json.loads(json.dumps(doc.difficulty))
    pdf_again = render(doc)
    doc.difficulty = difficulty
    if pdf != pdf_again:
        raise SystemExit(f"{doc.fixture} no es determinista")
    gold = gold_from(doc, extra)
    gold["generatorVersion"] = VERSION
    gold["document"]["gridOrientation"] = "landscape"
    gold["document"]["gridPageSize"] = [PAGE_W, PAGE_H]
    attach(doc, gold)
    require_geometry(doc, gold)
    check(pdf, doc, gold)
    n_cells = len(gold["cells"])
    n_grid = len(gold["document"]["sopPages"])
    print(
        f"{doc.fixture} version={gold['generatorVersion']} pages={gold['document']['pages']} "
        f"grid={n_grid} visits={len(gold['visits'])} cells={n_cells}"
    )
    OUT.mkdir(parents=True, exist_ok=True)
    pdf_path = OUT / f"{doc.fixture}.pdf"
    pdf_path.write_bytes(pdf)
    (OUT / f"{doc.fixture}.gold.json").write_text(
        json.dumps(gold, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_pngs(pdf_path, OUT / f"{doc.fixture}.render")
    return gold


def emit_named(names):
    builders = {"F6": (build_f6, attach_f6, check_f6), "F7": (build_f7, attach_f7, check_f7)}
    for name in names:
        build, attach, check = builders[name]
        doc, extra = build()
        emit_doc(doc, extra, attach, check)


if __name__ == "__main__":
    import sys
    emit_named(sys.argv[1:] or ["F6", "F7"])
