# Acceso por estudio: funciones y membresía

Estado: **decisiones M1–M16 tomadas el 11/11/2026 y M17 el 12/11/2026; pasos 0 a 3 integrados (#105, #107, #108, #109, #111, #112, #113)**. Revisado por Reviewer y por la revisión automática del PR. La sección de funciones se reescribió con la descripción de Santiago de cómo se organiza un centro; conviene que Reviewer la vuelva a mirar.
Fecha: 2026-11-11.

## El problema

Son dos, y se resuelven juntos.

**Alcance.** Hoy la frontera de acceso es la organización. `validateStudyAccess` (`packages/auth/validate-study-access.ts`) comprueba que el estudio pertenezca a la organización del token y que el rol alcance; no comprueba que **esa persona** tenga algo que ver con **ese estudio**. Los listados filtran por `organization_id` y nada más. Todo miembro de una organización ve todos sus estudios.

- Un monitor externo entra a revisar el estudio de un patrocinador y ve los de otros patrocinadores.
- Un investigador ve sujetos de estudios en los que no participa.
- Un centro no puede demostrar quién tenía acceso a qué estudio en una fecha dada, porque la respuesta es «todos, a todo».

**Capacidad.** Los cinco roles del código (`packages/auth/roles.ts`) están ordenados en una escala: quien está más arriba puede todo lo de abajo. Un centro no funciona así. El investigador tiene toda la autoridad clínica y no administra el centro; quien dirige operaciones ve todo y no escribe una historia clínica. Con la escala, hoy la ruta de evoluciones acepta a cualquiera con acceso a datos clínicos: investigador, coordinador, `study_admin` y `org_admin`.

La frontera entre organizaciones no cambia y no se discute acá: sigue siendo la primera comprobación, siempre.

## Qué se propone: dos ejes

- **Alcance**: a qué estudios entra una persona. Lo decide la **membresía**, salvo en las funciones de dirección, que entran a todos.
- **Capacidad**: qué puede hacer adentro. Lo decide la **función** de la persona en el centro.

Los dos se comprueban siempre, y ninguno reemplaza al otro. Quien compruebe solo la función deja a todos viendo todo otra vez. La membresía no lleva permisos.

La función de una persona es la misma en todos sus estudios (M9). Por eso no va en la membresía. La delegación de tareas por estudio es asunto del CRF del patrocinador y no se modela en Ichtys (M9).

### Funciones

Tomadas de cómo se organiza un centro grande. Un centro chico usa menos: un investigador, un subinvestigador, un Study Coordinator y, a lo sumo, un asistente.

| Función | Estudios | Qué hace en Ichtys |
|---|---|---|
| Investigador (PI o Sub-PI) | Los suyos | Ve los datos clínicos. **Es el único que evoluciona una historia clínica y el único que responde un query.** PI o Sub-PI es una etiqueta por estudio, sin diferencia de permisos |
| Study Coordinator | Los suyos | Todo lo operativo del estudio: documentos, agenda, laboratorios, CRF y queries. Crea estudios. Da acceso a su equipo en sus estudios (M11) |
| Asistente de laboratorio | Los de su equipo | Carga y confirma valores de laboratorio |
| Asistente de regulatorio | Los de su equipo | Documentos, SOA y hojas de visita |
| Asistente de CRF | Los de su equipo | Ve qué datos van al CRF. Levanta los queries y sigue el plazo de respuesta del médico |
| Dirección de Operaciones | Todos | Lo del Study Coordinator, en todos los estudios. Administra equipos y accesos |
| Dirección de Investigación | Todos | Ve todo. Evoluciona solo si además tiene la función Investigador (M10) |
| Monitor | El asignado, con vencimiento | Lectura, sin datos clínicos |
| Administración de la plataforma | Ninguno por esta función sola (M12) | Ajustes de la organización, claves, alta de personas. No ve datos clínicos |

Todo el equipo del estudio (investigador, Study Coordinator y los tres asistentes) ve los datos clínicos de los sujetos de sus estudios, maneja los turnos y da de alta sujetos (M16). El investigador, además de evolucionar, confirma laboratorios. Quien solo mira —Dirección de Investigación y monitor— no modifica nada; el monitor tampoco ve datos clínicos, igual que hoy.

**Ver datos no es poder cambiarlos.** En modo estricto, cada ruta que modifica exige su capacidad: evolucionar, cargar o confirmar un laboratorio, mover un turno, dar de alta un sujeto, gestionar documentos. La tabla de arriba resume; la lista exacta de capacidades por función está en `packages/auth/functions.ts` y sus pruebas.

Tres reglas sobre las funciones:

1. **Son acumulables.** En un centro chico un asistente hace laboratorio, regulatorio y CRF. En uno grande, quien dirige investigación puede ser además médico. Una persona tiene las funciones que le correspondan y sus capacidades son la suma.
2. **La autoría clínica no se hereda.** Evolucionar y responder queries salen solo de la función Investigador. Ninguna dirección ni la administración las traen consigo.
3. **No hay escala global.** No existe «al menos tal rol». Sí hay composición explícita: Dirección de Operaciones contiene todo lo del Study Coordinator, y este todo lo de los tres asistentes. Está escrita una sola vez en el código y la comprueba una prueba, para que agregar una capacidad abajo no deje sin ella a quien está arriba. Cada capacidad nombra el par dato y operación (`clinical.read`, `labs.manage`): así «lee el estudio pero no los datos clínicos» se expresa sin casos especiales.

Criterios adoptados: «autorización total» del investigador es clínica y dentro de sus estudios, no administración del centro (importa para los investigadores externos); la gestión documental queda en el equipo y el investigador la lee.

### Dónde viven las funciones

El proveedor de identidad da un solo rol por persona. No alcanza para funciones acumulables. Las funciones pasan a nuestra base:

```
member_functions
  id               uuid, clave primaria
  organization_id  uuid, no nulo
  user_id          text, no nulo
  function_key     text, no nulo        -- lista cerrada, exigida por un CHECK en la base
  granted_by       text, no nulo
  granted_at       timestamptz, no nulo
  revoked_by       text, nulo
  revoked_at       timestamptz, nulo    -- la baja no borra la fila

  único (organization_id, user_id, function_key) donde revoked_at es nulo
```

El proveedor de identidad sigue diciendo quién es la persona y si pertenece a la organización. Qué puede hacer lo dice esta tabla.

Efecto lateral buscado: quién tenía alcance total en una fecha pasada queda en la base, con fechas. Antes dependía de la historia de roles del proveedor de identidad, que no guardamos.

## Reglas

1. Las direcciones entran a todos los estudios de su organización sin fila de membresía.
2. Cualquier otra función entra a un estudio solo si la persona tiene una membresía vigente en ese estudio.
3. Quien crea un estudio queda como miembro en la misma transacción.
4. Una membresía puede tener fecha de vencimiento. Vencida, no da acceso. Para el monitor es obligatoria (M4).
5. Sin membresía la respuesta es **404**, igual que para un estudio que no existe o que es de otra organización. No se confirma la existencia de un estudio a quien no puede verlo.
6. Un estudio al que la persona no entra tampoco aparece en listados, búsquedas, contadores del Inicio, agenda ni pendientes de laboratorio. Un contador que suma estudios ajenos es una fuga aunque no muestre nombres.
7. Alta y baja de funciones, alta, baja y cambio de vencimiento de membresías, y el cambio de modo de la organización, quedan en `audit_logs`.
8. Quien crea una organización recibe, en la misma transacción del alta, las funciones Dirección de Operaciones y Administración de la plataforma. Una organización nueva nace en modo estricto (M1); sin esto su creador no vería nada.

La regla 5 hoy no se cumple entre organizaciones: `apps/web/app/(app)/studies/[id]/layout.tsx` llama a `studyExistsInAnotherOrganization` (`packages/auth/resolve-org.ts`), que consulta el estudio sin límite de organización para distinguir el caso. Se quita en un PR propio, antes que todo lo demás (paso 0).

## Tabla de membresías

```
study_memberships
  id               uuid, clave primaria
  organization_id  uuid, no nulo
  study_id         uuid, no nulo
  user_id          text, no nulo        -- identificador del usuario en el proveedor de identidad
  study_label      text, nulo           -- «PI», «Sub-PI»; informativo, no autoriza nada
  expires_at       timestamptz, nulo    -- nulo = sin vencimiento
  created_by       text, no nulo
  created_at       timestamptz, no nulo
  revoked_by       text, nulo
  revoked_at       timestamptz, nulo    -- la baja no borra la fila: queda la historia

  clave foránea (study_id, organization_id) -> studies (id, organization_id), SIN borrado en cascada
  único (study_id, user_id) donde revoked_at es nulo
  índice (organization_id, user_id) donde revoked_at es nulo
```

La clave foránea compuesta exige un índice único en `studies (id, organization_id)`. Es redundante con la clave primaria, pero es lo que impide por construcción una membresía que apunte a un estudio de otra organización. Va en la misma migración.

Las bajas se marcan, no se borran: «quién tenía acceso a este estudio el día tal» tiene que poder responderse. Por eso la clave foránea no borra en cascada. Consecuencia a atender en la implementación: un estudio con historia de membresías no se puede eliminar, y los scripts que eliminan organizaciones enteras (`orgs:consolidate`) van a fallar hasta que decidan qué hacer con esas filas.

`study_label` es el único dato por estudio de la persona. Si alguna vez empieza a decidir permisos, este documento dejó de valer y hay que reabrirlo.

## Dónde se aplica

Todo sale de `packages/auth`, para que no se separe.

### 1. Acceso a un estudio

Los validadores no pasan todos por `validateStudyAccess`: `validatePhiStudyAccess`, `validateSubjectAccess` y los de `object-access.ts` autentican y consultan el estudio por su cuenta. Se propone una función única, `assertStudyMembership(ctx)`, llamada por **cada** validador después de la comprobación de organización. Una prueba enumera los validadores exportados por `packages/auth` y falla si alguno no la llama.

### 2. Capacidades

`allows(subject, capability, legacyCheck)` en `packages/auth/functions.ts` (PR #108). En modo `open` decide la comprobación por rol que la ruta ya hacía, sin cambios; en `enforced` deciden las funciones y el rol no cuenta. Cada ruta pasa su comprobación histórica como `legacyCheck`, así el modo `open` es idéntico a hoy por construcción. La primera capacidad que se conecta es la de autoría clínica en la ruta de evoluciones.

### 3. Consultas sobre `studies`

`visibleStudiesFilter(ctx)` devuelve la condición SQL: organización y, si la persona no tiene alcance total y la organización está en modo estricto, existencia de membresía vigente. Ninguna consulta de estudios arma su propio filtro.

### 4. Consultas sobre tablas hijas

Es el hueco que encontró Reviewer y la parte más grande del trabajo. `organization_id` está copiado en las tablas hijas (`subjects`, `lab_reports`, `documents`, `agenda_items`, `audit_logs`, `patient_profiles`, imágenes de laboratorio). Eso permite contar y listar por organización sin tocar nunca `studies`, y un filtro sobre `studies` no alcanza a esas consultas. Casos ya identificados en `main`:

- `apps/web/lib/os/inicio-data.ts`: `countPendingLabReviews` y `countPendingLabReports` cuentan por organización sobre la tabla hija.
- `listActiveStudies`, segunda consulta: agrupa sujetos por estudio filtrando solo por organización.
- `apps/web/lib/os/search.ts`: la rama de sujetos necesita la membresía igual que la de estudios.

Se propone `visibleStudyIds(ctx)`: una subconsulta con los estudios visibles, que cada consulta sobre una tabla hija aplica como `study_id IN (...)`. Donde la tabla no tenga `study_id`, por unión con `subjects`. No es agregar un filtro: es reescribir cada una de esas consultas.

## Cómo se pasa de lo de hoy a esto

No se puede hacer solo con una migración de datos: los miembros de una organización viven en el proveedor de identidad, y qué función real tiene cada uno no está escrito en ningún lado.

### Funciones

Los roles viven en el proveedor de identidad; una migración no los conoce, así que las funciones no se pueden sembrar con SQL. (La versión anterior de este documento decía lo contrario.) Mientras la organización está en `open`, la autorización sigue siendo la histórica, por rol, por el mismo camino de código que hoy. La pantalla propone una función por persona a partir de su rol:

| Rol de hoy | Función sugerida |
|---|---|
| `principal_investigator` | Investigador |
| `site_coordinator` | Study Coordinator |
| `study_admin` | Study Coordinator |
| `org_admin` | Dirección de Operaciones y Administración de la plataforma |
| `read_only_monitor` | Monitor |

Es un punto de partida para que nada se rompa el primer día, no la verdad del centro. El administrador la corrige en pantalla.

**Riesgo principal: dejar a un médico sin poder evolucionar.** No es un caso raro. Hoy pueden evolucionar cuatro de los cinco roles (`principal_investigator`, `site_coordinator`, `study_admin` y `org_admin`) y la sugerencia inicial le da la función Investigador solo al primero. Si el modo estricto llegara con eso solo, quedaría bloqueado todo el que hoy evoluciona sin ser `principal_investigator`. La autoría clínica se exige recién en modo estricto, y el paso se resuelve en dos tiempos (M15):

- **Antes del cambio**, la pantalla lista a quién afecta: las personas que escribieron evoluciones y no tienen la función Investigador. Sale de `clinical_evolutions.authorUserId`, que es la fuente autoritativa y no depende de cuánto se conserve la auditoría. El administrador resuelve cada una: es médico (se le asigna la función) o no lo es.
- **Si la fecha límite llega con casos sin resolver**, el cambio a modo estricto ocurre igual y esas personas reciben la función Investigador en forma provisoria, marcada como asignada por el sistema y visible como «pendiente de confirmar». Conservan lo que ya podían hacer: nadie queda bloqueado en medio de una visita. Quien nunca evolucionó pierde la posibilidad desde ese día.

Lo que esto no logra: una persona que no es médica y venía evolucionando sigue pudiendo hasta que alguien la revise. No es peor que hoy, queda a la vista y se le recuerda al administrador hasta que la resuelva. Frenar el cambio mientras queden casos sin resolver se descartó: deja el modo abierto para siempre justo en los centros que no hacen la carga.

El costo de esa prudencia: en las organizaciones existentes, la regla «solo el médico evoluciona» no rige hasta que pasen a modo estricto. La fecha límite (M5) lo acota.

### Membresías

Modo por organización, en una columna propia (`organizations.access_mode`, con un CHECK en la base) y su fecha límite en `access_open_until`. No va en `os_settings`: un dato de autorización no debe vivir en un JSON que otra pantalla guarda entero. Al leerlo, cualquier valor que no sea exactamente `open` se trata como `enforced`.

- `open` — el comportamiento de hoy. Funciones y membresías se pueden cargar, pero no restringen.
- `enforced` — valen las reglas de arriba.

**`open` es transitorio y tiene fecha (M5).** Sin fecha queda como estado permanente para los centros que menos incentivo tienen para hacer la carga.

Las dos direcciones no son iguales:

- `open → enforced` solo puede quitar acceso. No abre ninguna exposición nueva. El riesgo es operativo: alguien que queda sin entrar a un estudio en el que trabaja.
- `enforced → open` reabre **toda** la organización para arreglar un estudio mal cargado. Es una exposición mayor que el error que corrige.

Pasos:

1. La migración crea las tablas y las columnas. Las organizaciones existentes quedan en `open`. Nada cambia para nadie. La fecha límite se asigna cuando la pantalla esté disponible, y recién ahí el valor por defecto de la base pasa a `enforced` para las organizaciones nuevas (M1): antes, un centro nuevo quedaría en modo estricto sin pantalla para armar su equipo.
2. El administrador ve una pantalla «Equipo y accesos»: las personas con sus funciones, los estudios, quién está en cuál y cuántos días quedan. Corrige funciones y carga membresías con el modo todavía en `open`.
3. Antes de pasar a `enforced`, la pantalla muestra qué cambia: quién deja de ver qué estudios, quién queda sin ningún estudio y quién deja de poder evolucionar. El cambio pide confirmación y queda auditado.
4. La corrección de un error de carga es acotada y no necesita volver a `open`: quien tiene alcance total entra siempre y agrega la membresía o la función que falta en el momento. Volver a `open` queda disponible solo antes de la fecha límite, auditado; después, no.

## Pruebas

- `test:leakage` suma un caso por cada punto de aplicación: dos personas de la misma organización, una con membresía y otra sin ella, y la segunda no obtiene el estudio por ninguna vía. La lista es explícita y nombra cada función del código: acceso directo por cada validador, listado de estudios, búsqueda (rama de estudios y rama de sujetos), cada contador del Inicio, agenda y laboratorios pendientes. Para los contadores la prueba compara números, no nombres.
- Autoría clínica: con cada función que no sea Investigador, sola y combinada con las demás, la ruta de evoluciones rechaza. Con Investigador más cualquier otra, acepta. La prueba comprueba el motivo del rechazo, no solo el código.
- Prueba estática: falla si un archivo fuera de `packages/auth` consulta `studies` o cualquier tabla con `study_id` filtrando por `organization_id` sin pasar por `visibleStudiesFilter` o `visibleStudyIds`. Las excepciones (trabajos internos sin usuario) van en una lista con el motivo al lado.
- Límite de la prueba estática: reconoce patrones de código, no significado. Impide que una consulta nueva nazca sin filtro; no demuestra que no haya fuga. Lo que demuestra es la prueba de fuga con datos. Hacen falta las dos.
- Todos los validadores llaman a `assertStudyMembership`.
- Vencimiento y baja: una membresía o una función vencida o dada de baja no da acceso, y la historia se conserva.
- Modo `open`: el comportamiento es idéntico al actual, con y sin funciones y membresías cargadas.

## Lo que queda afuera

- **Función distinta por estudio para una misma persona, y delegación de tareas.** M9.
- **Membresía por sede.** Existe la tabla `sites`, pero hoy no restringe nada. Es otra decisión.
- **Dispensación de medicación.** Es tarea del asistente de laboratorio en el centro; Ichtys no la modela.
- **Seguimiento del plazo de los queries.** El asistente de CRF levanta el query, solo el médico lo responde y hay un plazo que alguien tiene que perseguir. Es requisito del módulo de queries, con el plazo configurable por estudio. Acá solo se fija quién puede responder.
- **Limpieza automática cuando alguien sale de la organización.** Quien sale falla la primera comprobación. Las filas quedan como historia.
- **Acceso de patrocinadores a varios centros.** Cruza organizaciones; es otro problema.

## Decisiones

Tomadas por Santiago el 11/11/2026.

| # | Decisión | Resuelto |
|---|---|---|
| M1 | Modo de una organización nueva | `enforced` desde el alta |
| M2 | ¿El investigador ve todos los estudios del centro? | No. Solo los suyos |
| M3 | ¿El Study Coordinator entra a todo? | No. Entra a los estudios que crea o a los que lo suman. Alcance total tienen solo las direcciones |
| M4 | Vencimiento obligatorio para monitores | Sí, con un máximo configurable |
| M5 | ¿`open` es transitorio o permanente? | Transitorio, con fecha límite |
| M6 | Quién evoluciona y quién responde queries | Solo el médico. El equipo carga en el CRF, controla que lo evolucionado sea correcto, ve laboratorios y ve qué datos van al CRF, pero no evoluciona ni responde por el médico. (Registrada primero bajo el nombre `study_admin`; describe al equipo del Study Coordinator) |
| M7 | Quien dirige o administra y además es médico | Funciones acumulables: tiene además la función Investigador |
| M9 | ¿La función cambia según el estudio? ¿Ichtys refleja la delegación? | No y no. La función es la función; la delegación es asunto del CRF |
| M10 | Direcciones de Operaciones y de Investigación | Ven todos los estudios. Quien dirige investigación evoluciona si es médico |
| M11 | Quién da acceso a un estudio | Operaciones en todos; el Study Coordinator, que es parte de Operaciones, a su equipo en sus estudios |

Delegadas por Santiago el 11/11/2026 y resueltas con la recomendación:

| # | Decisión | Resuelto |
|---|---|---|
| M8 | Plazo de `open` y qué pasa al vencer | 60 días desde que la pantalla está disponible, con aviso al administrador a 14, 7 y 1 día. Al vencer, pasa solo a `enforced` |
| M12 | ¿Quien administra la plataforma (ajustes, claves) ve datos clínicos y todos los estudios? | No por esa función sola. Los ve si además tiene otra. En un centro chico la misma persona tendrá las dos |
| M13 | ¿Quien administra puede asignarse a sí mismo otra función? | Sí. Queda auditado con marca propia de autoasignación y se muestra en la pantalla. Impedirlo dejaría sin salida al centro de una sola persona. Para centros grandes queda abierta la regla de dos personas |
| M14 | ¿Puede una organización quedar sin nadie que asigne funciones? | No. Quien es administrador de la organización en el proveedor de identidad conserva siempre la administración de la plataforma, que no trae datos clínicos |
| M15 | Fecha límite con personas que evolucionan y no tienen la función Investigador | El cambio ocurre igual. Reciben la función en forma provisoria, marcada y pendiente de confirmar. Nadie queda bloqueado; quien nunca evolucionó ya no puede |
| M16 | Quién lleva la agenda, el alta de sujetos y los laboratorios | Todo el equipo del estudio maneja turnos y da de alta sujetos: el Study Coordinator tiene asistentes para repartir la operación del día. El investigador «lleva todo» lo clínico: además de evolucionar, confirma laboratorios. No gestiona documentos ni da accesos |
| M17 | ¿Quien carga un laboratorio tiene que ser distinto de quien lo confirma? | **No.** Definido por Santiago el 12/11/2026. Hay dos circuitos. (a) **Informe externo:** el médico ya lo evaluó en la consulta; quien lo carga después (médico, laboratorista o asistente) transcribe un documento ya evaluado, y «confirmar» en Alphi significa solo «los valores coinciden con el informe». (b) **Laboratorio propio:** carga quien hizo las determinaciones. `labs.manage` sigue cubriendo cargar y confirmar; no se separa en dos capacidades. Consecuencias: cada resultado guarda **origen** (informe externo o laboratorio propio) y **quién lo cargó**; la pantalla no presenta la confirmación como validación clínica. Aclarado por Santiago el mismo día: en el circuito (b) el resultado **nace en las planillas y en el sistema propio del laboratorio**, que no está integrado; ese es el documento fuente. Alphi no es el origen: guarda el informe tal como el laboratorio lo emite o lo envía, y cada valor remite a ese documento (`docs/compliance/REGULATORY-BASELINE.md`, §2) |

## Orden de trabajo

0. Quitar la consulta sin límite de organización del layout de estudio. PR propio, no depende de nada.
1. Migración `0017`: `member_functions`, `study_memberships`, modo de la organización e índice único en `studies`. Sin efecto visible. (PR #107.)
2. Capacidades sobre funciones en `packages/auth`, con el comportamiento de hoy mientras el modo sea `open`. Autoría clínica en la ruta de evoluciones, activa en `enforced`.
3. `assertStudyMembership` en todos los validadores, detrás del modo, con su prueba.
4. `visibleStudiesFilter`, `visibleStudyIds` y la reescritura de las consultas sobre tablas hijas. Pruebas de fuga por función y prueba estática. Es el paso grande.
5. Pantalla «Equipo y accesos», fecha límite y cambio de modo.
6. Recorrido en el entorno de prueba con dos personas y dos estudios antes de ofrecerlo a un centro real.

Cada paso es un PR que se puede integrar solo. Con todas las organizaciones en `open`, los pasos 1 a 4 no cambian nada para nadie.
