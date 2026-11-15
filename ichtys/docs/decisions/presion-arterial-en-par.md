# La presión arterial del perfil es un par

**Estado: construido en un PR que espera el sí de Santiago (14/11/2026). Cambia qué se guarda en el perfil.**

## El defecto

Al aceptar lo que una evolución aporta al perfil, la sistólica y la diastólica se tomaban por separado: «el número nuevo, o si no el anterior». Si una evolución traía solo la sistólica, el perfil quedaba con esa sistólica y la diastólica de otra evolución, y la etiqueta seguía mostrando el par viejo. Ese par nadie lo midió. Lo señaló Architect en el #175.

Cuándo pasa: el lector por reglas lee «132/84» o «132 sobre 84» y da los dos números. Medio par puede venir del modelo, o de un dictado que dice solo «sistólica 150». No se midió cuántas veces pasa.

## Opciones

1. **El par entra solo si viene completo; medio par no se guarda y no pisa nada.** El perfil conserva el último par completo. Se pierde el dato suelto («sistólica 150»), que sigue en el texto de la evolución.
2. **Medio par reemplaza al par anterior**, dejando el otro número vacío. El perfil refleja lo último dicho, pero pierde un par completo y medido a cambio de medio.
3. **Dejarlo como está.**

## Lo construido: la opción 1

`packages/clinical/blood-pressure.ts`, `mergedBloodPressure`, usada por los dos lugares que suman una evolución al perfil. Además la etiqueta guardada sale de los números guardados. Un perfil que ya tenía medio par guardado no se toca: ni se inventa ni se borra.

Por qué la 1: un dato que falta deja un criterio «a revisar»; un par armado con números de dos días da un verde o un rojo sobre algo que no existió.

## Lo que no hace

- No corrige perfiles ya guardados con un par mezclado. No se puede saber cuáles son: el perfil no guarda de qué evolución vino cada número.
- No guarda el origen ni la fecha de la presión. Es lo mismo que falta para la edad (hallazgo del #175) y pide cambiar el esquema del perfil.

## Lo que decide Santiago

Si entra la opción 1, o prefiere la 2.
