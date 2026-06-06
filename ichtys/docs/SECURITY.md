# SECURITY - Ichtys

Reglas de seguridad expandidas. Complementa las reglas no negociables de
`CLAUDE.md` y la seccion Seguridad de `ARCHITECTURE.md`. Ichtys opera en
entornos clinicos regulados (ICH E6 GCP, FDA 21 CFR, ANMAT/ANVISA): un fallo de
aislamiento es un incidente, no un bug menor.

---

## 1. Modelo de tenancy

```
organization (Clerk Org) -> studies -> documents -> chunks
                         -> conversations / messages / citations
```

- El tenant raiz es la **organizacion**. Su identidad llega SIEMPRE desde el
  token de Clerk (`auth().orgId`), nunca desde el body, query o headers del
  request.
- La unidad de aislamiento de contenido es el **study**. Ninguna respuesta
  mezcla documentos de estudios distintos.

---

## 2. Reglas no negociables

1. **Todo acceso a datos se valida server-side.** Nunca confiar en parametros
   del cliente para determinar permisos.
2. **`organization_id` siempre desde el token de Clerk.** Se resuelve el UUID
   interno a partir de `clerk_org_id`; el cliente nunca lo provee.
3. **`study_id` validado contra la org del token** antes de cualquier operacion
   (`validateStudyAccess`).
4. **Retrieval filtra por `organization_id` + `study_id` en el WHERE**, antes
   del ordenamiento por distancia vectorial. Sin excepciones, ni "para testing".
5. **PDFs servidos solo por endpoints autenticados.** Blob privado; nunca URLs
   publicas directas al cliente.
6. **Audit log en toda accion sensible**, incluyendo accesos denegados.
7. **Errores internos nunca se exponen al cliente.** Log server-side; mensaje
   generico (401/403/404/500) al cliente.

---

## 3. Capas de defensa

| Capa | Control |
|---|---|
| Edge | `middleware.ts` (Clerk) protege todo salvo rutas publicas de auth |
| API route | `validateStudyAccess()` + validacion Zod del body |
| Query | filtro `organization_id` + `study_id` obligatorio en toda lectura |
| Storage | Vercel Blob privado; acceso binario por endpoint autenticado |
| Observabilidad | `audit_logs` append-only |

El aislamiento no depende de una sola capa: el filtro de tenant en la query es
la ultima linea y la mas importante.

---

## 4. Manejo de PDFs

- Los blobs se almacenan con key derivada (no adivinable) en Vercel Blob.
- El acceso al binario pasa por
  `GET /api/document-versions/[documentVersionId]/download`, que valida
  autenticacion y object-level authorization antes de leer Blob privado.
- Nunca se exponen URLs publicas de Blob en el cliente.
- Nunca se exponen `blob_url` ni `blob_key` en respuestas de descarga.

---

## 5. Tests de seguridad (bloqueantes)

- **Cross-tenant leakage**: un usuario de org A nunca recupera chunks/citas de
  org B. Target 0%.
- **Cross-study leakage**: dentro de una org, una pregunta sobre study X nunca
  trae evidencia de study Y. Target 0%.
- **Auth guards**: toda API route rechaza requests sin sesion/org activa.

`pnpm test:leakage` debe pasar para mergear. Ver `docs/EVALS.md`.

---

## 6. Secretos

- Nunca commitear `.env*` (solo `.env.example`).
- Claves: Clerk, Neon (`DATABASE_URL`/`_UNPOOLED`), Vercel Blob, Anthropic,
  OpenAI. Rotables sin cambios de codigo.

---

## 7. Object-level authorization

Validar `study_id` no alcanza cuando una ruta recibe un id de objeto. Todo
`documentId`, `messageId`, `citationId` o acceso a pagina debe validarse en DB
contra la organizacion activa y el study real del objeto antes de devolver datos.

Reglas:

- `organization_id` sigue viniendo solo del token de Clerk y se resuelve al UUID
  interno de `organizations`.
- `documentId` se busca con `documents.id` + `documents.organization_id`; luego
  `documents.study_id` se cruza contra `studies.organization_id`.
- `documentVersionId` se busca con `document_versions.id` +
  `document_versions.organization_id`; luego se verifica el `document` y el
  `study` asociados.
- `messageId` se busca con `messages.id` + `messages.organization_id`; luego
  `messages.study_id` se cruza contra `studies.organization_id`.
- Las citas se leen solo con `citations.message_id` +
  `citations.organization_id` + `citations.study_id` derivados del mensaje
  validado.
- Las paginas se autorizan despues de validar el documento y se buscan con
  `pages.organization_id` + `pages.study_id` + la version documental validada.
- Objetos fuera de la org/study activa devuelven `404 Not Found`, no `403`, para
  evitar enumeration leakage.

Estos tests son bloqueantes para release junto con cross-tenant y cross-study
leakage.

---

## 8. Document upload and private Blob storage

`POST /api/documents/upload` accepts only PDF uploads for a `studyId` that has
already been validated with `validateStudyAccess()`. `organization_id` is
rejected if it appears in body/FormData or query params; the internal org UUID is
always derived from Clerk server-side auth.

Storage and registry rules:

- PDFs are uploaded to Vercel Blob with `access: 'private'`.
- Upload responses never expose Blob URLs or download URLs.
- PDF reads/downloads go through
  `GET /api/document-versions/[documentVersionId]/download`, which revalidates
  object access before reading private Blob.
- `documents` and `document_versions` both persist the same
  `organization_id` and `study_id` so every later read can enforce tenant
  isolation without joining through client-provided ids.
- Document status reads the latest `document_versions` row only after
  validating the `documentId` against the active org and the document study.
- `document.upload` audit logs are mandatory. If the audit insert fails, the
  upload request fails with a generic 500.

This phase keeps the existing server route handler upload pattern and enforces a
conservative 4 MiB application limit. It intentionally does not claim robust
50MB support. Supporting 50MB+ PDFs safely should move to a direct/client Blob
upload or presigned flow, with document registration after server-side
validation of the completed private blob.

---

## 9. Document ingestion

Upload and ingestion are separate security boundaries. Upload registers a
private blob and a pending `document_version`; ingestion later processes one
authorized `documentVersionId`.

Ingestion rules:

- The HTTP route validates Clerk auth and object-level access to
  `document_versions.id` before calling the internal pipeline.
- The internal pipeline receives `userId`, `orgId`, `studyId`, `documentId`, and
  `documentVersionId` from that validated context; it does not call Clerk.
- The pipeline revalidates `documents` and `document_versions` against
  `organization_id` + `study_id` before reading Blob or writing rows.
- `pages` and `chunks` persist `organization_id` and `study_id` from the
  authorized context. No page or chunk may be inserted without both boundaries.
- Chunks in this phase have metadata only; embeddings, retrieval, and RAG remain
  out of scope.
- OCR is out of scope. PDFs with no extractable text are marked `error` with a
  sanitized code.
- Ingestion errors stored on `document_versions.error_message` are sanitized
  codes, never stack traces or provider internals.

---

## 10. Authenticated PDF download/preview

PDF download uses `documentVersionId` as the access unit, matching ingestion and
version status. The route validates the requested version with
`validateDocumentVersionAccess()`, which resolves the active Clerk organization
to the internal `organization_id`, filters `document_versions` by that org, then
verifies the related document and study.

Download rules:

- `organization_id` and `organizationId` in query params are rejected before
  auth or storage work.
- The route reads Blob through the stored private `blob_key` only after
  authorization succeeds.
- The HTTP response is `application/pdf` with attachment disposition and
  `Cache-Control: private, no-store`.
- The response never includes `blob_url`, `blob_key`, or Blob download URLs.
- `document.download` audit logs are mandatory and carry `organization_id`,
  `study_id`, `user_id`, `resource_type = document_version`, and
  `resource_id = documentVersionId`.

Inline preview is a future extension and must use the same authenticated,
object-authorized path or an equivalent server-controlled mechanism.
