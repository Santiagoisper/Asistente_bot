# DPIA — Evaluación de Impacto en Protección de Datos (GDPR)

**Versión:** 1.0 (borrador)  
**Fecha:** 2026-06-30  
**Responsable:** [PENDIENTE — DPO]  
**Estado:** ⏳ Borrador — requiere revisión legal y firma

---

## 1. Descripción del tratamiento

| Campo | Valor |
|-------|-------|
| **Nombre** | Ichtys — Módulo de screening y evolución clínica de sujetos |
| **Responsable del tratamiento** | CINME / Innova Trials (operador) + Sponsor del ensayo (co-responsable según contrato) |
| **Encargado del tratamiento** | Sitios de investigación (usuarios) |
| **Finalidad** | Apoyo al screening de elegibilidad en ensayos clínicos; registro de evolución clínica pseudonimizada; extracción OCR de laboratorios |
| **Base legal (Art. 6)** | (f) Interés legítimo / (b) Ejecución contrato con sitio — **confirmar con legal** |
| **Base legal datos salud (Art. 9)** | (j) Fines de medicina preventiva/ocupacional, interés público en salud pública — **investigación científica (Art. 9(2)(j) + ley nacional)** |
| **Categorías de interesados** | Sujetos de ensayos clínicos (pacientes) |
| **Categorías de datos** | Datos de salud, medicación, labs, evolución clínica, pseudónimo de sujeto |
| **Destinatarios** | Personal autorizado del sitio; procesadores listados en DPA-BAA-TRACKER |
| **Transferencias internacionales** | Posible inferencia LLM en US (Anthropic, OpenAI) — requiere SCC + BAA/DPA |
| **Plazo de conservación** | Ver DATA-RETENTION-POLICY (estudio + 25 años típico) |
| **Decisiones automatizadas (Art. 22)** | Score de elegibilidad orientativo — **no vinculante**; PI decide inclusión |

---

## 2. Necesidad y proporcionalidad

| Pregunta | Respuesta |
|----------|-----------|
| ¿Es necesario el tratamiento? | Sí — reduce errores de screening (GCP), mejora calidad de datos |
| ¿Alternativas menos invasivas? | Screening manual en papel/EDC — más lento, mismo dato de salud |
| ¿Minimización? | Pseudonimización, no PII directa, cifrado field-level |
| ¿Exactitud? | Rule engine determinista + confirmación humana OCR |

---

## 3. Evaluación de riesgos

| Riesgo | Probabilidad | Impacto | Riesgo residual | Mitigación |
|--------|--------------|---------|-----------------|------------|
| Cross-tenant leakage PHI | Baja (controles) | Muy alto | Medio | test:leakage bloqueante, tenant filters |
| Re-identificación | Media | Alto | Medio | Pseudonimización, capacitación |
| Brecha en procesador US | Media | Alto | Medio | DPA/SCC, BAA, cifrado |
| Decisión IA incorrecta | Media | Alto | Bajo | LLM no decide; unknown default |
| OCR valor incorrecto | Media | Alto | Medio | Human confirmation obligatoria |
| Acceso no autorizado | Baja | Alto | Bajo | RBAC, audit, MFA |

---

## 4. Medidas técnicas y organizativas

Ver:
- [PHI-HANDLING-POLICY.md](./PHI-HANDLING-POLICY.md)
- [ACCESS-CONTROL-POLICY.md](./ACCESS-CONTROL-POLICY.md)
- [PSEUDONYMIZATION-POLICY.md](./PSEUDONYMIZATION-POLICY.md)
- `@ichtys/crypto` field-level encryption
- Audit trail append-only existente

---

## 5. Consulta DPO / autoridad

| Acción | Estado |
|--------|--------|
| Consulta previa DPO interno | [PENDIENTE] |
| Consulta autoridad de control (Art. 36) | [Evaluar post-mitigación — probablemente no requerida si riesgo residual bajo] |

---

## 6. Aprobación

| Rol | Nombre | Firma | Fecha |
|-----|--------|-------|-------|
| DPO | | | |
| Security Officer | | | |
| Clinical Lead | | | |
| Legal | | | |

---

## 7. Revisión

Anual o ante cambio material (nuevo procesador, nuevo tipo de dato, expansión geográfica).
