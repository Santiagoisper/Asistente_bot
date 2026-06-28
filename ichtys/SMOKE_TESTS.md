# ALPHI — Smoke Test Checklist

**App URL**: http://localhost:3001  
**Propósito**: Verificar cada endpoint y pantalla crítica antes de deployar.  
**Con límite de API Anthropic**: los tests de chat fallarán en el step LLM hasta el 1/7. Todo lo demás es testeable.

---

## 0. Setup — Obtener token de sesión

Para testear endpoints protegidos con curl:

1. Abrí http://localhost:3001 en el browser
2. Hacé login con Clerk
3. Abrí DevTools → Application → Cookies → `localhost`
4. Buscá la cookie `__session` (o abrí Network → cualquier API call → Headers → `Authorization: Bearer <token>`)
5. Guardá ese token:

```bash
TOKEN="eyJ..."  # pegá tu token acá
STUDY_ID=""     # pegá el UUID del estudio con el que querés testear
BASE="http://localhost:3001"
```

---

## 1. Páginas — Verificación manual en browser

| # | Ruta | Qué verificar | ✓/✗ |
|---|------|---------------|-----|
| 1.1 | `/sign-in` | Formulario Clerk renderiza, login funciona | |
| 1.2 | `/dashboard` | Lista de estudios carga, cards con nombre/protocolo | |
| 1.3 | `/studies` | Tabla de estudios visible, navegación OK | |
| 1.4 | `/studies/[id]/documents` | Lista de documentos del estudio, estado de procesamiento | |
| 1.5 | `/studies/[id]/spec` | Spec review con criterios, chips SNOMED/LOINC, botón "Preguntar a ALPHI" | |
| 1.6 | `/studies/[id]/chat` | Chat UI carga, input habilitado | |
| 1.7 | `/studies/[id]/history` | Historial de conversaciones | |
| 1.8 | `/admin` | Panel admin accesible (solo org admins) | |

---

## 2. API — Endpoints de lectura

### 2.1 Estudios

```bash
# GET /api/studies — lista estudios de la org
curl -s "$BASE/api/studies" \
  -H "Authorization: Bearer $TOKEN" | jq '.studies | length'
# Esperado: número > 0
```

### 2.2 Conversaciones

```bash
# GET /api/conversations — lista conversaciones del estudio
curl -s "$BASE/api/conversations?studyId=$STUDY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
# Esperado: { conversations: [...] }
```

```bash
# Guardá un conversationId del resultado anterior
CONV_ID=""

# GET /api/conversations/[id]/messages
curl -s "$BASE/api/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $TOKEN" | jq '.messages | length'
# Esperado: número ≥ 0
```

### 2.3 Citas

```bash
# Necesitás un messageId de un mensaje assistant
MSG_ID=""

curl -s "$BASE/api/citations/$MSG_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
# Esperado: { citations: [...] } o { citations: [] }
```

### 2.4 Spec

```bash
curl -s "$BASE/api/studies/$STUDY_ID/spec" \
  -H "Authorization: Bearer $TOKEN" | jq '.spec.status'
# Esperado: "draft" | "approved" | null
```

### 2.5 Estado de documento

```bash
# Necesitás un documentId del estudio
DOC_ID=""

curl -s "$BASE/api/documents/$DOC_ID/status" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
# Esperado: { status: "processed" | "processing" | "pending" }
```

---

## 3. API — Upload de documento

```bash
# POST /api/documents/upload — sube un PDF al estudio
curl -s -X POST "$BASE/api/documents/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/protocolo.pdf" \
  -F "studyId=$STUDY_ID" \
  -F "documentType=protocol" | jq '.'
# Esperado: { documentId: "...", documentVersionId: "...", status: "pending" }
```

---

## 4. API — Ingestion

```bash
# POST /api/ingestion/run — procesa documentos pendientes
curl -s -X POST "$BASE/api/ingestion/run" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"studyId\": \"$STUDY_ID\"}" | jq '.'
# Esperado: { processed: N, failed: 0 }
```

---

## 5. API — RAG pipeline (sin LLM)

```bash
# GET /api/rag/answer-test — smoke test del retriever
# (si el endpoint acepta GET con query params)
curl -s "$BASE/api/rag/answer-test?studyId=$STUDY_ID&q=criterios+de+inclusion" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
# Esperado: chunks encontrados con similarityScore
```

---

## 6. API — Chat streaming

```bash
# POST /api/chat/stream — pipeline completo
# NOTA: con límite de API Anthropic hasta 1/7, fallará en el step LLM.
# Verificar que: retrieval funciona, error llega limpio al cliente (no hang)

curl -s -X POST "$BASE/api/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"studyId\": \"$STUDY_ID\", \"question\": \"cuantas visitas tiene el protocolo\"}" \
  --no-buffer 2>&1 | head -20

# Esperado hasta 1/7:
#   data: {"type":"start",...}
#   data: {"type":"error"}   ← limpio, no hang indefinido

# Esperado desde 1/7:
#   data: {"type":"start",...}
#   data: {"type":"token","text":"..."}  ← N veces
#   data: {"type":"done","confidence":"high",...}
```

---

## 7. API — Spec approve

```bash
# POST /api/studies/[id]/spec/[specId]/approve
SPEC_ID=""

curl -s -X POST "$BASE/api/studies/$STUDY_ID/spec/$SPEC_ID/approve" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq '.'
# Esperado: { success: true, status: "approved" }
```

---

## 8. Checklist de seguridad — Tenant isolation

Estos deben devolver 403 o 404, nunca datos de otra org:

```bash
# Intentar acceder a un studyId que no pertenece a tu org
FOREIGN_STUDY_ID="00000000-0000-0000-0000-000000000001"

curl -s "$BASE/api/studies/$FOREIGN_STUDY_ID/spec" \
  -H "Authorization: Bearer $TOKEN" | jq '.error // .status'
# Esperado: 403 o 404

curl -s -X POST "$BASE/api/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"studyId\": \"$FOREIGN_STUDY_ID\", \"question\": \"test\"}" | jq '.'
# Esperado: 403

# Intentar inyectar orgId en el body (debe ser ignorado)
curl -s -X POST "$BASE/api/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"studyId\": \"$STUDY_ID\", \"orgId\": \"inyectado\", \"question\": \"test\"}" | jq '.'
# Esperado: 400 Bad Request (campo orgId rechazado por .strict())
```

---

## 9. Checklist de rate limiting

```bash
# Enviar 6 requests rápidos al chat (límite por defecto: 5/ventana)
for i in {1..6}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/chat/stream" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"studyId\": \"$STUDY_ID\", \"question\": \"test $i\"}")
  echo "Request $i: $STATUS"
done
# Esperado: primeros 5 → 200, el 6to → 429
```

---

## 10. Resumen de estado

| Área | Estado | Notas |
|------|--------|-------|
| Auth / Clerk | ✓ | |
| Upload de documentos | ✓ | |
| Ingestion pipeline | ✓ | |
| Retrieval (embedding + pgvector) | ✓ | 12 chunks OK |
| Chat streaming — retrieval step | ✓ | |
| Chat streaming — LLM step | ⏳ | Límite API hasta 1/7 |
| Spec review UI | ✓ | SNOMED/LOINC chips, Ask ALPHI |
| Tenant isolation | ✓ verificar | |
| Rate limiting | ✓ verificar | |
| TypeScript build | ✓ | 7/7 packages |
