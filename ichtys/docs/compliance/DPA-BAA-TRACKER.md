# DPA / BAA Tracker — Procesadores de datos Ichtys

**Versión:** 1.0  
**Última actualización:** 2026-06-30  
**Owner:** Legal / DPO

---

## 1. Propósito

Registrar acuerdos con procesadores/subcontratistas antes de procesar PHI. **Bloqueante Fase 0** para activar módulo de sujetos.

---

## 2. Leyenda de estado

| Estado | Significado |
|--------|-------------|
| ⬜ No iniciado | Sin contacto |
| 🟡 En negociación | DPA/BAA en revisión |
| ✅ Firmado | Vigente |
| ❌ No disponible | Proveedor no ofrece BAA — evaluar alternativa |
| N/A | No procesa PHI |

---

## 3. Registro de procesadores

| Proveedor | Servicio | Datos procesados | Región | GDPR DPA | HIPAA BAA | SOC 2 | Estado | Fecha | Notas |
|-----------|----------|------------------|--------|----------|-----------|-------|--------|-------|-------|
| **Neon** | Postgres hosting | D1–D7 | US/EU* | ⬜ | ⬜ | ✅ | ⬜ | — | Verificar región del proyecto `fragrant-sun-79639780` |
| **Vercel** | Hosting, Blob, KV | D2, D3 transient | Global | ⬜ | ⬜ | ✅ | ⬜ | — | DPA: vercel.com/legal/dpa |
| **Clerk** | Auth, orgs | D1, D6 | US | ⬜ | N/A | ✅ | ⬜ | — | |
| **Anthropic** | LLM inference | D3, D5 transient | US | ⬜ | 🟡 | — | ⬜ | — | API BAA: contact sales; zero-retention API |
| **OpenAI** | Embeddings | D2 (chunks) | US | ⬜ | 🟡 | ✅ | ⬜ | — | BAA available for API |
| **Upstash** | Rate limit Redis | Metadata only | EU/US | ⬜ | N/A | ✅ | ⬜ | — | No PHI en keys |
| **Azure DI** (Fase 3) | OCR labs | D5 transient | Configurable | ⬜ | ✅ eligible | ✅ | N/A | — | Activar al implementar OCR |

\* Confirmar región exacta en dashboard Neon y documentar aquí.

---

## 4. Acciones requeridas (Fase 0)

### Prioridad 1 — Antes de PHI en prod

- [ ] Firmar DPA con Neon (o migrar a región EU si requerido por sponsor)
- [ ] Firmar DPA con Vercel
- [ ] Firmar DPA con Clerk
- [ ] Obtener BAA Anthropic (API enterprise) o confirmar zero-data-retention + DPA
- [ ] Obtener BAA OpenAI (si embeddings incluyen texto con PHI potencial — **mitigar**: no embedear D5)

### Prioridad 2 — Documentación

- [ ] Subcategoría de procesadores en registro de actividades GDPR
- [ ] Cláusulas contractuales estándar (SCC) si transferencia US desde UE
- [ ] Archivar PDFs firmados en repositorio seguro (no git)

---

## 5. Configuración técnica post-BAA

| Proveedor | Configuración |
|-----------|---------------|
| Anthropic | Confirmar política de retención API = 0 días; no training |
| OpenAI | `store: false` en API calls; organización con BAA |
| Neon | Encryption at rest verificada; IP allowlist opcional |
| Vercel | Blob `access: private` (ya implementado) |

---

## 6. Revisión

Trimestral o al incorporar nuevo procesador.

---

## 7. Enlaces útiles

- Vercel DPA: https://vercel.com/legal/dpa
- OpenAI BAA: https://openai.com/enterprise-privacy
- Anthropic: https://www.anthropic.com/legal/privacy
- Neon: https://neon.tech/terms-of-service
