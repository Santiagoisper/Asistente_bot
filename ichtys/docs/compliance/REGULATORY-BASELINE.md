# Marco normativo de desarrollo — Alphi / Clinical Research OS

**Versión:** 1.1 · **Fecha:** 2026-11-12 · **Estado:** propuesta, pendiente de revisión por Calidad y Legales. La 1.1 incorpora la revisión de Reviewer y la revisión automática del PR #114
**Reemplaza:** la tabla «Marco regulatorio cubierto» de [`README.md`](./README.md) donde difieran.

Este documento fija **contra qué normas se desarrolla** y **qué tiene que cumplir cada cambio** antes de integrarse. No es asesoramiento legal ni una declaración de cumplimiento. Distingue tres cosas y las marca: **[H]** hecho verificado con fuente, **[I]** interpretación nuestra, **[P]** pendiente de verificar.

---

## 1. Qué se certifica y qué no

- **[H]** ISO/IEC 27001, 27701 y 42001 son normas de **sistema de gestión**. Certifican a una **organización** dentro de un alcance declarado, no a un programa.
- **[H]** 21 CFR Part 11 y las guías de la UE no «certifican» software. Obligan al patrocinador, al investigador y a sus proveedores, y se cumplen con el sistema **validado para su uso previsto** en cada centro.
- **[I]** En consecuencia, Alphi no puede «tener» ISO 42001 ni «ser Part 11». Lo que sí puede y debe hacer:
  1. traer **incorporados** los controles técnicos que esas normas le piden al software;
  2. entregar **evidencia** utilizable por el centro en su propia certificación, evaluación de proveedores y validación (requisitos, pruebas, registros de cambio, informes);
  3. operar la empresa que lo desarrolla bajo un sistema de gestión coherente con las mismas normas.
- **[I]** Un centro que certifica ISO 42001 (por ejemplo Alpha CR) va a tratar a Alphi como **proveedor de un sistema de IA** dentro de su alcance. El paquete de evidencia del punto 2 es lo que su auditor va a pedir.

Regla de redacción: en producto, sitio, contratos y documentos se dice «diseñado para apoyar el cumplimiento de…» y se cita la evidencia. No se dice «cumple» ni «certificado» sin un informe que lo respalde.

---

## 2. Uso previsto (condiciona todo lo demás)

**Alphi es un complemento de la historia clínica electrónica (HCE) y del CRF. No es ninguno de los dos.** El registro médico oficial vive en la HCE; el dato del estudio que se reporta al patrocinador vive en el CRF.

- **[H]** Part 11 se aplica a los registros electrónicos que se **crean, modifican, mantienen, archivan, recuperan o transmiten** bajo un requisito de registro de la FDA, y a los que se le presentan. El criterio es el registro, no dónde nació el dato. La guía final de la FDA de octubre de 2024 dice que la agencia no evalúa el cumplimiento de Part 11 de los sistemas de HCE usados como fuente, y sí el de los sistemas del estudio una vez que el dato entra en ellos.
- **[H]** La guía de la EMA sobre sistemas informatizados y datos electrónicos en ensayos clínicos (EMA/INS/GCP/112288/2023) tiene un alcance amplio: datos del participante y todo otro dato del ensayo manejado en sistemas electrónicos para conducirlo y reportarlo.
- **[I]** Alphi no debe ser el lugar donde **nace** un dato fuente ni donde se **firma** un registro. Eso reduce su exposición, pero **no la elimina**: una función que guarda, modifica o transmite un dato clínico o del estudio está en alcance aunque el original viva en otro sistema. En particular, si el centro se apoya en la copia que guarda Alphi (un informe de laboratorio, por ejemplo), esa copia tiene que poder sostenerse como copia fiel.
- **[I]** «Apoyo» no significa «sin requisitos». Una función de apoyo que toca datos clínicos sigue bajo R3 (audit trail), R4 (acceso) y R5 (datos personales). Lo que cambia entre apoyo y registro es la profundidad de la validación (R1, R2), no la existencia de controles.
- **[I]** Hoy ya hay funciones en esa zona (evoluciones, laboratorios). Se desarrollan **como si** estuvieran en alcance completo. La decisión de declararlas fuente o borrador es de cada centro y debe quedar escrita en su procedimiento.

Toda función nueva declara en su PR de qué lado cae: **apoyo** (lee, resume, ordena) o **registro** (crea o modifica un dato clínico o del estudio).

---

## 3. Registro normativo

Verificado el 2026-11-12 salvo donde dice **[P]**.

| Norma | Edición y estado | A quién obliga | Qué le pide al software |
|---|---|---|---|
| **ISO/IEC 27001** — seguridad de la información | Edición 2022 **[P]** | Organización (centro; empresa desarrolladora) | Control de acceso, registro de eventos, cifrado, desarrollo seguro, separación de entornos, gestión de cambios, proveedores, continuidad |
| **ISO/IEC 27701** — privacidad | **Edición 2025** (14/10/2025). **Ya es norma independiente**; dejó de ser extensión de la 27001. La edición 2019 fue retirada; transición hasta octubre de 2028 **[H]** | Organización, como responsable o encargado del tratamiento | Minimización, finalidad, derechos del titular, registro de tratamientos, subencargados, transferencias, privacidad por diseño |
| **ISO/IEC 42001** — gestión de IA | Edición 2023 **[P]** | Organización que desarrolla, provee o usa IA | Inventario de sistemas de IA, evaluación de impacto, datos, supervisión humana, registro y monitoreo, transparencia, gestión de proveedores de modelos |
| **ANMAT — Buenas Prácticas Clínicas** | **Disposición 7516/2025** (B.O. 9/10/2025; vigente desde el 1/12/2025). **Derogó la 6677/2010** **[H]**. Alcanza estudios de farmacología clínica con fines de registro; excluye bioequivalencia, no intervencionales y no registrales **[H]** | Patrocinador, investigador, centro | Su Anexo IV exige que los inspectores accedan a documentos fuente e historias clínicas **sin intermediarios** **[H]**. Requisitos específicos sobre sistemas informatizados, firma y conservación: **[P] falta leer los anexos oficiales** |
| **Ley 25.326** — datos personales (Argentina) | Vigente; órgano de control: AAIP. Hay proyectos de reforma en el Congreso (2026), ninguno sancionado **[H]** | Responsable y encargado del tratamiento | Dato de salud = dato sensible; consentimiento, seguridad, confidencialidad, derechos de acceso/rectificación/supresión, transferencia internacional |
| **FDA 21 CFR Part 11** | Regla de 1997. Guía final «Electronic Systems, Electronic Records, and Electronic Signatures in Clinical Investigations: Q&A» del 2/10/2024, que reemplaza la de 2007 y aclara que aplica a estudios fuera de EE. UU. que se presentan a la FDA **[H]** | Patrocinador, investigador, proveedores | Validación proporcional al riesgo, audit trail, control de acceso, copias certificadas, conservación, capacitación, firma electrónica con identidad y significado |
| **UE — ensayos clínicos** | **Guía EMA/INS/GCP/112288/2023**, en vigor desde septiembre de 2023 **[H]** | Patrocinador, investigador, proveedores | ALCOA++, metadatos, audit trail, gestión de usuarios, seguridad, validación, acuerdos con proveedores, acceso directo, anexo específico sobre historias clínicas electrónicas |
| **UE — Anexo 11 (EudraLex vol. 4)** | Versión de 2011 vigente. Es norma de **fabricación (GMP)**, no de ensayos clínicos. Revisión y nuevo **Anexo 22 (IA)** en borrador desde el 7/7/2025; **sin texto final a octubre de 2026** **[H]** | Fabricantes | Referencia de buenas prácticas. El borrador del Anexo 22 excluye modelos generativos de aplicaciones críticas: seguirlo de cerca |
| **ICH E6 (BPC)** | Revisión R3 **[P]** | Patrocinador, investigador | Gobierno del dato, proporcionalidad al riesgo, sistemas informatizados aptos para su uso |

**Correcciones de vocabulario.** No existe una «Parte 11 de la EMA»: el equivalente europeo para ensayos clínicos es la guía de 2023; el Anexo 11 es de fabricación. La sigla «COFETIr» que figuraba en el pedido original no corresponde a ningún organismo identificable y fue **descartada** por Santiago el 12/11/2026.

**HIPAA y GDPR**, que el repositorio cita como base, tienen sus propios criterios de aplicación y un centro argentino en general no los reúne **[P]**: el GDPR alcanza a quien está establecido en la UE, o le ofrece servicios o hace seguimiento a personas que están en la UE (art. 3); HIPAA alcanza a las entidades cubiertas de EE. UU. y a sus asociados. En la práctica llegan como exigencias contractuales de un patrocinador, y ahí se cumplen por contrato. La ley de base acá es la 25.326.

---

## 4. Reglas de desarrollo

Cada cambio se revisa contra estas reglas. La columna de la derecha dice de dónde sale cada una.

| # | Regla | Origen |
|---|---|---|
| R1 | **Uso previsto declarado.** El PR dice si la función es de apoyo o de registro (§2). Las de registro llevan requisito, prueba y evidencia | Part 11; guía EMA; ICH E6 |
| R2 | **Trazabilidad requisito → prueba → evidencia.** Ningún comportamiento regulado sin una prueba automática que lo fije y una fila en la matriz de trazabilidad | Validación (GAMP 5; guía EMA, anexo 2) |
| R3 | **Audit trail.** Toda creación, cambio o baja de un dato clínico, de un permiso o de una configuración queda registrada con quién, qué, cuándo y sobre qué, **dentro de la misma transacción**. No hay borrado físico de datos clínicos. El registro no guarda el contenido clínico en claro | Part 11 §11.10(e); guía EMA; ISO 27001 |
| R4 | **Acceso mínimo.** Por organización, por función y por estudio. Cuentas personales, nunca compartidas. Un rechazo por permiso es indistinguible de «no existe». Las altas y bajas de acceso se auditan | Part 11 §11.10(d),(g); ISO 27001; guía EMA, anexo 3 |
| R5 | **Datos personales.** Minimización; datos de salud cifrados a nivel de campo; seudónimos en todo lo que salga del sistema; **ningún dato real** en pruebas, repositorio, tickets ni mensajes; retención definida | Ley 25.326; ISO 27701 |
| R6 | **IA bajo supervisión humana.** Toda salida de IA es un borrador con una persona responsable identificada. La IA no guarda, firma, envía ni cierra registros clínicos por su cuenta. Modelo y versión quedan registrados por respuesta. Cambiar de modelo o de proveedor es un cambio controlado, con evaluación previa. No se entrena con datos de pacientes. La pantalla dice cuándo un contenido fue generado | ISO 42001; guía EMA; borrador Anexo 22 |
| R7 | **Sin firma aparente.** Ninguna pantalla presenta una acción como «firma» mientras no exista firma electrónica conforme (identidad verificada, significado, vínculo inalterable con el registro) | Part 11, subparte C |
| R8 | **Cambio controlado.** Rama, PR, revisión independiente, CI en verde, evidencia en el entorno de prueba y aprobación nominal antes de producción. Migraciones a mano, aditivas y aplicadas antes que el código. Quien escribe no aprueba solo | ISO 27001; Part 11 §11.10(k); guía EMA |
| R9 | **Proveedores.** Cada servicio que toca datos (alojamiento, base, identidad, modelos de IA) figura en el registro de proveedores con su acuerdo, ubicación de datos y evaluación. Agregar uno es un cambio controlado | ISO 27001, 27701, 42001; Ley 25.326 (transferencia internacional) |
| R10 | **Hora y continuidad.** Marcas de tiempo del servidor, en UTC. Respaldo con restauración **probada**, no solo configurada | Part 11; guía EMA §5.5; ISO 27001 |
| R11 | **Afirmar solo lo probado.** Cada entrega dice qué se verificó, con qué evidencia y qué quedó sin verificar. Una simulación no se presenta como integración real | Integridad de datos (ALCOA++) |

**Reglas que hoy son objetivo y todavía no se pueden sostener con evidencia.** Un PR las responde «objetivo: falta la base» hasta que se cierren las brechas de §6, en vez de marcar una casilla que no puede probar:

- **R2:** la matriz de trazabilidad es de julio de 2026 y no cubre el OS ni el acceso por estudio. Hoy vale la prueba automática; la fila en la matriz, no.
- **R3:** la mayoría de las escrituras no audita dentro de la transacción (ver §5).
- **R5, retención:** existe [`DATA-RETENTION-POLICY.md`](./DATA-RETENTION-POLICY.md), sin verificar que el sistema la ejecute.
- **R9:** el registro de proveedores ([`DPA-BAA-TRACKER.md`](./DPA-BAA-TRACKER.md)) no enlaza evidencia de los acuerdos.
- **R10, restauración:** no consta una restauración probada.

---

## 5. Estado real al 2026-11-12

| Control | Estado | Evidencia |
|---|---|---|
| Aislamiento entre organizaciones | **Probado** | Pruebas de fuga bloqueantes en CI |
| Acceso por función y por estudio | **Implementado y probado en entorno de prueba; no activado** | `docs/decisions/study-membership.md`; PR #105–#113 |
| Rechazo uniforme | **Probado** en los validadores | `packages/auth/__tests__/access-enforced.test.ts` |
| Audit trail en la misma transacción | **Parcial: hoy incumple R3.** 4 archivos auditan dentro de la transacción; 20 llaman al registro de auditoría **después** de confirmar la escritura (entre ellos el alta de una evolución), de modo que el dato puede quedar guardado sin su registro. Existe además una variante que descarta el error de auditoría. Inalterabilidad a nivel de base **[P]** | `apps/web/lib/chat/persistence.ts`; `docs/decisions/audit-policy.md` |
| Cifrado de campo | **Parcial.** Las evoluciones se cifran. Las evaluaciones de elegibilidad (`screening_assessments.assessments` y `summary`) se guardan en claro, ligadas al sujeto, y según la revisión automática incluyen valores clínicos. Rotación de clave **[P]** | `docs/decisions/phi-field-encryption.md`; `packages/db/schema/screening-assessments.ts` |
| Supervisión humana de la IA | **No se cumple en un punto.** Al guardar una evolución, el sistema llama al modelo, extrae hechos y **actualiza el perfil del paciente sin confirmación humana**; ese perfil alimenta la evaluación de elegibilidad. La redacción de datos personales antes del modelo sí existe. Registro de modelo por respuesta **[P]** | `apps/web/lib/subjects/patient-profile-service.ts`; [`AI-GOVERNANCE.md`](./AI-GOVERNANCE.md) |
| Validación | **Parcial.** Plan, URS, FRS, matriz y FMEA de julio de 2026. Lo que el repositorio llama «OQ» es hoy una suite de pruebas automáticas. PQ sin ejecutar, informe sin firmar | [`CSV-VALIDATION-PLAN.md`](./CSV-VALIDATION-PLAN.md) |
| Firma electrónica | **No existe** | — |
| Procedencia y huella de los archivos | **No existe.** Los archivos guardados no tienen huella que pruebe que no cambiaron; los informes de laboratorio guardan el formato del archivo, no quién lo emitió ni por dónde llegó | `packages/db/schema/lab-reports.ts` |
| Restauración probada | **[P]** | [`BACKUP-AND-DR.md`](./BACKUP-AND-DR.md) |

## 6. Brechas abiertas

**De código** (encontradas por la revisión del PR #114 y confirmadas en el código):

- **C1.** Auditoría fuera de la transacción en la mayoría de las escrituras, y una variante que descarta el error. Contradice R3.
- **C2.** La IA actualiza el perfil del paciente sin confirmación humana. Contradice R6.
- **C3.** Evaluaciones de elegibilidad sin cifrar. Contradice R5.
- **C4.** Archivos sin huella ni procedencia. Impide sostener una copia como copia fiel.

**Documentales:**

1. Ningún documento del repositorio cita la **Disposición ANMAT 7516/2025** ni la **Ley 25.326**. La base normativa argentina falta.
2. El `README.md` de esta carpeta trata a la ISO 27701 como «extensión»; desde 2025 es independiente.
3. `ACCESS-CONTROL-POLICY.md` describe el modelo de roles anterior al acceso por función y por estudio.
4. La matriz de trazabilidad, la URS y la FRS son de julio de 2026 y no cubren el OS ni el acceso por estudio.
5. El `README.md` da por firmados o aprobados acuerdos con proveedores, DPIA y evaluación HIPAA. **[P]**: no hay evidencia enlazada. Figura como responsable una organización que ya no lo es.
6. La revisión trimestral prevista para el 2026-09-30 no consta.
7. `AI-GOVERNANCE.md` necesita contrastarse con los modelos realmente en uso y pasar de «lite» a un inventario con evaluación de impacto por sistema.
8. Falta leer los anexos oficiales de la Disposición 7516/2025 y extraer lo que digan sobre sistemas informatizados, firma, documentos fuente y conservación.

## 7. Mantenimiento

- **Vigilancia normativa**, con revisión trimestral: texto final del Anexo 11 y del Anexo 22 de la UE; reforma de la Ley 25.326; reglas de transición de la ISO 27701:2025; circulares de ANMAT posteriores a la 7516/2025.
- Este documento se actualiza por PR. Un cambio de edición de una norma abre una revisión de las reglas de §4.
- Dueño: Calidad de la empresa desarrolladora. Hasta que exista esa función con nombre, la dirección técnica.

## 8. Fuentes consultadas el 2026-11-12

- ISO/IEC 27701:2025 — DNV, «Updated version of ISO/IEC 27701 standard released»; Linford & Co., «ISO/IEC 27701:2025: What Changed» (21/10/2026).
- Disposición ANMAT 7516/2025 — Boletín Oficial, aviso 332695 (9/10/2025); Marval O'Farrell Mairal, «Nuevo régimen de Buenas Prácticas Clínicas» (17/12/2025); Infoleg, Anexo IV.
- FDA — Federal Register vol. 89, n.º 191 (2/10/2024), docket FDA-2017-D-1105.
- EMA — «Guideline on computerised systems and electronic data in clinical trials», EMA/INS/GCP/112288/2023.
- Anexo 11 y Anexo 22 — Comisión Europea, consulta del 7/7/2025; estado a octubre de 2026 según Lab Manager, Apotech Consulting y JTF.
- Ley 25.326 — Resolución AAIP 179/2025; Diario Judicial (julio de 2026) sobre los proyectos de reforma.
