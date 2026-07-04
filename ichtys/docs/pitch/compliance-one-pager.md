# ALPHI — Compliance one-pager (due diligence)

**Ichtys Clinical Document Assistant · Julio 2026 · Fase 0**  
*Framework alineado — no certificación formal completada*

---

## Qué es

Asistente documental multi-tenant para sitios de ensayo clínico. RAG con citas obligatorias sobre protocolos, IBs y manuales. **Grounding-only:** sin evidencia → sin respuesta.

**Estado:** MVP pre-validación · **sin PHI real en producción**

---

## Marcos regulatorios (alineación documental)

| Marco | Estado |
|-------|--------|
| FDA 21 CFR Part 11 | Plan CSV definido; **no validado** |
| EMA Annex 11 | Framework referenciado |
| ICH E6 GCP | Políticas operacionales alineadas |
| GDPR | DPIA en revisión legal |
| HIPAA | Risk assessment en revisión legal |
| ISO 27001 / 27701 | ISMS lite documentado; **no certificado** |

---

## Implementación técnica (verificable)

- **Tenant isolation:** org + study en cada query antes de vector search
- **Cifrado PHI:** AES-256-GCM field-level (`PHI_ENCRYPTION_KEY`) — listo para Fase 1
- **Audit log:** acciones de usuario persistidas
- **Pre-redacción** antes de LLM (DNI, email, teléfono)
- **Rate limiting** y auth Clerk Organizations

---

## Políticas documentadas (13)

Clasificación de datos · PHI handling · Pseudonimización · Access control · Retención · Breach notification · Backup/DR · AI governance · ISMS · CSV plan · DPIA · HIPAA RA · DPA/BAA tracker

*Pack completo bajo NDA*

---

## Subprocesadores (resumen)

Neon · Vercel · Clerk · Anthropic · OpenAI · Upstash — ver `/trust` para PHI/BAA por proveedor.

**DPAs/BAAs:** pendientes de firma pre go-live PHI (tracker interno activo).

---

## Validación CSV (roadmap)

- URS / FRS / RTM definidos en `CSV-VALIDATION-PLAN.md`
- IQ/OQ/PQ **pendiente ejecución**
- VSR post piloto con PHI

---

## Por qué esto es foso vs competidores self-serve

Herramientas con ToS «experimental» optimizan velocidad de salida al mercado, no trazabilidad GCP ni validación de sistema. ALPHI invierte en **profundidad regulada** antes de escala — barrera de años para copiar sin equipo QA/CSV.

---

## Contacto due diligence

sisbert@cinme.com.ar · Trust Center: https://asistente-bot-five.vercel.app/trust

*Documento público resumido. No sustituye asesoría legal ni VSR.*
