# Política de control de accesos — Alphi

**Estado: BORRADOR — pendiente de revisión por Calidad, Seguridad y responsables del centro.**
**Fecha:** 2026-11-12
**Responsable propuesto:** dirección técnica hasta designar un responsable de Seguridad.
**Base:** [`REGULATORY-BASELINE.md`](./REGULATORY-BASELINE.md), §§4 (R3, R4, R8, R11) y 6; [`study-membership.md`](../decisions/study-membership.md).

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

El modo `open` conserva los chequeos históricos por rol mientras una organización se prepara para `enforced`. Es transitorio; la fecha límite y activación se registran por organización. El código contiene ambos modos, pero este documento no afirma cuál está activo en cada entorno.

## 3. Alta, cambio, baja y revisión

1. **Solicitud y aprobación.** El responsable solicita función, estudio y vencimiento cuando corresponda. Una persona autorizada distinta de quien solicita deja aprobación identificable antes del alta. El acceso privilegiado o de producción requiere justificación y aprobación específicas.
2. **Alta.** Se comprueba identidad personal y pertenencia a la organización. Se asigna solo la combinación necesaria. Quien crea un estudio recibe su membresía en la misma operación. Las sugerencias derivadas de roles anteriores sirven para preparar la revisión; por sí solas no autorizan.
3. **Cambio.** Un cambio de tarea o estudio dispara revisión de capacidades, membresías y vencimientos. La autoría clínica se concede solo a quien el centro identifica como investigador habilitado.
4. **Baja.** Al terminar la participación se revoca el acceso en el proveedor de identidad y en Alphi sin esperar la revisión periódica. Se preserva el historial. Las cuentas técnicas se desactivan o rotan cuando dejan de ser necesarias.
5. **Revisión periódica.** Propuesta: cada trimestre por el responsable de la organización y al cierre de cada estudio. Se conserva una lista fechada de usuarios, funciones, estudios, vencimientos, aprobadores, excepciones y acciones correctivas. Seguridad revisa aparte accesos privilegiados y de infraestructura.

Las altas, bajas y cambios de permisos deben registrar quién, qué, cuándo y sobre qué **dentro de la misma transacción** que modifica el permiso (R3). Una falla de auditoría no debe dejar un permiso cambiado sin registro. Esto aplica también al cambio de modo `open`/`enforced`.

## 4. Separación de funciones y acceso excepcional

La administración de plataforma no trae lectura clínica. La dirección no hereda autoría clínica. Confirmar que los valores de un laboratorio coinciden con su informe no se presenta como validación clínica ni como firma; el circuito se describe en [`study-membership.md`](../decisions/study-membership.md) (M17). Ninguna cuenta compartida se usa para atribuir acciones clínicas.

El acceso de emergencia requiere procedimiento aprobado antes de habilitarlo: motivo, persona, alcance mínimo, duración, registro y revisión posterior independiente. Hasta que existan procedimiento y prueba, no se presume una vía de emergencia segura.

## 5. Evidencia y cambio controlado

El responsable de Seguridad mantiene la versión aprobada de esta política, el registro de accesos y las excepciones. Cada cambio de capacidades o alcance pasa por PR, prueba de aislamiento entre organizaciones y estudios, revisión independiente y aprobación nominal antes de producción (R8). Las pruebas del repositorio son evidencia de código; no sustituyen verificar el entorno real.

Referencias de diseño: [guía EMA sobre sistemas informatizados en ensayos clínicos, anexo 3](https://www.ema.europa.eu/en/documents/regulatory-procedural-guideline/guideline-computerised-systems-and-electronic-data-clinical-trials_en.pdf) y [`REGULATORY-BASELINE.md`](./REGULATORY-BASELINE.md). Calidad y Legales determinan la aplicabilidad concreta.

## Sin verificar

- Modo `open`/`enforced`, fecha límite y cobertura de funciones/membresías **por organización en producción**. El marco registra la función como implementada y probada en entorno de prueba, sin activación confirmada.
- Identidades y permisos reales de Clerk, MFA, caducidad de sesiones y plazo efectivo entre una baja y el bloqueo de una sesión activa.
- Revisión periódica de usuarios y accesos privilegiados, aprobadores designados y registro histórico exportable. No consta la revisión prevista para 2026-09-30.
- Cobertura completa de rutas y consultas hijas por capacidad y estudio en el despliegue vigente.
- Cobertura transaccional de auditoría para **todas** las altas, cambios y bajas de permisos; el marco registra una brecha general de auditoría fuera de transacción (C1).
- Acceso real a Neon, Vercel, Blob y otros proveedores; cuentas técnicas, privilegios, rotación y acuerdos operativos.
- Procedimiento y prueba de acceso de emergencia; responsables nominales de Seguridad y Calidad.
