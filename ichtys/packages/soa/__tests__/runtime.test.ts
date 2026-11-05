/**
 * T13 — runtime: el paquete carga y corre en Node puro, sin DOM ni polyfills
 * de navegador, igual que la ingesta. `environment: 'node'` está fijo en el
 * vitest.config del paquete; si pdfjs-dist legacy necesitara DOMMatrix o
 * canvas, este archivo falla primero.
 *
 * La otra mitad de T13 (el `next build` de apps/web no cambia) se verifica por
 * fuera de la suite: P2 todavía no se importa desde web.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry } from '../index'
import type { PageGeom } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

describe('T13 — @ichtys/soa corre en Node sin DOM', () => {
  it('carga F4 completo (8 páginas) y devuelve geometría bien formada', async () => {
    const pdf = new Uint8Array(readFileSync(`${FIXTURES_DIR}F4.pdf`))
    const pages: PageGeom[] = await loadPageGeometry(pdf)

    expect(pages).toHaveLength(8)
    for (const page of pages) {
      expect(page.width).toBeGreaterThan(0)
      expect(page.height).toBeGreaterThan(0)
      expect([0, 90, 180, 270]).toContain(page.rotate)
      expect(Array.isArray(page.items)).toBe(true)
      expect(Array.isArray(page.rules)).toBe(true)
    }
    // El relleno tiene texto en todas las páginas y alguna regla en la grilla.
    expect(pages.every((page) => page.items.length > 0)).toBe(true)
    expect(pages.some((page) => page.rules.length > 0)).toBe(true)
  })
})
