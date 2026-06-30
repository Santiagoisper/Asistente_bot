# Procedimiento de notificación de brechas — Ichtys

**Versión:** 1.0  
**Vigencia:** 2026-06-30

---

## 1. Definiciones

**Brecha de seguridad:** acceso no autorizado, pérdida, alteración o divulgación de datos personales/de salud.

**Incidente de seguridad:** evento que compromete o puede comprometer confidencialidad, integridad o disponibilidad — incluye brechas.

---

## 2. Clasificación de severidad

| Nivel | Criterio | Ejemplo |
|-------|----------|---------|
| **S1 — Crítico** | PHI expuesto cross-tenant o público | Leakage org A → org B con evoluciones |
| **S2 — Alto** | PHI expuesto intra-org no autorizado | Log con contenido evolución |
| **S3 — Medio** | Intento de acceso denegado masivo | Brute force auth |
| **S4 — Bajo** | Evento contenido sin exfiltración | Rate limit triggered |

---

## 3. Plazos de notificación

| Marco | Autoridad / parte | Plazo desde detección |
|-------|-------------------|----------------------|
| **GDPR** | Supervisory authority (DPA) | 72 horas (si riesgo para derechos) |
| **GDPR** | Interesados afectados | Sin dilación indebida (alto riesgo) |
| **HIPAA** | HHS OCR | 60 días (breach > 500: sin dilación) |
| **HIPAA** | Individuos afectados | 60 días |
| **GCP / Sponsor** | Sponsor del ensayo | 24 horas (SAE de datos — definir en contrato) |
| **Interno** | Security Officer + DPO | Inmediato (S1/S2) |

---

## 4. Procedimiento (72h GDPR)

### Hora 0 — Detección y contención

1. Identificar vector (leakage test, alerta, reporte usuario)
2. Contener: revocar tokens, deshabilitar endpoint, rotar claves si aplica
3. Registrar incidente en registro interno (template abajo)
4. Notificar Security Officer + DPO

### Hora 0–24 — Evaluación

1. Determinar datos afectados (clase D1–D7)
2. Número aproximado de sujetos/registros
3. ¿Cross-tenant? ¿PHI en claro?
4. Clasificar severidad S1–S4

### Hora 24–72 — Notificación regulatoria (si aplica)

1. DPO prepara notificación a autoridad de control
2. Notificar sponsor(s) afectados
3. Documentar medidas correctivas

### Post-incidente

1. Root cause analysis (RCA)
2. Actualizar controles / tests
3. Lecciones aprendidas en `docs/compliance/incidents/` [crear al primer incidente]

---

## 5. Registro de incidente (template)

```markdown
# Incidente INC-YYYY-NNN

- **Detectado:** YYYY-MM-DD HH:MM UTC
- **Reportado por:**
- **Severidad:** S1 | S2 | S3 | S4
- **Datos afectados:** D1–D7
- **Sujetos afectados (estimado):**
- **Cross-tenant:** Sí / No
- **Contención:**
- **Notificaciones:** GDPR / HIPAA / Sponsor / Ninguna
- **RCA:**
- **Acciones correctivas:**
- **Cerrado:**
```

---

## 6. Contactos de escalamiento

| Rol | Contacto |
|-----|----------|
| Security Officer | [PENDIENTE] |
| DPO | [PENDIENTE] |
| Legal | [PENDIENTE] |
| Vercel Support | support@vercel.com |
| Neon Support | support@neon.tech |

---

## 7. Prevención

- `pnpm test:leakage` bloqueante en CI
- Monitoreo de `auth.access_denied` spikes
- Pentest anual pre-producción PHI
- No PHI en preview/staging sin anonimización
