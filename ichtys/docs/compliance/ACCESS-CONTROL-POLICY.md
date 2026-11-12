# Política de control de accesos — Alphi

**Estado: BORRADOR — pendiente de revisión por Calidad, Seguridad y responsables del centro.**
**Fecha:** 2026-11-12
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

El modo `open` conserva los chequeos históricos por rol mientras una organización se prepara para `enforced`. Es transitorio por decisión (M5 y M8): 60 días desde que la pantalla de equipo está disponible, con aviso al administrador a 14, 7 y 1 día; al vencer, la organización pasa sola a `enforced`. Una organización nueva nace en `enforced` (M1).

**Eso es la regla; el código todavía no la ejecuta.** Tres brechas, registradas en el marco (§6):

- La fecha límite existe como columna (`organizations.access_open_until`) y nada la lee: llegar a la fecha no cambia el modo. El modo se decide solo por `organizations.access_mode` ([`access-subject.ts`](../../packages/auth/access-subject.ts)).
- El valor por defecto de `access_mode` en el esquema es `open`, no `enforced`.
- Ninguna ruta ni pantalla cambia el modo. Hoy solo se cambia escribiendo en la base.

Mientras estas brechas estén abiertas, una organización puede quedar en `open` sin plazo. Este documento no afirma qué modo está activo en cada entorno.

## 3. Alta, cambio, baja y revisión

1. **Solicitud y aprobación.** El responsable solicita función, estudio y vencimiento cuando corresponda. Quien asigna queda identificado en el registro. El acceso privilegiado o de producción requiere justificación y aprobación específicas. **Aprobación por una segunda persona:** es el objetivo para organizaciones con más de una persona que administra accesos, y **no está decidida ni construida** (M13 la deja abierta para centros grandes). Hay dos casos decididos en que la misma persona pide y recibe:
   - **Quien crea un estudio** recibe su membresía en la misma operación, sin aprobador aparte. El registro lo marca con el motivo `study_creator`.
   - **Quien administra puede asignarse una función a sí mismo** (M13): impedirlo dejaría sin salida al centro de una sola persona. La decisión exige que quede auditado con marca propia de autoasignación y que la pantalla lo muestre; se construye junto con esa pantalla. Quien es administrador de la organización en el proveedor de identidad conserva siempre la administración de la plataforma (M14), que no trae datos clínicos.
2. **Alta.** Se comprueba identidad personal y pertenencia a la organización. Se asigna solo la combinación necesaria. Las sugerencias derivadas de roles anteriores sirven para preparar la revisión; por sí solas no autorizan.
3. **Cambio.** Un cambio de tarea o estudio dispara revisión de capacidades, membresías y vencimientos. La autoría clínica se concede solo a quien el centro identifica como investigador habilitado.
4. **Baja.** Al terminar la participación se revoca el acceso en el proveedor de identidad y en Alphi sin esperar la revisión periódica. Se preserva el historial. Las cuentas técnicas se desactivan o rotan cuando dejan de ser necesarias.
5. **Revisión periódica.** Propuesta: cada trimestre por el responsable de la organización y al cierre de cada estudio. Se conserva una lista fechada de usuarios, funciones, estudios, vencimientos, aprobadores, excepciones y acciones correctivas. Seguridad revisa aparte accesos privilegiados y de infraestructura.

Las altas, bajas y cambios de permisos deben registrar quién, qué, cuándo y sobre qué **dentro de la misma transacción** que modifica el permiso (R3). Una falla de auditoría no debe dejar un permiso cambiado sin registro. Esto aplica también al cambio de modo `open`/`enforced`.

**Qué existe hoy en el código.** La única escritura de permisos de la aplicación es la membresía de quien crea un estudio (alta individual y alta en lote), y va con su registro (`access.membership.grant`) en la misma transacción. **No hay todavía ruta ni pantalla** para asignar o quitar funciones, sumar o dar de baja a otra persona en un estudio, ni cambiar el modo: los pasos 1 a 5 de esta sección describen el procedimiento que esa pantalla («Equipo y accesos») tiene que sostener. Consecuencia práctica: en `enforced`, una organización no tendría cómo asignar funciones desde la aplicación. Por eso el modo estricto no se activa en ningún centro hasta que esa pantalla exista y esté probada.

## 4. Separación de funciones y acceso excepcional

La administración de plataforma no trae lectura clínica. La dirección no hereda autoría clínica. Confirmar que los valores de un laboratorio coinciden con su informe no se presenta como validación clínica ni como firma; el circuito se describe en [`study-membership.md`](../decisions/study-membership.md) (M17). Ninguna cuenta compartida se usa para atribuir acciones clínicas.

El acceso de emergencia requiere procedimiento aprobado antes de habilitarlo: motivo, persona, alcance mínimo, duración, registro y revisión posterior independiente. Hasta que existan procedimiento y prueba, no se presume una vía de emergencia segura.

## 5. Accesos de operación y secretos

Controles de la versión 1.0 que siguen vigentes, más el inventario de claves, que es nuevo.

- **Base de producción:** acceso restringido a operadores autorizados y nominales. Toda consulta o cambio hecho fuera de la aplicación es acceso privilegiado (§3, punto 1).
- **Secretos** (claves de proveedores, de cifrado, de la base): viven solo en las variables de entorno del proveedor de alojamiento. Nunca en el repositorio, en tickets, en conversaciones ni en mensajes. Un secreto que aparece en cualquiera de esos lugares se da por expuesto: se reemplaza y se revoca, en ese orden.
- **Inventario de claves:** cada clave tiene dueño, cuenta u organización del proveedor a la que pertenece, entorno donde está cargada y fecha de la última rotación. **No existe todavía.** El 2026-11-12 se encontró que la clave de un proveedor de modelos cargada en el entorno pertenecía a otra organización de ese proveedor, sin saldo; nada en el sistema lo decía.
- **Entornos de prueba y de vista previa:** solo datos sintéticos (R5). Ningún dato real de pacientes.
- **Límite de pedidos** en las rutas sensibles: ver [`rate-limiting-observability.md`](../decisions/rate-limiting-observability.md).
- **Sesiones:** vencimiento y revocación dependen del proveedor de identidad. Quitar a una persona de la organización allí le quita la pertenencia; cuánto tarda en cortarse una sesión ya abierta está sin verificar.

## 6. Evidencia y cambio controlado

El responsable de Seguridad mantiene la versión aprobada de esta política, el registro de accesos y las excepciones. Cada cambio de capacidades o alcance pasa por PR, prueba de aislamiento entre organizaciones y estudios, revisión independiente y aprobación nominal antes de producción (R8). Las pruebas del repositorio son evidencia de código; no sustituyen verificar el entorno real.

Referencias de diseño: [guía EMA sobre sistemas informatizados en ensayos clínicos, anexo 3](https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/guideline-computerised-systems-and-electronic-data-clinical-trials_en.pdf) y [`REGULATORY-BASELINE.md`](./REGULATORY-BASELINE.md). Calidad y Legales determinan la aplicabilidad concreta.

## Sin verificar

- Modo `open`/`enforced`, fecha límite y cobertura de funciones/membresías **por organización en producción**. El marco registra la función como implementada y probada en entorno de prueba, sin activación confirmada.
- Identidades y permisos reales de Clerk, MFA, caducidad de sesiones y plazo efectivo entre una baja y el bloqueo de una sesión activa.
- Revisión periódica de usuarios y accesos privilegiados, aprobadores designados y registro histórico exportable. No consta la revisión prevista para 2026-09-30.
- Cobertura completa de rutas y consultas hijas por capacidad y estudio en el despliegue vigente.
- Auditoría de altas, cambios y bajas de permisos más allá de la membresía de quien crea un estudio: esas escrituras todavía no existen en la aplicación. Cuando existan tienen que pasar por la misma regla que el resto (el marco da C1 por cerrada en la aplicación para las escrituras que hoy se auditan).
- El cambio automático a `enforced` al vencer el plazo, los avisos previos y el alta de organizaciones en `enforced`: decididos (M1, M8), sin construir.
- Si alguna organización tiene cargada una fecha límite, y cuál.
- Límite de pedidos efectivo en producción; inventario de claves y su rotación.
- Acceso real a Neon, Vercel, Blob y otros proveedores; cuentas técnicas, privilegios, rotación y acuerdos operativos.
- Procedimiento y prueba de acceso de emergencia; responsables nominales de Seguridad y Calidad.
