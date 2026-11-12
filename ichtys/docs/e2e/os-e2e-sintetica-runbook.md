# Recorrido E2E sintético — Ichtys

## Estado y límites

Este guion todavía no se ejecutó en un deployment. La corrida requiere
autorización de Santiago y una rama Neon desechable del proyecto
`sweet-union-82704893`; nunca usar la rama compartida ni Producción. El Preview,
la base aislada y Clerk de prueba se verifican antes de sembrar. No se asume que
Preview esté aislado por el solo hecho de ser Preview.

Todos los datos son inventados y pseudónimos. El PDF local tiene marca de agua
`DATOS SINTÉTICOS / E2E`, estudio `E2E-PROTOCOLO-001`, sujeto `E2E-SUJ-001` y
hemoglobina 13,5 g/dL, glucosa 99 mg/dL y creatinina 0,8 mg/dL. Estos códigos
coinciden con el seed. El PDF no se sube hasta la autorización de la corrida.

El seed busca dos organizaciones preexistentes por `clerk_org_id`, usa sus IDs
reales de esa base aislada y no las crea ni renombra. Deben llamarse
`OS-E2E-SINTETICA` y `OS-E2E-SINTETICA-2`. La primera tiene dos estudios y dos
sujetos (un sujeto en cada estudio); la segunda permite comprobar aislamiento
entre tenants. También se crean perfiles vacíos `{}` para todos los sujetos,
según la convención inicial de `patient_profiles`.

## Precondiciones

- Santiago autorizó la corrida, las dos organizaciones y el usuario sintético.
- El deployment es Preview del proyecto Vercel `asistente-bot`, y la URL no es
  alias de Producción.
- Neon confirmó que la conexión apunta a una rama desechable aislada de
  `sweet-union-82704893`. Si no se puede comprobar, detenerse sin escribir.
- Clerk Preview usa `pk_test_`; el usuario pertenece a
  `OS-E2E-SINTETICA` con rol **administrador** (org admin). Confirmar el rol en
  la sesión y que las acciones administrativas estén habilitadas. No leer ni
  registrar claves secretas.
- Hay dos organizaciones Clerk de prueba ya aprovisionadas en esa rama. El seed
  recibe sus `clerk_org_id` y aborta si los nombres/IDs no coinciden.
- El esquema de la base desechable está migrado hasta 0015.
- Registrar URL Preview, nombre de rama Neon y hora en evidencia; nunca
  credenciales. No incluir datos de pacientes reales.

## Recorrido y resultado esperado

| Paso | Acción | Qué debe verse | Qué queda guardado |
| --- | --- | --- | --- |
| 1. Validar entorno/rol | Abrir el Preview autorizado e iniciar sesión con el usuario sintético administrador. | Host Preview confirmado; organización `OS-E2E-SINTETICA`; la interfaz permite administración. Si el usuario no tiene rol admin, no seguir. | Sesión Clerk de prueba; sin cambios en la app. |
| 2. Verificar Integraciones activas | Antes de abrir la pantalla Integraciones, comprobar por el mecanismo de solo lectura aprobado si esta organización tiene alguna integración activa. Si hay una, detener el recorrido y reportar cuál; no abrir Integraciones. | Resultado de la comprobación indica cero conexiones activas. | Ninguna escritura; registrar solo el resultado y su fuente. |
| 3. Sembrar datos | En la rama Neon desechable, ejecutar `scripts/e2e/seed-os-e2e-sintetica.sql` con ambos `clerk_org_id` y `target_confirmation=ISOLATED_PREVIEW`. | Resumen: org A, 1 centro, 2 estudios, 2 sujetos, 2 perfiles; org B, 1 centro, 1 estudio, 3 sujetos, 3 perfiles. En org A aparecen Alfa y Gamma. | Filas sintéticas en `sites`, `studies`, `subjects` y `patient_profiles`; no se modifican organizaciones existentes. Los estudios Alfa y Gamma pertenecen a la misma organización. |
| 4. Comprobar aislamiento | En la interfaz de Estudios clínicos, revisar org A y luego cambiar a org B con el usuario de prueba correspondiente; comparar listado y códigos. | En A solo aparecen Alfa/Gamma y `E2E-SUJ-001`/`E2E-SUJ-002`; en B solo Beta y `E2E-BETA-SUJ-001..003`. No hay datos cruzados. | Sin escrituras. Evidencia de ambas vistas. |
| 5. Cargar laboratorio | En org A, ir a `Laboratorios` → `Cargar estudio`; elegir Alfa y `E2E-SUJ-001`; subir el PDF local sintético. | Revisión muestra exactamente ese estudio/sujeto y tres resultados legibles con los valores del PDF. | `lab_reports` recibe un informe `pending_review`; contenido parseado cifrado y evento `lab.extract` en `audit_logs`. El PDF fuente no se almacena en Blob. |
| 6. Revisar y confirmar | Comparar las tres filas con el PDF y confirmar solo si coinciden: Hb 13,5 g/dL, glucosa 99 mg/dL y creatinina 0,8 mg/dL. | Estado confirmado visible y asociado a los códigos sintéticos. | `lab_reports` queda `confirmed`, guarda resultados revisados cifrados, revisor/hora y evento `lab.confirm`; se actualiza el perfil del sujeto. |
| 7. Descargar CSV | Pulsar `Descargar CSV` y revisar el archivo local. | Aviso de descarga; CSV con los tres analitos, valores, unidades y códigos sintéticos. | Evento `lab.export`; CSV solo en Descargas locales hasta limpiar. |
| 8. Copiar valores | Pulsar `Copiar valores`; pegar en editor local sin guardar y luego vaciar portapapeles. | Aviso de tres filas; el contenido solo incluye los resultados sintéticos. | Otro evento `lab.export`; portapapeles temporal, se limpia al terminar. |
| 9. Crear turno | En org A, ir a `Agenda` → `Agendar turno`; Alfa, `E2E-SUJ-001`, título `E2E control sintético`, tipo visita, fecha futura válida, sin notas. Guardar. | Tarjeta de agenda muestra ese título y código, con estado programado. | Fila en `agenda_items` de la rama desechable; evento `agenda.create`. |
| 10. Abrir Integraciones | Solo después de que el paso 2 verificó cero integraciones activas, abrir Integraciones y observar. No configurar, conectar ni enviar. | Pantalla no muestra ninguna conexión activa para la organización. Si aparece una, cerrar la pantalla y reportar. | Ninguna escritura esperada; solo lectura. |

## Detenerse si

- No se puede demostrar que la URL y la base son Preview y rama Neon desechable.
- Clerk no usa `pk_test_`, la organización activa no es de prueba, o el usuario
  no tiene rol administrador.
- La comprobación previa detecta una integración activa o no se puede hacer de
  solo lectura; no abrir entonces Integraciones.
- El resumen del seed no coincide con los conteos indicados, los códigos no
  coinciden con el PDF, o se ven datos no sintéticos.
- El lector cambia valores, la carga falla o la interfaz no identifica qué se
  confirmó.

## Limpieza

1. Conservar evidencia mínima de la corrida sin secretos ni datos reales.
2. Preferir eliminar la rama Neon desechable completa: el padre/base y los
   registros preexistentes (incluidos `E2E-FICT-001` y `E2E-001`) quedan intactos.
   Si se conserva la rama temporalmente, borrar `audit_logs` de las dos orgs
   sintéticas y después las organizaciones por sus `clerk_org_id`; verificar
   cascada de estudios, centros, sujetos, perfiles, reportes y turnos.
3. Eliminar ambas organizaciones y usuarios de prueba en Clerk cuando ya no se
   necesiten.
4. Borrar el PDF, CSV, capturas y archivos locales temporales; limpiar el
   portapapeles.
5. Verificar en la rama aislada que no quedan filas sintéticas y comprobar que
   los registros sentinela del padre/base no cambiaron.
