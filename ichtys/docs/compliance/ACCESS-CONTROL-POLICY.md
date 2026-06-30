# Política de control de acceso — Ichtys (ISMS Lite)

**Versión:** 1.0  
**Vigencia:** 2026-06-30

---

## 1. Modelo de acceso

```
Organization (Clerk) → Study → Resources
```

Autenticación: Clerk Organizations (MFA recomendado para roles clínicos).  
Autorización: RBAC server-side + validación object-level.

---

## 2. Roles y permisos

| Rol | Documentos estudio | Chat RAG | Spec review | **PHI sujetos (Fase 1+)** | Admin |
|-----|-------------------|----------|-------------|---------------------------|-------|
| `read_only_monitor` | Lectura | Lectura | Lectura | **Denegado** | No |
| `site_coordinator` | Lectura/upload | Lectura/escritura | Lectura | **Lectura/escritura** | No |
| `principal_investigator` | Lectura/upload | Lectura/escritura | Lectura | **Lectura/escritura** | No |
| `study_admin` | Full | Full | Edición/aprobación spec | **Full** | Parcial |
| `org_admin` | Full org | Full org | Full org | **Full org** | Sí |

---

## 3. Controles técnicos obligatorios

1. `organization_id` solo desde token Clerk — nunca del cliente
2. `validateStudyAccess()` en toda API route
3. Object-level auth para documentId, messageId, subjectId (Fase 1)
4. Rate limiting en endpoints sensibles
5. Sesiones con timeout (Clerk configurable)
6. Revocación inmediata al remover usuario de org en Clerk

---

## 4. Segregación de funciones (Part 11 / Annex 11)

| Acción | Quién ejecuta | Quién aprueba |
|--------|---------------|---------------|
| Aprobar study spec | `study_admin` | Mismo rol (MVP); idealmente PI separado en v2 |
| Confirmar OCR lab | `site_coordinator` / PI | Auto-registro en audit |
| Decisión inclusión sujeto | PI | Fuera de Ichtys (EDC) — Ichtys solo asiste |

---

## 5. Acceso de emergencia

Procedimiento break-glass: [PENDIENTE — definir con Security Officer]

---

## 6. Revisión de accesos

- Trimestral: revisar miembros de org en Clerk
- Al cierre de estudio: revocar accesos no necesarios
- Log de `auth.access_denied` monitoreado

---

## 7. Desarrollo y operaciones

- Producción: acceso DB Neon restringido a operadores autorizados
- Secretos en Vercel env, nunca en repo
- Preview deployments: **no usar PHI real** — solo datos mock
