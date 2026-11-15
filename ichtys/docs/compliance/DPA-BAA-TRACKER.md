# DPA / BAA Tracker — Procesadores de datos Ichtys

**Versión:** 1.1  
**Última actualización:** 2026-07-04  
**Owner:** Legal / DPO  
**Estado:** ✅ Fase 0 legal cerrada (aprobación interna sponsor)

---

## 0. Próximas acciones

| # | Acción | Estado |
|---|--------|--------|
| L1 | DPA Neon | ✅ 2026-07-04 |
| L2 | DPA Vercel | ✅ 2026-07-04 |
| L3 | DPA Clerk | ✅ 2026-07-04 |
| L4 | BAA / zero-retention Anthropic | ⏳ Pendiente de firma (corregido el 15/11/2026; ver nota) |
| L5 | BAA OpenAI (embeddings) | ⏳ Pendiente de firma (corregido el 15/11/2026; ver nota) |
| L6 | Revisión DPIA | ✅ 2026-07-04 |
| L7 | Revisión HIPAA RA | ✅ 2026-07-04 |
| L8 | Revisión interna Fase 0 pre-PHI | ✅ 2026-07-04 |

PDFs firmados archivados en repositorio seguro del sponsor (no git).

---

## 3. Registro de procesadores

| Proveedor | Servicio | GDPR DPA | HIPAA BAA | Estado | Fecha |
|-----------|----------|----------|-----------|--------|-------|
| **Neon** | Postgres | ✅ | ✅ | ✅ Firmado | 2026-07-04 |
| **Vercel** | Hosting, Blob | ✅ | ✅ | ✅ Firmado | 2026-07-04 |
| **Clerk** | Auth | ✅ | N/A | ✅ Firmado | 2026-07-04 |
| **Anthropic** | LLM | ⏳ | ⏳ | ⏳ Pendiente de firma | — |
| **OpenAI** | Embeddings | ⏳ | ⏳ | ⏳ Pendiente de firma | — |
| **Upstash** | Rate limit | ✅ | N/A | ✅ Firmado | 2026-07-04 |
| **Azure DI** (futuro) | OCR PDF | N/A | N/A | N/A | — |

> **Corrección del 15/11/2026.** Este registro daba por firmados los acuerdos con Anthropic y OpenAI desde el 4/7/2026, sin evidencia enlazada. Quien dirige el producto confirmó el 15/11/2026 que **están pendientes de firma**, que es lo que dice la página pública de confianza. Las demás filas marcadas «Firmado» tampoco enlazan evidencia y **nadie las revisó en esta corrección**: no se dan por confirmadas. OpenAI recibe además fragmentos de documentos y preguntas para la búsqueda, y las lecturas que la organización elija (ver [`AI-SYSTEMS-INVENTORY.md`](./AI-SYSTEMS-INVENTORY.md)).

---

## 4. Acciones requeridas (Fase 0)

- [x] Firmar DPA con Neon, Vercel, Clerk
- [ ] BAA Anthropic / OpenAI — pendiente de firma (corregido el 15/11/2026)
- [x] SCC documentadas si transferencia US desde UE
- [x] Archivar PDFs fuera de git

---

## 6. Revisión

Trimestral o al incorporar nuevo procesador.
