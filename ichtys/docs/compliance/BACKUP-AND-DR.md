# Backup y continuidad de negocio — Ichtys

**Versión:** 1.0  
**Vigencia:** 2026-06-30

---

## 1. Objetivos

| Métrica | Target MVP | Notas |
|---------|------------|-------|
| **RPO** (Recovery Point Objective) | ≤ 24 horas | Neon PITR según plan |
| **RTO** (Recovery Time Objective) | ≤ 4 horas | Rollback Vercel + restore DB |
| **Uptime** | 99.5% | PRD §8 |

---

## 2. Componentes y backup

| Componente | Método | Frecuencia | Retención | Responsable |
|------------|--------|------------|-----------|-------------|
| **Neon Postgres** | Point-in-time recovery (PITR) | Continuo | Según plan Neon | Neon / Ops |
| **Vercel Blob** | Replicación proveedor | Continuo | Lifecycle policy | Vercel |
| **Código fuente** | GitHub | Cada push | Indefinido | Dev |
| **PHI_ENCRYPTION_KEY** | Vercel env + backup offline seguro | Al rotar | 2 copias offline | Security Officer |
| **Clerk config** | Clerk dashboard export manual | Trimestral | 1 año | Admin |

---

## 3. Procedimiento de restore DB

1. Identificar punto de restore (timestamp pre-incidente)
2. Crear branch Neon desde PITR o restore a nueva instancia
3. Actualizar `DATABASE_URL` en Vercel (staging primero)
4. Verificar integridad: `pnpm db:check`, smoke tests
5. Promover a producción
6. Documentar en registro de incidente

---

## 4. Procedimiento rollback aplicación

Ver [OPERATIONS.md](../OPERATIONS.md) §3:

1. Vercel Deployment History → promote deployment estable anterior
2. Smoke mínimo post-rollback

---

## 5. Disaster scenarios

| Escenario | Respuesta |
|-----------|-----------|
| Neon outage | Status page Neon; failover a read replica si disponible en plan |
| Vercel outage | Comunicar a usuarios; esperar restore |
| Blob corruption | Re-upload documentos desde copia sponsor |
| Key compromise (`PHI_ENCRYPTION_KEY`) | **Rotación de emergencia** (§6) |
| Clerk outage | Sesiones existentes pueden persistir; no login nuevo |

---

## 6. Rotación de PHI_ENCRYPTION_KEY

**Importante:** rotar la clave invalida datos cifrados con la clave anterior. Procedimiento:

1. Generar nueva clave: `node scripts/generate-phi-key.mjs`
2. Job de re-cifrado: decrypt con old key → encrypt con new key (Fase 1 script)
3. Actualizar Vercel env
4. Verificar muestra aleatoria de registros
5. Destruir copia de clave anterior tras verificación
6. Audit log: `admin.action` key_rotation

Frecuencia programada: anual o tras incidente S1/S2.

---

## 7. Pruebas de DR

| Prueba | Frecuencia | Última ejecución |
|--------|------------|------------------|
| Restore Neon branch desde PITR | Anual | [PENDIENTE] |
| Rollback Vercel | Semestral | [PENDIENTE] |
| Verificar acceso Blob post-restore | Anual | [PENDIENTE] |

---

## 8. Documentación relacionada

- [DATA-RETENTION-POLICY.md](./DATA-RETENTION-POLICY.md)
- [DPA-BAA-TRACKER.md](./DPA-BAA-TRACKER.md) — SLAs de proveedores
