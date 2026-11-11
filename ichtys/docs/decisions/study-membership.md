# Membresía por estudio

Estado: **decisiones M1–M6 aprobadas el 11/11/2026; M7 y M8 pendientes; sin implementar**. Revisado por Reviewer y por la revisión automática del PR; sus correcciones están incorporadas abajo.
Fecha: 2026-11-11.

## El problema

Hoy la frontera de acceso es la organización. `validateStudyAccess` (`packages/auth/validate-study-access.ts`) comprueba que el estudio pertenezca a la organización del token y que el rol alcance; no comprueba que **esa persona** tenga algo que ver con **ese estudio**. Los listados hacen lo mismo: filtran por `organization_id` y nada más.

Consecuencia: todo miembro de una organización ve todos los estudios de la organización, con el alcance que le dé su rol.

Para un centro con un solo equipo eso alcanza. Deja de alcanzar en cuanto pasa lo normal en investigación clínica:

- Un monitor externo entra a revisar el estudio de un patrocinador y ve la lista, los protocolos y los documentos de los estudios de otros patrocinadores.
- Un investigador principal ve sujetos de estudios en los que no participa. El rol le da acceso a datos clínicos; nada lo limita a sus estudios.
- Un centro no puede demostrar ante una auditoría quién tenía acceso a qué estudio en una fecha dada, porque la respuesta es «todos, a todo».

La frontera entre organizaciones no cambia y no se discute acá: sigue siendo la primera comprobación, siempre.

## Qué se propone: dos ejes

- **Alcance**: a qué estudios entra una persona. Lo decide la **membresía**.
- **Capacidad**: qué puede hacer adentro. Lo decide el **rol de la organización**.

Los dos se comprueban siempre, y ninguno reemplaza al otro:

- Quien compruebe solo el rol deja a todos viendo todo otra vez.
- Quien le agregue permisos a la fila de membresía duplica la matriz de permisos. La membresía no lleva permisos.

`study_admin` es un rol de la organización cuyo alcance efectivo es por estudio: entra solo a los estudios que crea o a los que lo suman (M3). En la práctica es «responsable de *este* estudio», expresado como rol × membresía. No hace falta un rol distinto por estudio; si algún día una misma persona necesita oficios distintos en estudios distintos, se agrega una columna a la tabla.

### Qué puede cada rol

Columna «hoy»: lo que hace el código en `main` (`packages/auth/roles.ts` y las rutas). Columna «regla»: lo definido por Santiago el 11/11/2026.

| Capacidad | Hoy | Regla |
|---|---|---|
| Ver datos clínicos de sujetos | investigador, coordinador, `study_admin`, `org_admin` | igual |
| Ver laboratorios y qué datos van al CRF | los mismos | igual; es trabajo central de `study_admin` |
| Controlar que lo evolucionado por el médico sea correcto | sin capacidad propia | `study_admin` |
| **Escribir una evolución clínica** | los cuatro roles con acceso a datos clínicos: la ruta de evoluciones exige solo ese acceso | **solo el médico**. `study_admin` no |
| **Responder en nombre del médico** | sin capacidad propia | **nadie más que el médico** |
| Subir y gestionar documentos | coordinador, `study_admin`, `org_admin` | igual |
| Crear estudios, importar, ajustes de la organización | `study_admin`, `org_admin` | igual |
| Ver y nada más | monitor (sin datos clínicos) | igual |

Dos consecuencias que este documento registra pero no resuelve:

1. **La escritura de evoluciones hoy es más amplia que la regla.** Cerrarla es un cambio propio, chico y separado de la membresía: una capacidad explícita de autoría clínica, exigida en la ruta, con su prueba. No se deriva de la jerarquía: la jerarquía es lineal (`study_admin` está por encima del investigador) y la autoría clínica no lo es.
2. **Un rol por persona no alcanza para «administra y además es médico».** Si el director del centro es `org_admin` y también investigador, con la regla aplicada sobre el rol no podría evolucionar. Ver M7.

## Reglas

1. `org_admin` entra a todos los estudios de su organización sin fila de membresía. Es quien las administra.
2. Cualquier otro rol entra a un estudio solo si tiene una membresía vigente en ese estudio.
3. Quien crea un estudio queda como miembro en la misma transacción.
4. Una membresía puede tener fecha de vencimiento. Vencida, no da acceso. Pensado para monitores, que rotan.
5. Sin membresía la respuesta es **404**, igual que para un estudio que no existe o que es de otra organización. No se confirma la existencia de un estudio a quien no puede verlo.
6. Un estudio al que la persona no entra tampoco aparece en listados, búsquedas, contadores del Inicio, agenda ni pendientes de laboratorio. Un contador que suma estudios ajenos es una fuga aunque no muestre nombres.
7. Alta, baja y cambio de vencimiento de una membresía, y el cambio de modo de la organización, quedan en `audit_logs`.

La regla 5 hoy no se cumple entre organizaciones: `apps/web/app/(app)/studies/[id]/layout.tsx` llama a `studyExistsInAnotherOrganization` (`packages/auth/resolve-org.ts`), que consulta el estudio sin límite de organización para distinguir el caso. Se quita en un PR propio, antes que todo lo demás (paso 0).

## Tabla

```
study_memberships
  id               uuid, clave primaria
  organization_id  uuid, no nulo
  study_id         uuid, no nulo
  user_id          text, no nulo        -- identificador del usuario en el proveedor de identidad
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

Las bajas se marcan, no se borran: «quién tenía acceso a este estudio el día tal» tiene que poder responderse. Por eso la clave foránea no borra en cascada: con cascada, eliminar el estudio se llevaba la historia que la tabla existe para conservar. Consecuencia a atender en la implementación: un estudio con historia de membresías no se puede eliminar, y los scripts que eliminan organizaciones enteras (`orgs:consolidate`) van a fallar hasta que decidan qué hacer con esas filas.

### Lo que la tabla no responde

`org_admin` entra sin fila, y los roles y la pertenencia a la organización viven en el proveedor de identidad. Para una fecha pasada, la tabla no dice quién era `org_admin`. La historia completa de acceso necesita además registrar en `audit_logs` las altas, bajas y cambios de rol de la organización. Eso hoy no existe. Es un paso propio (paso 5) y, hasta que esté, la respuesta de auditoría es parcial: completa para miembros, incompleta para administradores.

## Dónde se aplica

Tres lugares. Salen del mismo módulo (`packages/auth`) para que no se separen.

### 1. Acceso a un estudio

La versión anterior de este documento decía que todos los validadores pasaban por `validateStudyAccess`. Es falso: `validatePhiStudyAccess`, `validateSubjectAccess` y los de `object-access.ts` autentican y consultan el estudio por su cuenta. Agregar la comprobación en uno solo dejaba abiertos los demás.

Se propone una función única, `assertStudyMembership(ctx)`, llamada por **cada** validador después de la comprobación de organización. Una prueba enumera los validadores exportados por `packages/auth` y falla si alguno no la llama.

### 2. Consultas sobre `studies`

`visibleStudiesFilter(ctx)` devuelve la condición SQL: organización y, si no es `org_admin` y la organización está en modo estricto, existencia de membresía vigente. Ninguna consulta de estudios arma su propio filtro.

### 3. Consultas sobre tablas hijas

Es el hueco que encontró Reviewer y la parte más grande del trabajo. `organization_id` está copiado en las tablas hijas (`subjects`, `lab_reports`, `documents`, `agenda_items`, `audit_logs`, `patient_profiles`, imágenes de laboratorio). Eso permite contar y listar por organización sin tocar nunca `studies`, y un filtro sobre `studies` no alcanza a esas consultas. Casos ya identificados en `main`:

- `apps/web/lib/os/inicio-data.ts`: `countPendingLabReviews` y `countPendingLabReports` cuentan por organización sobre la tabla hija. El listado gemelo sí une con `studies`; el contador no.
- `listActiveStudies`, segunda consulta: agrupa sujetos por estudio filtrando solo por organización.
- `apps/web/lib/os/search.ts`: la rama de sujetos necesita la membresía igual que la de estudios.

Se propone `visibleStudyIds(ctx)`: una subconsulta con los estudios visibles, que cada consulta sobre una tabla hija aplica como `study_id IN (...)`. Donde la tabla no tenga `study_id`, por unión con `subjects`. No es agregar un filtro: es reescribir cada una de esas consultas.

## Cómo se pasa de «todos ven todo» a membresía

No se puede hacer con una migración de datos: los miembros de una organización viven en el proveedor de identidad, no en la base. Una migración SQL no sabe a quién darle qué.

Se usa un modo por organización, guardado en `organizations.os_settings`:

- `open` — el comportamiento de hoy. Las membresías se pueden cargar, pero no restringen.
- `enforced` — valen las reglas de arriba.

**`open` es transitorio y tiene fecha (M5).** Sin fecha queda como estado permanente para los centros que menos incentivo tienen para hacer la carga, y el objetivo no se alcanza nunca.

Las dos direcciones no son iguales:

- `open → enforced` solo puede quitar acceso. No abre ninguna exposición nueva. El riesgo es operativo: alguien que queda sin entrar a un estudio en el que trabaja.
- `enforced → open` reabre **toda** la organización para arreglar un estudio mal cargado. Es una exposición mayor que el error que corrige.

Pasos:

1. La migración crea la tabla. Las organizaciones existentes quedan en `open` con una fecha límite. Nada cambia para nadie.
2. El administrador ve una pantalla «Acceso por estudio»: sus estudios, los miembros de la organización (leídos del proveedor de identidad), quién está en cuál y cuántos días quedan. Carga las membresías con el modo todavía en `open`.
3. Antes de pasar a `enforced`, la pantalla muestra qué cambia: «estas personas dejan de ver estos estudios» y «estas personas quedan sin ningún estudio». El cambio pide confirmación y queda auditado.
4. La corrección de un estudio mal cargado es acotada y no necesita volver a `open`: `org_admin` siempre entra y agrega la membresía que falta en el momento. Volver a `open` queda disponible solo antes de la fecha límite, auditado; después, no.

El modo vive en la organización y no en una variable de la instalación para que cada centro haga el paso cuando esté listo dentro del plazo, y para que un centro nuevo no dependa de un despliegue.

## Pruebas

- `test:leakage` suma un caso por cada punto de aplicación: dos personas de la misma organización, una con membresía y otra sin ella, y la segunda no obtiene el estudio por ninguna vía. La lista es explícita y nombra cada función: acceso directo por cada validador, listado de estudios, búsqueda (rama de estudios y rama de sujetos), cada contador del Inicio, agenda y laboratorios pendientes. Para los contadores la prueba compara números, no nombres.
- Prueba estática, redefinida. La versión anterior buscaba filtros sobre `studies` y habría pasado en verde con los contadores fugando. La nueva falla si un archivo fuera de `packages/auth` consulta `studies` **o cualquier tabla con `study_id`** filtrando por `organization_id` sin pasar por `visibleStudiesFilter` o `visibleStudyIds`. Las excepciones (trabajos internos sin usuario) van en una lista con el motivo al lado.
- Límite de la prueba estática: reconoce patrones de código, no significado. Impide que una consulta nueva nazca sin filtro; no demuestra que no haya fuga. Lo que demuestra es la prueba de fuga con datos. Hacen falta las dos.
- Todos los validadores llaman a `assertStudyMembership` (ver arriba).
- Vencimiento y baja: una membresía vencida o dada de baja no da acceso, y la historia se conserva.
- Modo `open`: el comportamiento es idéntico al actual, con y sin membresías cargadas.

## Lo que queda afuera

- **Rol distinto por estudio para una misma persona.** Ver «dos ejes».
- **Membresía por sede.** Existe la tabla `sites`, pero hoy no restringe nada. Un centro con varias sedes y equipos separados la va a necesitar; es otra decisión.
- **Limpieza automática cuando alguien sale de la organización.** No hace falta para la seguridad: quien sale de la organización falla la primera comprobación. Las filas quedan como historia.
- **Acceso de patrocinadores a varios centros.** Cruza organizaciones; es otro problema.

## Decisiones

Aprobadas por Santiago el 11/11/2026.

| # | Decisión | Resuelto |
|---|---|---|
| M1 | Modo de una organización nueva | `enforced` desde el alta. Un centro nuevo no tiene costumbres que romper, y quien crea cada estudio ya queda como miembro |
| M2 | ¿El investigador principal ve todos los estudios del centro? | No. Solo los suyos. Es el caso que más pesa en datos clínicos |
| M3 | ¿`study_admin` entra a todo, como `org_admin`? | No. Entra a los estudios que crea o a los que lo suman. Si un centro quiere a alguien que vea todo, es `org_admin` |
| M4 | Vencimiento obligatorio para monitores | Sí, con un máximo configurable. Sin fecha, el acceso de un monitor que ya no trabaja en el estudio queda abierto hasta que alguien se acuerde |
| M5 | ¿`open` es transitorio o permanente? | Transitorio, con fecha límite |
| M6 | Qué hace `study_admin` dentro de un estudio | Carga en el CRF, controla que lo evolucionado por el médico sea correcto, ve laboratorios y ve qué datos van a subir al CRF. No evoluciona una historia clínica ni responde por el médico |

Pendientes:

| # | Decisión | Recomendación |
|---|---|---|
| M7 | Quién puede evolucionar cuando la misma persona administra y es médico, y si `site_coordinator` se distingue de `study_admin` en algo más que crear estudios | Autoría clínica como atributo propio de la persona, independiente del rol. El rol sigue siendo uno |
| M8 | Plazo de `open` y qué pasa al vencer | 60 días desde que la pantalla está disponible, con aviso al administrador a 14, 7 y 1 día. Al vencer, pasa solo a `enforced`: el riesgo es que alguien quede sin entrar a un estudio, y lo corrige el administrador en el momento |

## Orden de trabajo

0. Quitar la consulta sin límite de organización del layout de estudio. PR propio, no depende de nada.
1. Migración: tabla e índice único en `studies`. Sin efecto visible.
2. `assertStudyMembership` en todos los validadores, detrás del modo, con su prueba.
3. `visibleStudiesFilter`, `visibleStudyIds` y la reescritura de las consultas sobre tablas hijas. Pruebas de fuga por función y prueba estática. Es el paso grande.
4. Pantalla «Acceso por estudio», fecha límite y cambio de modo.
5. Registro de altas, bajas y cambios de rol de la organización en `audit_logs`.
6. Recorrido en el entorno de prueba con dos personas y dos estudios antes de ofrecerlo a un centro real.

Aparte, y después de M7: capacidad de autoría clínica en la ruta de evoluciones.

Cada paso es un PR que se puede integrar solo. Con todas las organizaciones en `open`, los pasos 1 a 3 no cambian nada para nadie.
