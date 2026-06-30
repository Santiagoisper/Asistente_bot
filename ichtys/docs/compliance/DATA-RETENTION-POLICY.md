# Política de retención y purga de datos — Ichtys

**Versión:** 1.0  
**Vigencia:** 2026-06-30

---

## 1. Marco

Alineado con ICH E6 GCP (retención de registros del ensayo), GDPR Art. 5(1)(e) y requisitos del sponsor por estudio.

---

## 2. Períodos de retención

| Tipo de dato | Retención mínima | Disparador de purga | Método |
|--------------|------------------|---------------------|--------|
| Documentos de estudio (D2) | Duración estudio + 25 años* | Cierre estudio + período sponsor | Soft delete → archive |
| Audit logs (D7) | Duración estudio + 25 años* | Política sponsor | Append-only; no delete |
| Conversaciones chat (D3) | Duración estudio + 2 años | Cierre estudio + 2 años | Hard delete |
| **Evoluciones clínicas (D5)** | Duración estudio + 25 años* | Sponsor + regulador | Anonimizar o exportar a EDC |
| **Patient profiles (D5)** | Idem evoluciones | Idem | Idem |
| **Labs OCR (D5)** | Idem evoluciones | Idem | Blob delete + DB purge |
| Embeddings/chunks (D2) | Mientras documento activo | Delete document version | Cascade delete |

\* Período típico GCP; **confirmar por protocolo/sponsor** en contrato de estudio.

---

## 3. Derechos del interesado (GDPR)

Para sujetos en UE:

| Derecho | Aplicabilidad en ensayos clínicos | Procedimiento |
|---------|-----------------------------------|---------------|
| Acceso (Art. 15) | Limitado — datos en custodia del investigador | Derivar al PI del sitio |
| Rectificación (Art. 16) | Sí — corrección clínica | Edición auditada en Ichtys |
| Supresión (Art. 17) | **Excepción** — obligación legal GCP de retener | Documentar rechazo con base legal |
| Portabilidad (Art. 20) | Limitado | Export JSON cifrado bajo solicitud PI |

---

## 4. Procedimiento de purga post-estudio

1. Sponsor notifica cierre y período de retención
2. Export final a EDC/archivo sponsor (formato acordado)
3. Marcar estudio `archived` en Ichtys
4. Tras período: job de purga D5 (hard delete blobs + rows)
5. Audit log de purga (metadata: studyId, recordCount, executedBy)
6. Certificado de destrucción interno

---

## 5. Backups

Los backups de Neon retienen datos según política del proveedor. Tras purga en prod, solicitar invalidación de backups antiguos si el proveedor lo soporta.

Ver [BACKUP-AND-DR.md](./BACKUP-AND-DR.md).

---

## 6. Responsable

Quality / CSV Lead + DPO para solicitudes GDPR.
