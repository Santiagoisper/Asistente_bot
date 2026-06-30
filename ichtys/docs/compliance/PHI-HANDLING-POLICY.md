# Política de manejo de PHI — Ichtys

**Versión:** 1.0  
**Vigencia:** 2026-06-30  
**Alcance:** Módulo de sujetos, evolución clínica, labs y screening (Fase 1+)

---

## 1. Definición

**PHI (Protected Health Information):** cualquier información de salud que pueda identificar a un individuo, incluyendo pero no limitado a: nombre, DNI/documento, fecha de nacimiento exacta, dirección, historial clínico, resultados de laboratorio, medicación, y combinaciones que permitan re-identificación.

**Datos pseudonimizados:** identificados solo por `subject_code` interno del ensayo, sin datos demográficos directos en el mismo registro.

---

## 2. Principios (ALCOA+ / GCP)

| Principio | Implementación Ichtys |
|-----------|----------------------|
| **Attributable** | Audit log con userId en toda operación D5 |
| **Legible** | UI legible; almacenamiento cifrado |
| **Contemporaneous** | Timestamp server-side al guardar evolución |
| **Original** | Fuente primaria = evolución del médico; OCR labs = secundaria con confirmación |
| **Accurate** | Rule engine determinista; LLM solo extrae, no decide elegibilidad |
| **Complete** | Checklist de criterios con estado `unknown` explícito |
| **Consistent** | Schema tipado + validación Zod |
| **Enduring** | Retención según [DATA-RETENTION-POLICY.md](./DATA-RETENTION-POLICY.md) |
| **Available** | Backup/DR según [BACKUP-AND-DR.md](./BACKUP-AND-DR.md) |

---

## 3. Prohibiciones absolutas

1. Subir PHI a documentos de estudio (protocolo, IB) — ver banner en upload UI
2. Loguear contenido de evoluciones, perfiles, labs, o preguntas de chat con PHI
3. Crear embeddings de datos D5
4. Enviar PHI a evals automatizados o datasets de prueba commitados
5. Compartir PHI entre tenants u organizaciones
6. Usar PHI en prompts de fine-tuning de modelos
7. Exponer PHI en URLs, query params, o respuestas de error

---

## 4. Minimización de datos

- Capturar solo lo necesario para screening contra criterios del protocolo
- Preferir `subject_code` sobre nombre
- Desalentar PII en texto libre de evolución (validación UX + warning)
- Labs: extraer solo analitos relevantes al protocolo cuando sea posible

---

## 5. Flujo de datos PHI (Fase 1+)

```
Médico escribe evolución
  → API valida auth + tenant
  → encryptPhiField(content)
  → Persist Neon (cifrado)
  → NLP extracción (transient — Anthropic, sin persistir prompt)
  → patient_profile actualizado (cifrado)
  → Rule engine evalúa vs study_rules
  → screening_assessment persistido (sin PHI en metadata)
  → Audit log (sin contenido)
```

---

## 6. Decision support — no decision maker

Ichtys es **sistema de apoyo a la decisión clínica**. El investigador mantiene responsabilidad final sobre inclusión/exclusión del sujeto. El score de elegibilidad es orientativo; no sustituye el criterio médico ni la firma en eSource/EDC.

---

## 7. Capacitación

Todo usuario con acceso a módulo D5 debe completar:
- GCP básico (vigente)
- Capacitación protocolo del estudio
- Capacitación Ichtys PHI (esta política + pseudonimización)

Registro de capacitación: [PENDIENTE — sistema o spreadsheet]

---

## 8. Incidentes

Ver [BREACH-NOTIFICATION-PROCEDURE.md](./BREACH-NOTIFICATION-PROCEDURE.md).

---

## 9. Revisión

Revisión anual o ante cambio material del módulo PHI.
