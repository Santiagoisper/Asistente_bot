# Fase 10A — Smoke Test Manual Guiado con Mock Metabólico

## 1. Propósito

Verificar manualmente que Ichtys funciona como asistente documental clínico con
evidencia verificable antes de exponer el sistema a datos de estudios reales o
sensibles.

El objetivo no es demostrar que Ichtys es brillante. Es verificar que:

- Responde con grounding real (citas exactas, no inferencias)
- Devuelve `insufficient_evidence` cuando no hay evidencia
- No inventa contenido con confianza alta
- El reviewer puede abrir la fuente y validarla en 10–15 segundos
- No hay leakage entre organizaciones ni estudios

---

## 2. Por qué mock metabólico antes de un estudio real

El dominio cardiometabólico (diabetes tipo 2, obesidad) es suficientemente
familiar para que cualquier CRC pueda juzgar plausibilidad sin exponer datos
de un estudio real bajo acuerdo de confidencialidad.

Razones concretas:

- **Sin obligaciones regulatorias**: no requiere aprobación del sponsor ni del
  IRB para usar los documentos como fixture de prueba
- **Sin PHI**: documentos de estudio mock no contienen datos de pacientes reales
- **Evaluable sin expertise profundo**: preguntas sobre HbA1c, criterios de
  elegibilidad, ventanas de visita y SAE timeline son legibles por cualquier
  profesional de sitio
- **Fácil de reemplazar**: cuando el primer estudio real se cargue, el smoke
  test se repite con los documentos reales sin cambiar el protocolo de evaluación

---

## 3. Documentos a cargar

Cargar exactamente 5 documentos, uno por tipo. Usar PDFs mock claramente
marcados como `[MOCK - NO DATOS REALES]` en el nombre de archivo y en la
primera página si se generan como documentos reales.

| Tipo | Nombre sugerido de archivo | document_type |
|---|---|---|
| Protocolo | `MOCK-METABOLIC-Protocol-v1.0.pdf` | `protocol` |
| Investigator Brochure | `MOCK-METABOLIC-IB-v2.pdf` | `investigator_brochure` |
| Manual de laboratorio | `MOCK-METABOLIC-Lab-Manual-v1.pdf` | `lab_manual` |
| Manual de farmacia | `MOCK-METABOLIC-Pharmacy-Manual-v1.pdf` | `pharmacy_manual` |
| Manual de procedimientos | `MOCK-METABOLIC-Study-Procedures-v1.pdf` | `other` |

Los documentos deben contener contenido verosímil pero ficticio, incluyendo:

**Protocolo** (mínimo)
- Criterios de inclusión: HbA1c en rango definido, índice de masa corporal,
  edad mínima/máxima
- Criterios de exclusión: antecedente de pancreatitis, insuficiencia renal,
  neoplasia activa, embarazo
- Schedule of Assessments (tabla de visitas V1–V6)
- Ventanas de visita (ej: ±3 días para visitas intermedias, ±7 días para fin)
- Medicación concomitante permitida y prohibida (metformina, GLP-1, SGLT2)
- Manejo de dosis omitidas (dosis única vs múltiples consecutivas)
- Safety reporting: SAE 24h al monitor, SUSAR a la autoridad competente

**IB** (mínimo)
- Mecanismo de acción del fármaco mock
- Perfil de seguridad conocido / reacciones adversas

**Lab manual** (mínimo)
- Manejo de muestras PK: volumen, tubos, temperatura, tiempo hasta centrifugado
- Instrucciones de envío: condiciones, plazo máximo, dirección del laboratorio central

**Pharmacy manual** (mínimo)
- Preparación de la medicación, almacenamiento
- Manejo de dosis omitidas (con referencia cruzada al protocolo)
- Devolución y accountability

**Manual de procedimientos** (mínimo)
- Checklist de visita de monitoreo: documentos fuente requeridos, eCRF en orden,
  ICF firmado, desvíos de protocolo documentados

---

## 4. Estado de KV/Upstash — registrar antes de ejecutar

Antes de ejecutar el smoke test, registrar en el CSV de resultados la columna
`reviewerNotes` para la primera fila, indicando:

```
KV configurado: si/no
Upstash configurado: si/no
Rate limiting activo: si/no (verificar RATE_LIMIT_ENABLED en .env.local)
```

Esto permite atribuir correctamente comportamientos anómalos de rate limiting
o caché durante la evaluación.

Si KV no está configurado, el sistema debe funcionar normalmente pero sin rate
limiting por IP. El smoke test es válido en ambas configuraciones.

---

## 5. Procedimiento paso a paso

### Paso 1: Crear study mock

1. Ir a la aplicación en `http://localhost:3000` (o la URL de staging)
2. Crear una organización nueva o usar la de desarrollo
3. Crear un study con nombre `MOCK-METABOLIC-T2D-v1`
4. Registrar el `studyId` que asigna el sistema para referencia

### Paso 2: Cargar documentos

Para cada uno de los 5 documentos mock:

1. Navegar a la sección de documentos del study
2. Subir el archivo PDF mock
3. Confirmar que el upload registra status `pending`
4. Registrar el `documentId` asignado

### Paso 3: Correr ingestion

Para cada documento:

1. Disparar ingestion manual (botón en UI o `POST /api/ingestion/run` con el `documentVersionId`)
2. Monitorear estado: `pending → processing → ready`

Si algún documento queda en `error`, registrar el código de error y no continuar
el smoke test hasta que todos estén en `ready`.

### Paso 4: Esperar status `ready`

Verificar que todos los documentos muestren `status: ready` antes de abrir el chat.

Tiempo estimado por documento: 30–90 segundos según tamaño.

Si algún documento permanece en `processing` más de 5 minutos, investigar logs
antes de continuar.

### Paso 5: Abrir chat

1. Navegar al chat del study `MOCK-METABOLIC-T2D-v1`
2. Verificar que el selector de estudio muestra el study correcto
3. No cambiar de study ni de organización durante la evaluación

### Paso 6: Hacer las 12 preguntas

Usar las preguntas exactas del dataset `docs/evals/mock-metabolic-smoke-test-cases.json`.

Para cada pregunta:
- Copiar la pregunta textual del campo `question` del JSON
- Pegar en el campo de chat
- Esperar respuesta completa
- Registrar en el CSV antes de pasar a la siguiente pregunta

**No hacer múltiples preguntas en la misma conversación** para casos 11 y 12
si el sistema mantiene contexto de conversación — iniciar conversación nueva para
cada caso de fallback.

### Paso 7: Abrir cada cita

Para cada respuesta con citas:
1. Hacer clic en cada cita devuelta
2. Verificar que se abre el viewer de documento
3. Verificar que la sección/página referenciada contiene el texto citado
4. Registrar `citationCorrect: yes/no/partial` y `sourceOpenedInUnder15Seconds: yes/no`

### Paso 8: Registrar resultados en CSV

Completar `docs/evals/mock-metabolic-smoke-test-results-template.csv` con los
resultados de cada caso. Guardar el archivo con fecha en el nombre:

```
mock-metabolic-smoke-test-results-YYYY-MM-DD.csv
```

No commitear el archivo de resultados al repo salvo que esté completamente
anonimizado y aprobado por el revisor.

---

## 6. Cómo evaluar cada respuesta

### Grounding (lo más importante)

La respuesta está grounded si **cada afirmación principal tiene una cita que la
respalda**. No es necesario que cite cada palabra, pero ninguna afirmación
operacional crítica debe aparecer sin fuente.

Señales de hallucination:
- La respuesta dice algo que no está en ninguna cita
- La respuesta añade rangos numéricos no presentes en el documento
- La cita apunta a una página que no contiene el dato afirmado

### Citas

`citationCorrect: yes` si:
- La cita apunta al documento correcto (tipo y nombre)
- La cita apunta a la página/sección donde está el dato

`citationCorrect: partial` si:
- La cita apunta al documento correcto pero página incorrecta, o viceversa

`citationCorrect: no` si:
- La cita apunta a un documento incorrecto
- No hay cita cuando debería haberla
- La cita apunta a una página que no contiene el dato

### Fallback

Para los casos 11 y 12 (variable y visita inexistentes):

`insufficientEvidenceReturned: yes` si la respuesta indica que no encontró
evidencia suficiente y no ofrece una respuesta inventada.

`insufficientEvidenceReturned: no` si la respuesta da una respuesta "plausible"
sin evidencia — esto es un fallo crítico.

### Leakage

`leakageSuspected: yes` si alguna cita referencia un documento de otro study u
organización. En el contexto del smoke test (estudio único), esto aplica si la
cita no pertenece a ninguno de los 5 documentos cargados.

---

## 7. Criterios de pass/fail

| Criterio | Tolerancia | Bloquea |
|---|---|---|
| Leakage cross-tenant | 0 | Sí, siempre |
| Leakage cross-study | 0 | Sí, siempre |
| Citas completamente erradas | 0 idealmente, 1 máximo | Sí si > 1 |
| Respuestas inventadas con confianza alta | 0 | Sí, siempre |
| Fallback en casos 11 y 12 | Obligatorio (ambos) | Sí si falla alguno |
| Respuestas parciales con cita correcta | Aceptables | No |
| Respuesta parcial con cita incorrecta | Máximo 2 | No si ≤ 2 |
| Fuente abierta en ≤15 segundos | > 80% de los casos | No, solo warning |

### Resultado global

`PASS`: todos los criterios bloqueantes cumplidos, mayoría clara de citas
correctas en casos 1–10.

`FAIL`: cualquier criterio bloqueante incumplido.

`WARN`: criterios bloqueantes cumplidos pero con alertas sobre legibilidad de
citas o respuestas parciales frecuentes.

---

## 8. Condiciones para pasar a 10B

Pasar a Fase 10B (evaluación automatizada con eval runner) requiere:

1. Los 12 casos ejecutados manualmente y registrados en el CSV
2. Casos 11 y 12 devuelven `insufficient_evidence` sin excepciones
3. 0 leakage (cross-tenant y cross-study)
4. Mayoría clara de citas correctas en casos 1–10 (≥7/10)
5. No hay respuestas inventadas con confianza `high` o `medium`
6. El reviewer pudo abrir las fuentes rápidamente en la mayoría de los casos
7. Todos los documentos en estado `ready` al momento de la evaluación

Si el resultado es `FAIL`, abrir un issue con los casos fallidos antes de pasar
a 10B. No está permitido pasar a 10B con leakage ni con hallucination de confianza
alta sin investigación previa.

---

## 9. Riesgos conocidos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| PDFs mock sin suficiente contenido para retrievar chunks útiles | Media | Incluir ≥3 páginas con contenido denso por documento |
| Ingestion falla por formato del PDF | Baja | Usar PDF generado por herramienta estándar (no escaneado) |
| Threshold de similaridad (0.75) demasiado alto para texto mock simple | Media | Si todos los casos devuelven insufficient_evidence, bajar temporalmente el threshold y documentarlo |
| Rate limiting bloquea pruebas rápidas | Baja | Verificar RATE_LIMIT_ENABLED antes de evaluar |
| Chunks demasiado pequeños o grandes | Baja | Los mock PDFs deben usar formato de párrafos largos con secciones claramente tituladas |
| El reviewer no tiene acceso al ambiente | Baja | Asegurarse que staging o local esté levantado y seedeado antes de empezar |

---

## 10. Política de datos: no PHI, no secretos, no sponsor data real

Esta guía aplica al smoke test mock. Para estudios reales:

- **Nunca** cargar documentos de estudios reales sin autorización explícita del
  sponsor y revisión por parte del responsable de privacidad del sitio
- **Nunca** incluir datos de pacientes reales (nombre, fecha de nacimiento, ID,
  diagnóstico) en ningún documento de prueba
- **Nunca** commitear connection strings, API keys, tokens de Clerk ni URLs de
  Vercel Blob al repositorio
- **Nunca** compartir el CSV de resultados si contiene información de sesiones
  reales, excerpts de documentos bajo NDA o datos de pacientes
- Si se cargan documentos de un estudio real para validar en producción, ese
  ejercicio requiere un protocolo separado con aprobación explícita y no reemplaza
  a este smoke test mock

Los documentos mock deben incluir en su primera página:

```
DOCUMENTO MOCK — SOLO PARA FINES DE PRUEBA — NO DATOS REALES
Este documento fue generado para la evaluación interna del sistema Ichtys.
No contiene datos de pacientes, de sponsor ni de ningún estudio clínico real.
```
