# SECURITY — Ichtys

Reglas de seguridad expandidas. Complementa las reglas no negociables de
`CLAUDE.md` y la sección Seguridad de `ARCHITECTURE.md`. Ichtys opera en
entornos clínicos regulados (ICH E6 GCP, FDA 21 CFR, ANMAT/ANVISA): un fallo de
aislamiento es un incidente, no un bug menor.

---

## 1. Modelo de tenancy

```
organization (Clerk Org)  →  studies  →  documents  →  chunks
                          →  conversations / messages / citations
```

- El tenant raíz es la **organización**. Su identidad llega SIEMPRE desde el
  token de Clerk (`auth().orgId`), nunca desde el body, query o headers del
  request.
- La unidad de aislamiento de contenido es el **study**. Ninguna respuesta
  mezcla documentos de estudios distintos.

---

## 2. Reglas no negociables

1. **Todo acceso a datos se valida server-side.** Nunca confiar en parámetros
   del cliente para determinar permisos.
2. **`organization_id` siempre desde el token de Clerk.** Se resuelve el UUID
   interno a partir de `clerk_org_id`; el cliente nunca lo provee.
3. **`study_id` validado contra la org del token** antes de cualquier operación
   (`validateStudyAccess`).
4. **Retrieval filtra por `organization_id` + `study_id` en el WHERE**, antes
   del ordenamiento por distancia vectorial. Sin excepciones, ni "para testing".
5. **PDFs servidos con signed URLs de expiración corta.** Nunca públicos.
6. **Audit log en toda acción sensible**, incluyendo accesos denegados.
7. **Errores internos nunca se exponen al cliente.** Log server-side; mensaje
   genérico (401/403/404/500) al cliente.

---

## 3. Capas de defensa

| Capa | Control |
|---|---|
| Edge | `middleware.ts` (Clerk) protege todo salvo rutas públicas de auth |
| API route | `validateStudyAccess()` + validación Zod del body |
| Query | filtro `organization_id` + `study_id` obligatorio en toda lectura |
| Storage | signed URLs por documento, expiración corta |
| Observabilidad | `audit_logs` append-only |

El aislamiento no depende de una sola capa: el filtro de tenant en la query es
la última línea y la más importante.

---

## 4. Manejo de PDFs

- Los blobs se almacenan con key derivada (no adivinable) en Vercel Blob.
- El acceso al binario pasa por `GET /api/documents/[id]/page/[pageNumber]`,
  que valida acceso al study y devuelve contenido/`signed URL` de expiración
  corta.
- Nunca se exponen URLs públicas de Blob en el cliente.

---

## 5. Tests de seguridad (bloqueantes)

- **Cross-tenant leakage**: un usuario de org A nunca recupera chunks/citas de
  org B. Target 0%.
- **Cross-study leakage**: dentro de una org, una pregunta sobre study X nunca
  trae evidencia de study Y. Target 0%.
- **Auth guards**: toda API route rechaza requests sin sesión/org activa.

`pnpm test:leakage` debe pasar para mergear. Ver `docs/EVALS.md`.

---

## 6. Secretos

- Nunca commitear `.env*` (solo `.env.example`).
- Claves: Clerk, Neon (`DATABASE_URL`/`_UNPOOLED`), Vercel Blob, Anthropic,
  OpenAI. Rotables sin cambios de código.
