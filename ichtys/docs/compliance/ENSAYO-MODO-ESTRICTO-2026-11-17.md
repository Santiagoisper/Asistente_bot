# Ensayo del modo estricto, función por función (tarea 27)

**Fecha:** 17/11/2026, entre las 18:10 y las 18:20 (hora Argentina) · **Entorno:** `pruebas`, organización `OS-E2E-SINTETICA`, estudio ficticio `E2E-FICT-002` · **Quién:** Claude, sesión de chat, con la sesión de Santiago en el navegador integrado · **Estado:** registro de un ensayo, sin revisión de Calidad.

## Resultado

En modo estricto, cada una de las nueve funciones dejó hacer exactamente lo que dice `FUNCTION_CAPABILITIES` (`packages/auth/functions.ts`) y nada más, sobre una base real. No apareció ninguna diferencia con la tabla. Al terminar, la organización volvió a modo `open` con el mismo plazo (13/01/2027), sin funciones y sin membresías, como estaba antes.

## Cómo se hizo

1. Se pasó la organización a `enforced` por la ruta de la pantalla (`PUT /api/org/team/mode`).
2. Para cada función, la única persona de la organización se asignó esa función sola. Si la función no tiene alcance total, se sumó además al estudio: para eso tuvo un momento la función de Operaciones, porque quien no administra el estudio no puede darse acceso (lo pide M11 y la ruta lo cumplió: sin Operaciones respondió 404). Antes de probar, se quitó Operaciones.
3. Se pidió cada acción con un cuerpo vacío. Si la persona puede, la ruta pasa el permiso y rechaza el cuerpo (400); si no puede, corta antes (403, o 404 cuando no entra al estudio). Así no se escribió ningún dato clínico.
4. Se quitó la función y la membresía, y se volvió a `open`.

## Lo que respondió cada función

✓ = pasó el permiso (la ruta respondió 400 o 200) · ✗ = rechazada (403 o 404).

| Función | Ver sujetos | Alta de sujeto | Leer evoluciones | Escribir evolución | Confirmar laboratorio | Subir documento | Agenda | Crear estudio |
|---|---|---|---|---|---|---|---|---|
| Ninguna | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Investigador/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Study Coordinator | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| Asistente de laboratorio | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Asistente regulatorio | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |
| Asistente de CRF | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Dirección de Operaciones | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| Dirección de Investigación | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Monitor (con membresía que vence) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Administración de la plataforma | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Además:

- Las funciones de equipo (investigador/a y asistentes) **sin** membresía al estudio respondieron 404 en todo lo del estudio: el alcance por estudio rige. Con membresía, lo de la tabla.
- Escribir una evolución solo pasó con Investigador/a. Ninguna dirección ni la administración lo heredó.
- «Ver sujetos» pide datos clínicos: el monitor, que solo lee el estudio, quedó afuera, como dice la tabla.

## Lo que este ensayo no cubre

- **Una sola persona, administradora de la organización en Clerk.** Por M14 conserva siempre la administración: la pantalla de equipo y los ajustes de la organización respondieron igual con cualquier función, y no se pudo ver qué le pasa a alguien que no administra. Hace falta una segunda cuenta en la organización de prueba.
- **No se miró la pantalla** de cada función: se probaron las rutas. Que los botones se escondan o se apaguen según la función no está visto.
- **Funciones combinadas** (por ejemplo, investigador/a y asistente de laboratorio a la vez): no se probaron.
- **Lo que el monitor sí puede ver** (el estudio sin datos clínicos) no se probó; solo lo que no puede.
- **Gestionar el CRF y dar acceso a otros** no tienen una acción en la lista.
- **Las bajas en caliente:** cuánto tarda en cortarse una sesión abierta después de quitar una función.
- **Producción:** el modo estricto no está encendido en ninguna organización.

Quedaron en el registro de auditoría de la base de prueba los cambios de modo, de funciones y de membresías del ensayo.
