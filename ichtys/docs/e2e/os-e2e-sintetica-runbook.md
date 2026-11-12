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
entre tenants. También se crean perfiles vacíos cifrados por la función real de
la app (`encryptProfileJson({})`), requeridos por la confirmación de laboratorio.

## Precondiciones

- Santiago autorizó la corrida, las dos organizaciones y el usuario sintético.
- El deployment es Preview del proyecto Vercel `asistente-bot`, y la URL no es
  alias de Producción.
- Neon confirmó que la conexión apunta a una rama desechable aislada de
  `sweet-union-82704893`. Si no se puede comprobar, detenerse sin escribir.
- Clerk Preview usa `pk_test_`; el usuario de prueba tiene rol
  **administrador** (`org:admin`) en cada organización donde se harán pasos de
  UI. Confirmar el rol en la sesión y que las acciones administrativas estén
  habilitadas. No leer ni registrar claves secretas.
- Hay dos organizaciones Clerk de prueba ya aprovisionadas en esa rama. El seed
  recibe sus `clerk_org_id` y aborta si los nombres/IDs no coinciden.
- El esquema de la base desechable está migrado hasta 0017. Ambas organizaciones
  están en `access_mode='open'`; el seed aborta si no lo están y no cambia ese
  ajuste. La 0016 afecta solo al índice vectorial.
- El entorno que ejecuta el seed tiene `PHI_ENCRYPTION_KEY` configurada igual
  que la app de prueba. El ciphertext vacío se genera con el helper de la app;
  no mostrar ni registrar la clave.
- Registrar URL Preview, nombre de rama Neon y hora en evidencia; nunca
  credenciales. No incluir datos de pacientes reales.

## Recorrido y resultado esperado

| Paso | Acción | Qué debe verse | Qué queda guardado |
| --- | --- | --- | --- |
| 1. Validar entorno/rol | Abrir el Preview autorizado e iniciar sesión con el usuario sintético administrador. | Host Preview confirmado; organización `OS-E2E-SINTETICA`; la interfaz permite administración. Si el usuario no tiene rol admin, no seguir. | Sesión Clerk de prueba; sin cambios en la app. |
| 2. Verificar Integraciones activas | Antes de abrir la página, ejecutar la consulta de solo lectura de abajo en la rama Neon desechable. Si aparece cualquier fila habilitada, detener el recorrido y no abrir Integraciones. | La consulta devuelve cero filas habilitadas. | Solo lectura; guardar en evidencia el conteo, sin secretos ni URLs. |
| 3. Sembrar datos | En la rama Neon desechable, generar el perfil vacío cifrado con el helper y ejecutar `scripts/e2e/seed-os-e2e-sintetica.sql` con ambos `clerk_org_id`, `profile_empty_encrypted` y `target_confirmation=ISOLATED_PREVIEW`. | Resumen: org A, 1 centro, 2 estudios, 2 sujetos, 2 perfiles; org B, 1 centro, 1 estudio, 3 sujetos, 3 perfiles. En org A aparecen Alfa y Gamma. | Filas sintéticas en `sites`, `studies`, `subjects` y `patient_profiles`; no se modifican organizaciones existentes. Los estudios Alfa y Gamma pertenecen a la misma organización. |
| 4. Comprobar aislamiento | En la interfaz de Estudios clínicos, revisar org A y luego cambiar a org B con el usuario de prueba correspondiente; comparar listado y códigos. | En A solo aparecen Alfa/Gamma y `E2E-SUJ-001`/`E2E-SUJ-002`; en B solo Beta y `E2E-BETA-SUJ-001..003`. No hay datos cruzados. | Sin escrituras. Evidencia de ambas vistas. |
| 5. Cargar laboratorio | En org A, ir a `Laboratorios` → `Cargar estudio`; elegir Alfa y `E2E-SUJ-001`; subir el PDF local sintético. | Revisión muestra exactamente ese estudio/sujeto y tres resultados legibles con los valores del PDF. | `lab_reports` recibe un informe `pending_review`; contenido parseado cifrado y evento `lab.extract` en `audit_logs`. El PDF fuente no se almacena en Blob. |
| 6. Revisar y confirmar | Comparar las tres filas con el PDF y confirmar solo si coinciden: Hb 13,5 g/dL, glucosa 99 mg/dL y creatinina 0,8 mg/dL. | Estado confirmado visible y asociado a los códigos sintéticos. | `lab_reports` queda `confirmed`, guarda resultados revisados cifrados, revisor/hora y evento `lab.confirm`; se actualiza el perfil del sujeto. |
| 7. Descargar CSV | Pulsar `Descargar CSV` y revisar el archivo local. | Aviso de descarga; CSV con los tres analitos, valores, unidades y códigos sintéticos. | Evento `lab.export`; CSV solo en Descargas locales hasta limpiar. |
| 8. Copiar valores | Pulsar `Copiar valores`; pegar en editor local sin guardar y luego vaciar portapapeles. | Aviso de tres filas; el contenido solo incluye los resultados sintéticos. | Otro evento `lab.export`; portapapeles temporal, se limpia al terminar. |
| 9. Crear turno | En org A, ir a `Agenda` → `Agendar turno`; Alfa, `E2E-SUJ-001`, título `E2E control sintético`, tipo visita, fecha futura válida, sin notas. Guardar. | Tarjeta de agenda muestra ese título y código, con estado programado. | Fila en `agenda_items` de la rama desechable; evento `agenda.create`. |
| 10. Abrir Integraciones | Solo después de que el paso 2 devolvió cero filas con `enabled=true`, abrir Integraciones y observar. No configurar, conectar ni enviar. | Pantalla no muestra ninguna conexión activa para la organización. Si aparece una, cerrar la pantalla y reportar; una carga de la página podría contactar un módulo remoto. | Ninguna escritura intencional; la pantalla puede hacer GET autenticados, por eso la comprobación previa es obligatoria. |

Consulta previa de solo lectura (ejecutar dentro de `psql` con
`-v clerk_org_id_a="$CLERK_TEST_ORG_ID_A"`; no selecciona secretos, URL ni
configuración):

```sql
SELECT oi.integration_key, oi.category, oi.enabled, oi.simulated
FROM organization_integrations AS oi
JOIN organizations AS o ON o.id = oi.organization_id
WHERE o.clerk_org_id = :'clerk_org_id_a'
  AND oi.enabled IS TRUE;
```

Comando para generar y pasar el perfil inicial sin mostrar el ciphertext ni la
clave; correr desde `ichtys/` en el entorno de prueba ya configurado:

```sh
PROFILE_EMPTY_ENCRYPTED="$(npx --yes tsx@4.19.2 scripts/e2e/encrypt-empty-patient-profile.ts)"
psql "$E2E_DATABASE_URL" \
  -v target_confirmation=ISOLATED_PREVIEW \
  -v clerk_org_id_a="$CLERK_TEST_ORG_ID_A" \
  -v clerk_org_id_b="$CLERK_TEST_ORG_ID_B" \
  -v profile_empty_encrypted="$PROFILE_EMPTY_ENCRYPTED" \
  -f scripts/e2e/seed-os-e2e-sintetica.sql
unset PROFILE_EMPTY_ENCRYPTED
```

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
