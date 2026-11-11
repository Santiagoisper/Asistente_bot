# Recorrido E2E sintético — OS-E2E-SINTETICA

## Estado y límites

Este guion queda preparado, no ejecutado. El equipo confirmó que el Neon del
Preview actual comparte la base de Producción. **No cargar el SQL ni abrir el
recorrido hasta que Santiago apruebe y exista un entorno de prueba realmente
aislado**, con deployment Preview, base Neon y tenant Clerk de prueba verificados.
Nunca usar el dominio ni las credenciales de Producción.

Todo dato de este guion es inventado. No agregar nombres de personas, DNI,
fechas de nacimiento, teléfonos, direcciones, ni datos tomados de documentos
reales. El PDF sintético se generó localmente fuera de este repo; no subirlo ni
adjuntarlo a una organización hasta la autorización de ejecución.

La siembra está en `scripts/e2e/seed-os-e2e-sintetica.sql`. Solo usa las
columnas existentes hasta la migración 0015. Debe apuntar a una base aislada y
recibir el ID de la organización creada en Clerk de prueba. La variable de
confirmación `ISOLATED_PREVIEW` es una barrera adicional; no sustituye la
comprobación del destino en Vercel y Neon.

## Precondiciones antes de comenzar

- Santiago aprueba crear la organización/usuario de prueba y autoriza la corrida.
- El deployment pertenece al proyecto Vercel `asistente-bot`, está en Preview,
  y no resuelve a un alias de Producción.
- Neon confirma que Preview usa una rama desechable aislada de Producción. Si
  falta esa rama o el destino no puede comprobarse, detenerse sin escribir.
- Clerk Preview usa una clave pública `pk_test_` y la organización seleccionada
  es `OS-E2E-SINTETICA`. No mostrar, copiar ni registrar claves secretas.
- La migración del entorno aislado llega a 0015.
- El archivo local es el PDF sintético de una página con la marca de agua
  `DATOS SINTÉTICOS / E2E`, el estudio `E2E-PROTOCOLO-001`, el sujeto
  `E2E-SUJ-001` y los valores hemoglobina 13,5 g/dL, glucosa 99 mg/dL y
  creatinina 0,8 mg/dL.
- Registrar el identificador/nombre de la rama de Neon, la URL del Preview y
  la hora de inicio en la evidencia de corrida; no registrar credenciales.

## Recorrido y resultados esperados

| Paso | Acción | Qué debe verse | Qué queda guardado |
| --- | --- | --- | --- |
| 1. Verificar entorno | Abrir la URL del deployment Preview aprobado e iniciar sesión con el usuario ficticio de Clerk de prueba. | Host de Preview confirmado; organización activa `OS-E2E-SINTETICA`. Si aparece Production, otro centro o una organización distinta, parar. | Sesión de prueba de Clerk. Sin cambios en la app. |
| 2. Sembrar datos | En la rama Neon aislada, ejecutar el SQL de siembra con `clerk_org_id` del tenant de prueba y confirmación `ISOLATED_PREVIEW`. | El resumen SQL informa 2 centros, 2 estudios y 6 sujetos. En `Estudios clínicos` aparecen `E2E Estudio Alfa` y `E2E Estudio Beta`, ambos activos. | Una organización sintética, centros `Centro Ficticio Aurora E2E` y `Centro Ficticio Boreal E2E`, dos estudios y seis códigos `E2E-*` en `organizations`, `sites`, `studies` y `subjects`. |
| 3. Abrir carga de laboratorio | Ir a `Laboratorios` → `Cargar estudio`; elegir `E2E Estudio Alfa` y `E2E-ALFA-SUJ-001`; adjuntar el PDF local sintético. | Formulario muestra el estudio y sujeto elegidos; al cargar, abre `Revisar y confirmar` con el sujeto/estudio correctos y tres filas legibles. | `lab_reports` recibe un informe `pending_review`; el contenido parseado se guarda cifrado y se registra `lab.extract` en `audit_logs`. Esta ruta no conserva el PDF fuente ni lo sube a Blob. |
| 4. Revisar y confirmar | Comparar cada fila con el texto visible del PDF; confirmar solo si coincide: hemoglobina 13,5 g/dL, glucosa 99 mg/dL, creatinina 0,8 mg/dL. | Estado de confirmación visible en pantalla; debe indicar que los datos quedan en Alphi y no se envían a un sistema externo. Si aparece un error de perfil, registrarlo aunque el informe quede confirmado. | `lab_reports` pasa a `confirmed`, guarda filas revisadas cifradas y marca revisor/hora; el perfil sintético puede recibir la copia de trabajo de los resultados; `audit_logs` registra `lab.confirm`. |
| 5. Descargar CSV | Pulsar `Descargar CSV` y revisar localmente el archivo. | Aviso `Descargado`; CSV con los tres analitos, valores y unidades, ligado a los códigos sintéticos. | No agrega otra fila clínica. `audit_logs` registra `lab.export`; el CSV queda solo en Descargas locales hasta limpiarlo. |
| 6. Copiar valores | Pulsar `Copiar valores`, comprobar el aviso de tres filas y pegar en un editor local sin guardar; después vaciar el portapapeles. | Aviso `Copiado: 3 filas (analito, valor y unidad)`; el texto contiene solo los tres resultados sintéticos. | `audit_logs` registra otra salida `lab.export`; los valores quedan temporalmente en el portapapeles, que se limpia al terminar. |
| 7. Crear turno | Ir a `Agenda` → `Agendar turno`; seleccionar `E2E Estudio Alfa`, sujeto `E2E-ALFA-SUJ-001`, título `E2E control sintético`, tipo visita, fecha/hora futura permitida y sin notas. Pulsar `Guardar turno`. | La semana/día muestra una tarjeta `E2E control sintético`, con el código sintético y estado programado. | Una fila `agenda_items` en la rama de prueba; notas nulas; `audit_logs` registra `agenda.create` sin guardar título ni notas en sus metadatos. |
| 8. Revisar Integraciones | Abrir `Integraciones` y solo observar estados; no pulsar configuración, conexión ni envío. | Pantalla `Integraciones`; si no hay conectores configurados, muestra que esta organización no tiene módulos conectados. Si aparece un destino activo inesperado, detenerse y reportarlo. | Sin escrituras esperadas. La pantalla solo consulta el estado; no se conecta ni escribe a sistemas externos. |

## Detenerse si

- La URL o la base no se puede identificar como Preview/Neon aislado antes de
  sembrar o cargar.
- Clerk muestra `pk_live_`, una organización real o un usuario que no sea de
  prueba.
- Un estudio/sujeto no coincide con los códigos anteriores, el lector cambia
  alguno de los tres valores o el informe muestra datos no sintéticos.
- La carga reporta cualquier error, la lista de sujetos falla, o la pantalla no
  deja ver claramente qué se confirmó.
- Integraciones presenta una conexión inesperada o solicita credenciales.

## Limpieza al finalizar una corrida autorizada

1. Guardar evidencia mínima sin credenciales: rama Neon, deployment, pantallas
   sintéticas, CSV revisado y estado de Agenda/Integraciones.
2. En la rama Neon desechable, borrar primero `audit_logs` filtrando por el
   `organization_id` de esta org (la tabla no tiene FK de borrado en el esquema
   hasta 0015). Después borrar `organizations` por el `clerk_org_id` sintético;
   verificar que desaparezcan sus estudios, centros, sujetos, informes y turnos
   por cascada. No hacerlo en Producción ni en la base Preview actualmente compartida.
3. Eliminar la organización y el usuario ficticios en Clerk de prueba.
4. Borrar PDF/CSV locales, descargas, capturas que contengan resultados y
   cualquier traza temporal; vaciar el portapapeles.
5. Confirmar con una consulta de conteo limitada a la org sintética que no quedan
   filas asociadas en la rama aislada y dejar el resultado en la evidencia.
