# Política de control de accesos — Alphi

**Estado: BORRADOR — pendiente de revisión por Calidad, Seguridad y responsables del centro.**
**Fecha:** 2026-11-12 · **Actualizado contra el código:** 2026-11-16 (rama principal `ff81b08`)
**Responsable propuesto:** dirección técnica hasta designar un responsable de Seguridad.
**Base:** [`REGULATORY-BASELINE.md`](./REGULATORY-BASELINE.md), §§4 (R3, R4, R5, R8, R11) y 6; [`study-membership.md`](../decisions/study-membership.md).
**Reemplaza:** la versión 1.0 (vigencia 2026-06-30), que describía el modelo de roles anterior al acceso por función y por estudio. Sus controles de operación siguen en §5.

Este borrador define el control deseado para la aplicación y su operación. No acredita que cada control esté activo en producción. El estado de código, pruebas y despliegue se distingue al final.

## 1. Alcance y principio

Se aplica a personas y cuentas técnicas que puedan acceder a organizaciones, estudios, datos clínicos, configuración, auditoría o infraestructura de Alphi. Cada permiso debe tener finalidad, responsable, alcance y duración. Las cuentas de personas son individuales; las técnicas se identifican, limitan y revisan por separado.

La identidad y pertenencia a una organización provienen del proveedor de identidad. Dentro de ella se comprueban **dos ejes**: capacidad para la operación y alcance del estudio. Un identificador enviado por el cliente nunca concede acceso. Para quien consulta, el rechazo por falta de alcance de estudio debe ser indistinguible de un estudio inexistente.

## 2. Capacidades y alcance de estudio

[`packages/auth/functions.ts`](../../packages/auth/functions.ts) es la lista técnica de capacidades por función. Las funciones se pueden acumular; el rol histórico no forma una escala de privilegios en modo estricto.

| Función | Alcance de estudios | Límite principal |
|---|---|---|
| Investigador | Membresías vigentes | Única función con autoría clínica y respuesta a queries; no administra accesos por esa función. |
| Study Coordinator y asistentes | Membresías vigentes | Operan solo con las capacidades expresas de sus funciones. |
| Dirección de Operaciones | Todos los estudios de su organización | Administra equipos y accesos, sin autoría clínica por esa función. |
| Dirección de Investigación | Todos los estudios de su organización | Lectura; necesita también la función Investigador para autoría clínica. |
| Monitor | Membresía con vencimiento | Lectura de estudio, sin datos clínicos. |
| Administración de plataforma | Ninguno por esta función sola | Ajustes de organización y accesos, sin datos clínicos por esa función. |

En modo `enforced`, una persona sin capacidad suficiente o sin membresía vigente recibe acceso denegado. Las dos direcciones tienen alcance total solo **dentro de su organización**. Las bajas y vencimientos dejan de conceder alcance. Listados, búsquedas, contadores y recursos hijos deben aplicar la misma frontera.

**La frontera entre organizaciones es la misma en los dos modos:** la organización sale siempre de la sesión y nunca del pedido, y las pruebas de fuga que lo comprueban bloquean la integración. `open` solo afloja lo que pasa adentro de una organización: todo miembro ve todos sus estudios y deciden los roles históricos.

El modo `open` conserva los chequeos históricos por rol mientras una organización se prepara para `enforced`. Es transitorio por decisión (M5 y M8): 60 días desde que la pantalla de equipo está disponible, con aviso al administrador a 14, 7 y 1 día. **Al vencer, la organización no pasa sola a `enforced`** (M20, del 14/11/2026, que revisa M8): sigue en `open`, la pantalla «Equipo y accesos» lo muestra como alerta, y el paso lo hace una persona con administración de accesos, mirando antes a quién le cambia el acceso. Nadie se queda sin acceso por omisión. Una organización nueva nace en `enforced` (M1).

**Qué ejecuta el código al 16/11/2026 y qué no:**

- **Construido.** El cambio de modo tiene ruta y pantalla ([`mode/route.ts`](../../apps/web/app/api/org/team/mode/route.ts), `components/access/mode-panel.tsx`; PR #141). Antes de pasar a `enforced` muestra a quién le cambia el acceso (quién pierde estudios y quién deja de poder escribir). El cambio queda registrado junto con la escritura (`org.access_mode.update`). Ya no hace falta escribir en la base.
- **Construido.** La fecha límite (`organizations.access_open_until`) la leen la pantalla y la ruta de cambio de modo; si una organización está en `open` sin plazo, se le asigna al abrir la pantalla y queda registrado (`org.access_mode.deadline_set`). **No cambia el modo por sí sola: eso es la decisión M20, no una brecha** ([`access-subject.ts`](../../packages/auth/access-subject.ts)).
- **Sigue abierto.** El valor por defecto de `access_mode` en el esquema es `open`, no `enforced`: M1 está decidida y sin construir.
- **Sigue abierto.** Los avisos a 14, 7 y 1 día no se encontraron en el código: la pantalla muestra los días que faltan a quien la abre, y nada avisa a quien no la abre.

Como el paso a `enforced` lo hace una persona, una organización puede quedar en `open` después del plazo, con la alerta a la vista. Este documento no afirma qué modo está activo en cada entorno.

## 3. Alta, cambio, baja y revisión

1. **Solicitud y aprobación.** El responsable solicita función, estudio y vencimiento cuando corresponda. Quien asigna queda identificado en el registro. El acceso privilegiado o de producción requiere justificación y aprobación específicas. **Aprobación por una segunda persona:** es el objetivo para organizaciones con más de una persona que administra accesos, y **no está decidida ni construida** (M13 la deja abierta para centros grandes). Hay dos casos decididos en que la misma persona pide y recibe:
   - **Quien crea un estudio** recibe su membresía en la misma operación, sin aprobador aparte. El registro lo marca con el motivo `study_creator`.
   - **Quien administra puede asignarse una función a sí mismo** (M13): impedirlo dejaría sin salida al centro de una sola persona. La decisión exige que quede auditado con marca propia de autoasignación y que la pantalla lo muestre. La marca está construida: las rutas de funciones y de membresías registran `selfAssigned` cuando quien asigna y quien recibe son la misma persona. **Sin verificar en esta revisión:** que la pantalla lo muestre. Quien es administrador de la organización en el proveedor de identidad conserva siempre la administración de la plataforma (M14), que no trae datos clínicos.
2. **Alta.** Se comprueba identidad personal y pertenencia a la organización. Se asigna solo la combinación necesaria. Las sugerencias derivadas de roles anteriores sirven para preparar la revisión; por sí solas no autorizan.
3. **Cambio.** Un cambio de tarea o estudio dispara revisión de capacidades, membresías y vencimientos. La autoría clínica se concede solo a quien el centro identifica como investigador habilitado.
4. **Baja.** Al terminar la participación se revoca el acceso en el proveedor de identidad y en Alphi sin esperar la revisión periódica. Se preserva el historial. Las cuentas técnicas se desactivan o rotan cuando dejan de ser necesarias.
5. **Revisión periódica.** Propuesta: cada trimestre por el responsable de la organización y al cierre de cada estudio. Se conserva una lista fechada de usuarios, funciones, estudios, vencimientos, aprobadores, excepciones y acciones correctivas. Seguridad revisa aparte accesos privilegiados y de infraestructura.

Las altas, bajas y cambios de permisos deben registrar quién, qué, cuándo y sobre qué **dentro de la misma transacción** que modifica el permiso (R3). Una falla de auditoría no debe dejar un permiso cambiado sin registro. Esto aplica también al cambio de modo `open`/`enforced`.

**Qué existe en el código al 16/11/2026.** La membresía de quien crea un estudio (alta individual y en lote), con su registro (`access.membership.grant`) en la misma operación. Y, desde los PR #138, #139 y #141, la API de equipo y la pantalla «Equipo y accesos»: asignar y quitar funciones (`access.function.grant` / `revoke`), dar, cambiar y quitar la membresía de otra persona en un estudio (`access.membership.grant` / `update` / `revoke`) y cambiar el modo. Las tres rutas escriben con la misma pieza que une la escritura y su registro (`auditedWrite`). Los pasos 1 a 5 de esta sección describen el procedimiento que esa pantalla sostiene. **Lo que sigue sin existir:** la aprobación por una segunda persona, la revisión periódica con su lista fechada y la exportación del historial de accesos. Si algún centro activó `enforced` no se lee del código: está en «Sin verificar».

## 4. Separación de funciones y acceso excepcional

La administración de plataforma no trae lectura clínica. La dirección no hereda autoría clínica. Confirmar que los valores de un laboratorio coinciden con su informe no se presenta como validación clínica ni como firma; el circuito se describe en [`study-membership.md`](../decisions/study-membership.md) (M17). Ninguna cuenta compartida se usa para atribuir acciones clínicas.

**Coordinar un estudio en modo `open`** (decisión del 14/11/2026, D24; PR #183): coordina quien tiene coordinación del centro o más. El investigador principal tiene el mismo rango y **no** coordina por ese rol. Se decide en un solo lugar (`coordinatesStudy`, en [`permissions.ts`](../../apps/web/lib/access/permissions.ts)), porque en modo `open` pedir una capacidad adicional en el validador clínico no restringe a nadie.

**Evolución registrada en el sujeto equivocado** (D24; [`grabacion-en-sujeto-equivocado.md`](../decisions/grabacion-en-sujeto-equivocado.md); PR #172 a #183):

- La declara quien la escribió o quien coordina el estudio. Es una acción definitiva.
- El texto de una evolución anulada lo leen quien la escribió y quien coordina.
- Lo que entró al perfil desde esa evolución lo retira quien puede escribir evoluciones, no la coordinación: sacar un dato clínico del perfil es una decisión clínica. Lo retirado se conserva cifrado, con quién y cuándo.
- Sus grabaciones pasan a un depósito que ve y escucha solo quien las grabó.
- **Sin verificar:** nada de esto se probó con dos personas distintas en un entorno real; consta en pruebas automáticas y en la lectura del código.

El acceso de emergencia requiere procedimiento aprobado antes de habilitarlo: motivo, persona, alcance mínimo, duración, registro y revisión posterior independiente. Hasta que existan procedimiento y prueba, no se presume una vía de emergencia segura.

## 5. Accesos de operación y secretos

Controles de la versión 1.0 que siguen vigentes, más el inventario de claves, que es nuevo.

- **Base de producción:** acceso restringido a operadores autorizados y nominales. Toda consulta o cambio hecho fuera de la aplicación es acceso privilegiado (§3, punto 1).
- **Secretos** (claves de proveedores, de cifrado, de la base): viven solo en las variables de entorno del proveedor de alojamiento. Nunca en el repositorio, en tickets, en conversaciones ni en mensajes. Un secreto que aparece en cualquiera de esos lugares se da por expuesto: se reemplaza y se revoca, en ese orden.
- **Inventario de claves:** cada clave tiene dueño, cuenta u organización del proveedor a la que pertenece, entorno donde está cargada y fecha de la última rotación. **No existe todavía.** El 2026-11-12 se encontró que la clave de un proveedor de modelos cargada en el entorno pertenecía a otra organización de ese proveedor, sin saldo; nada en el sistema lo decía.
- **Entornos de prueba y de vista previa:** solo datos sintéticos (R5). Ningún dato real de pacientes.
- **Límite de pedidos** en las rutas sensibles: diseño en [`rate-limiting-observability.md`](../decisions/rate-limiting-observability.md). **Construido el 14/11/2026 en seis puntos de las rutas clínicas** (PR #166, `apps/web/lib/security/clinical-rate-limit.ts`): guardar una evolución, guardar y escuchar una grabación, informe de laboratorio en PDF y en fotos, y extraer laboratorio de un texto. Si el servicio que cuenta no responde, esas rutas no se bloquean y se cuenta dentro del proceso. Los topes son una estimación, sin prueba de carga.
- **Sellado de las evaluaciones de elegibilidad anteriores al cifrado** (brecha C3 del marco): es acceso privilegiado y nominal. La ruta `/api/os/screening-seal` solo existe para los usuarios de una lista de operadores (`ALPHI_SEAL_OPERATORS`), no para un rol del centro, y tiene fecha de baja en el código (1/1/2027). Corrió el 14/11/2026 en las dos bases, con un registro por organización a nombre del operador.
- **Respaldo:** al 16/11/2026 la base de producción solo se puede restaurar dentro de las últimas seis horas y no hay instantáneas ni volcados (ver C3 en el marco y [`BACKUP-AND-DR.md`](./BACKUP-AND-DR.md)). Quien tenga acceso de operación tiene que saberlo antes de un cambio riesgoso.
- **Sesiones:** vencimiento y revocación dependen del proveedor de identidad. Quitar a una persona de la organización allí le quita la pertenencia; cuánto tarda en cortarse una sesión ya abierta está sin verificar.

## 6. Evidencia y cambio controlado

El responsable de Seguridad mantiene la versión aprobada de esta política, el registro de accesos y las excepciones. Cada cambio de capacidades o alcance pasa por PR, prueba de aislamiento entre organizaciones y estudios, revisión independiente y aprobación nominal antes de producción (R8). Las pruebas del repositorio son evidencia de código; no sustituyen verificar el entorno real.

Referencias de diseño: [guía EMA sobre sistemas informatizados en ensayos clínicos, anexo 3](https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/guideline-computerised-systems-and-electronic-data-clinical-trials_en.pdf) y [`REGULATORY-BASELINE.md`](./REGULATORY-BASELINE.md). Calidad y Legales determinan la aplicabilidad concreta.

## Sin verificar

- Modo `open`/`enforced`, fecha límite y cobertura de funciones/membresías **por organización en producción**. El marco registra la función como implementada y probada en entorno de prueba, sin activación confirmada.
- Identidades y permisos reales de Clerk, MFA, caducidad de sesiones y plazo efectivo entre una baja y el bloqueo de una sesión activa.
- Revisión periódica de usuarios y accesos privilegiados, aprobadores designados y registro histórico exportable. No consta la revisión prevista para 2026-09-30.
- Cobertura completa de rutas y consultas hijas por capacidad y estudio en el despliegue vigente.
- Auditoría de altas, cambios y bajas de permisos **en un entorno real**: las escrituras existen desde los PR #138 a #141 y usan la pieza que une escritura y registro; no se comprobó en producción con personas distintas.
- El alta de organizaciones en `enforced` (M1) y los avisos a 14, 7 y 1 día (M8): decididos, sin construir. El cambio automático al vencer ya no es un pendiente: M20 decidió que no lo haya.
- Si algún centro activó `enforced`, y si la pantalla muestra la marca de autoasignación.
- Si alguna organización tiene cargada una fecha límite, y cuál.
- Límite de pedidos efectivo en producción; inventario de claves y su rotación.
- Acceso real a Neon, Vercel, Blob y otros proveedores; cuentas técnicas, privilegios, rotación y acuerdos operativos.
- Procedimiento y prueba de acceso de emergencia; responsables nominales de Seguridad y Calidad.
