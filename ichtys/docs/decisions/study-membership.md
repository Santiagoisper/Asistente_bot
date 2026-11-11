# Membresía por estudio

Estado: **propuesta, sin implementar**. Documento de diseño para decidir antes de escribir código.
Fecha: 2026-11-11.

## El problema

Hoy la frontera de acceso es la organización. `validateStudyAccess` (`packages/auth/validate-study-access.ts`) comprueba que el estudio pertenezca a la organización del token y que el rol alcance; no comprueba que **esa persona** tenga algo que ver con **ese estudio**. Los listados hacen lo mismo: filtran por `studies.organization_id` y nada más.

Consecuencia: todo miembro de una organización ve todos los estudios de la organización, con el alcance que le dé su rol.

Para un centro con un solo equipo eso alcanza. Deja de alcanzar en cuanto pasa lo normal en investigación clínica:

- Un monitor externo entra a revisar el estudio de un patrocinador y ve la lista, los protocolos y los documentos de los estudios de otros patrocinadores.
- Un investigador principal ve sujetos de estudios en los que no participa. El rol le da acceso a datos clínicos; nada lo limita a sus estudios.
- Un centro no puede demostrar ante una auditoría quién tenía acceso a qué estudio en una fecha dada, porque la respuesta es «todos, a todo».

La frontera entre organizaciones no cambia y no se discute acá: sigue siendo la primera comprobación, siempre.

## Qué se propone

**La membresía decide en qué estudios entra una persona. El rol de la organización sigue decidiendo qué puede hacer adentro.**

No se propone un rol distinto por estudio. En un centro, el personal propio tiene el mismo oficio en todos sus estudios, y el personal externo (monitores) es de solo lectura en todos. Un rol por estudio duplica la matriz de permisos y la superficie de pruebas para un caso que hoy no existe. Si aparece, se agrega una columna; la tabla que sigue no lo impide.

### Reglas

1. `org_admin` entra a todos los estudios de su organización sin fila de membresía. Es quien las administra.
2. Cualquier otro rol entra a un estudio solo si tiene una membresía vigente en ese estudio.
3. Quien crea un estudio queda como miembro en la misma transacción.
4. Una membresía puede tener fecha de vencimiento. Vencida, no da acceso. Pensado para monitores, que rotan.
5. Sin membresía la respuesta es **404**, igual que para un estudio que no existe o que es de otra organización. No se confirma la existencia de un estudio a quien no puede verlo.
6. Un estudio al que la persona no entra tampoco aparece en listados, búsquedas, contadores del Inicio, agenda ni pendientes de laboratorio. Un contador que suma estudios ajenos es una fuga aunque no muestre nombres.
7. Alta, baja y cambio de vencimiento de una membresía, y el cambio de modo de la organización, quedan en `audit_logs`.

### Tabla

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

  clave foránea (study_id, organization_id) -> studies (id, organization_id), borrado en cascada
  único (study_id, user_id) donde revoked_at es nulo
  índice (organization_id, user_id) donde revoked_at es nulo
```

La clave foránea compuesta exige un índice único en `studies (id, organization_id)`. Es redundante con la clave primaria, pero es lo que impide por construcción una membresía que apunte a un estudio de otra organización. Va en la misma migración.

Las bajas se marcan, no se borran: «quién tenía acceso a este estudio el día tal» tiene que poder responderse.

### Dónde se aplica

Dos lugares, y tienen que salir del mismo módulo para que no se separen:

- **Acceso a un estudio.** `validateStudyAccess` suma la comprobación después de la de organización. Todas las rutas de estudio, sujetos, documentos, laboratorios y agenda ya pasan por ahí o por funciones que la llaman (`validatePhiStudyAccess`, `validateSubjectAccess`, las de `object-access.ts`). Es un punto único y es la parte chica del cambio.
- **Listados.** Hoy filtran por organización en diez archivos; los que más: `apps/web/lib/os/inicio-data.ts` (7 consultas), `apps/web/lib/os/search.ts`, `apps/web/lib/agenda/agenda-service.ts`, y las páginas `studies`, `library`, `dashboard` y `admin`. Se propone una sola función en `packages/auth`, `visibleStudiesFilter(ctx)`, que devuelva la condición SQL (organización y, si no es `org_admin` y la organización está en modo estricto, existencia de membresía vigente). Ninguna consulta de estudios arma su propio filtro.

Es la parte grande y la que puede fallar en silencio: una consulta que quede sin migrar no rompe nada, solo muestra de más. Por eso el criterio de terminado es una prueba, no una revisión a ojo (ver «Pruebas»).

## Cómo se pasa de «todos ven todo» a membresía

No se puede hacer con una migración de datos: los miembros de una organización viven en el proveedor de identidad, no en la base. Una migración SQL no sabe a quién darle qué.

Se propone un modo por organización, guardado en `organizations.os_settings`:

- `open` — el comportamiento de hoy. Las membresías se pueden cargar, pero no restringen.
- `enforced` — valen las reglas de arriba.

Pasos:

1. La migración crea la tabla. Todas las organizaciones existentes quedan en `open`. Nada cambia para nadie.
2. El administrador ve una pantalla «Acceso por estudio»: sus estudios, los miembros de la organización (leídos del proveedor de identidad) y quién está en cuál. Carga las membresías con el modo todavía en `open`.
3. Antes de pasar a `enforced`, la pantalla muestra qué cambia: «estas personas dejan de ver estos estudios» y «estas personas quedan sin ningún estudio». El cambio pide confirmación y queda auditado.
4. Volver a `open` es posible y también queda auditado. Es la salida de emergencia si algo se cargó mal.

El modo vive en la organización y no en una variable de la instalación para que cada centro haga el paso cuando esté listo, y para que un centro nuevo no dependa de un despliegue.

## Pruebas

- `test:leakage` suma un caso por cada punto de aplicación: dos personas de la misma organización, una con membresía y otra sin ella, y la segunda no obtiene el estudio por ninguna vía (acceso directo, listado, búsqueda, contador, agenda, laboratorios pendientes).
- Una prueba estática que falle si algún archivo fuera de `packages/auth` filtra `studies` por `organization_id` sin pasar por `visibleStudiesFilter`. Es la que impide que una consulta nueva nazca sin el filtro.
- Vencimiento y baja: una membresía vencida o dada de baja no da acceso, y la historia se conserva.
- Modo `open`: el comportamiento es idéntico al actual, con y sin membresías cargadas.

## Lo que queda afuera

- **Rol por estudio.** Ver arriba.
- **Membresía por sede.** Existe la tabla `sites`, pero hoy no restringe nada. Un centro con varias sedes y equipos separados la va a necesitar; es otra decisión.
- **Limpieza automática cuando alguien sale de la organización.** No hace falta para la seguridad: quien sale de la organización falla la primera comprobación. Las filas quedan como historia.
- **Acceso de patrocinadores a varios centros.** Cruza organizaciones; es otro problema.

## Decisiones que hacen falta

| # | Decisión | Recomendación |
|---|---|---|
| M1 | Modo de una organización nueva | `enforced` desde el alta. Un centro nuevo no tiene costumbres que romper, y quien crea cada estudio ya queda como miembro |
| M2 | ¿El investigador principal ve todos los estudios del centro? | No. Solo los suyos. Es el caso que más pesa en datos clínicos |
| M3 | ¿`study_admin` entra a todo, como `org_admin`? | No. Entra a los estudios que crea o a los que lo suman. Si un centro quiere a alguien que vea todo, es `org_admin` |
| M4 | Vencimiento obligatorio para monitores | Sí, con un máximo configurable. Sin fecha, el acceso de un monitor que ya no trabaja en el estudio queda abierto hasta que alguien se acuerde |

## Orden de trabajo

1. Migración: tabla e índice único en `studies`. Sin efecto visible.
2. `visibleStudiesFilter` y la comprobación en `validateStudyAccess`, detrás del modo. Con todas las organizaciones en `open` no cambia nada. Pruebas de fuga y prueba estática.
3. Pantalla «Acceso por estudio» y cambio de modo.
4. Recorrido en el entorno de prueba con dos personas y dos estudios antes de ofrecerlo a un centro real.

Cada paso es un PR que se puede integrar solo.
