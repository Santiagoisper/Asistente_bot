# Clasificación de datos — Ichtys

**Versión:** 1.0  
**Vigencia:** 2026-06-30

---

## 1. Propósito

Definir categorías de datos procesados por Ichtys para aplicar controles proporcionales (cifrado, acceso, retención, logging).

---

## 2. Categorías

| Clase | Descripción | Ejemplos en Ichtys | PHI/PII | Cifrado field-level | Embeddings |
|-------|-------------|-------------------|---------|---------------------|------------|
| **D1 — Público operacional** | Metadatos no sensibles | Nombre de estudio, protocol number, roles | No | No | No |
| **D2 — Documentos de estudio** | PDFs de protocolo, IB, manuales (sin datos de sujetos) | Protocolo GZBO, Lab Manual | No* | No (Blob privado) | Sí (chunks) |
| **D3 — Datos de conversación (docs)** | Preguntas sobre protocolo que pueden mencionar valores hipotéticos | "¿HbA1c 9.2% cumple?" | Potencial | No en MVP actual | No |
| **D4 — Identificadores de sujeto** | Pseudónimos de ensayo | `subject_code` S-001 | Pseudonimizado | No | **Prohibido** |
| **D5 — Datos clínicos de sujeto** | Evolución, medicación, labs, screening | Texto evolución, perfil estructurado | **Sí** | **Obligatorio** | **Prohibido** |
| **D6 — Credenciales y secretos** | API keys, tokens | Clerk, Neon, PHI_ENCRYPTION_KEY | N/A | N/A | N/A |
| **D7 — Audit logs** | Trazabilidad sin contenido clínico | action, userId, resourceId | No (metadata only) | No | No |

\* Los documentos D2 no deben contener PHI según política de upload. Si se detecta PHI en upload de estudio, el documento debe rechazarse o redactarse.

---

## 3. Reglas por categoría

### D5 — Datos clínicos (Fase 1+)

1. Almacenar `clinical_evolutions.content` cifrado con `@ichtys/crypto`
2. Almacenar `patient_profiles.profile_json` cifrado
3. **Nunca** indexar en pgvector ni enviar a embeddings
4. **Nunca** incluir en logs, audit metadata, o prompts persistidos
5. Acceso solo con rol `site_coordinator`, `principal_investigator`, o superior
6. Toda lectura/escritura genera audit log (sin contenido)

### D3 — Mitigación actual

Las preguntas de chat pueden contener datos hipotéticos de pacientes. Política:
- No persistir en evals datasets reales
- Capacitar usuarios: preferir pseudónimos y códigos de sujeto
- Migrar a flujo D5 estructurado en Fase 1

---

## 4. Ubicación por proveedor

| Proveedor | Clases almacenadas | Región | Acuerdo |
|-----------|-------------------|--------|---------|
| Neon Postgres | D1–D5, D7 | [Verificar en DPA] | [Pendiente BAA/DPA] |
| Vercel Blob | D2 | [Verificar] | [Pendiente] |
| Vercel Functions | D3 transient | Edge/US | [Pendiente] |
| Anthropic | D3, D5 transient (inferencia) | US | [Pendiente BAA] |
| OpenAI | Embeddings D2 | US | [Pendiente BAA] |
| Clerk | D1, D6 | [Verificar] | [Pendiente DPA] |

Ver [DPA-BAA-TRACKER.md](./DPA-BAA-TRACKER.md).

---

## 5. Etiquetado en código

Campos D5 en schema Drizzle (Fase 1) deben documentarse:

```typescript
/** @data-class D5 — encrypt with encryptPhiField before persist */
content: text('content').notNull()
```
