# Política de pseudonimización — Ichtys

**Versión:** 1.0  
**Vigencia:** 2026-06-30

---

## 1. Objetivo

Reducir riesgo de re-identificación cumpliendo GCP, GDPR Art. 4(5) y principios HIPAA de mínimo necesario.

---

## 2. Identificador de sujeto

| Campo | Formato | Ejemplo | Reglas |
|-------|---------|---------|--------|
| `subject_code` | `{study_prefix}-{nnn}` | `GZBO-001` | Único por estudio; no derivado de DNI/nombre |
| `internal_uuid` | UUID v4 | `a1b2c3d4-...` | PK técnica; nunca expuesta al usuario final |

**Prohibido almacenar en Ichtys (Fase 1 MVP):**
- Nombre completo o apellido
- DNI / pasaporte / SSN
- Email o teléfono del paciente
- Dirección
- Fecha de nacimiento exacta (usar edad en años si es necesaria)

---

## 3. Texto libre de evolución

El médico puede escribir texto clínico que inadvertidamente contenga PII. Mitigaciones:

1. **UX warning** al guardar: "No incluya nombre, DNI u otros identificadores directos"
2. **Detección heurística** (Fase 1): alertar si se detectan patrones de DNI argentino, emails, teléfonos — no bloquear automáticamente (evitar falsos positivos clínicos)
3. **Capacitación** obligatoria del sitio
4. **Separación de roles:** monitores (`read_only_monitor`) no acceden a evoluciones completas salvo auditoría autorizada

---

## 4. Laboratorios OCR

- PDFs de lab pueden contener nombre del paciente en el encabezado
- Pipeline OCR (Fase 3) debe **redactar/descartar** campos de identificación del PDF antes de persistir
- Solo persistir: analitos, valores, unidades, fechas de muestra, flags

---

## 5. Integración EMR (Fase 4)

- Sync unidireccional EMR → Ichtys
- Mapear `Patient.id` externo a `subject_code` interno; no replicar demographics completos
- FHIR: usar `Patient.identifier` con system del sitio, no `Patient.name` en Ichtys

---

## 6. Re-identificación

Solo personal autorizado del sitio con acceso físico al expediente puede vincular `subject_code` con identidad real. Ichtys **no** mantiene tabla de vinculación identidad ↔ sujeto.

---

## 7. Transferencias internacionales

Si datos pseudonimizados salen de la región del sitio (ej. inferencia LLM en US), requiere:
- DPA/BAA vigente con procesador
- DPIA actualizada
- Base legal documentada (GDPR Art. 6 + 9)

Ver [DPA-BAA-TRACKER.md](./DPA-BAA-TRACKER.md) y [DPIA.md](./DPIA.md).
