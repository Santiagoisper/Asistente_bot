# Los apartados de Alphi frente a los de la historia clínica del centro

**Estado: propuesta de Claude (14/11/2026). Nada de esto cambia la plantilla del dictado todavía.**

## Por qué

Santiago, 14/11/2026: los campos que Alphi extrae «tienen que ser migrados exactamente a la hoja electrónica» de la historia clínica del centro, «como la tiene armada». Si el dictado y el perfil hablan en otros apartados, lo que Alphi entrega hay que traducirlo a mano, y esa traducción es donde un dato se pierde o cambia de lugar.

## Qué se sabe de la historia clínica del centro

Relevado el 14/11/2026 en modo lectura, sobre una historia de consultorio que Santiago dejó abierta: solo rótulos, encabezados y tipos de campo, ningún valor.

Guarda **por apartado**, no como una nota larga:

- Motivos de consulta.
- Patologías, en tres listas: abiertas, cerradas y crónicas.
- Medicamentos y procedimientos, en dos listas.
- Recetas de medicamentos y órdenes de procedimientos.
- Laboratorios, por fecha.
- Signos vitales: TA, FC, FR.
- Antropometría: peso, talla, IMC, perímetro de cintura.
- Antecedentes familiares.
- Evoluciones: cada entrada con profesional, especialidad, tipo y diagnóstico.

Cada entrada lleva su registro de auditoría.

**Sin relevar:** el formulario de una entrada nueva (campos, obligatorios, listas de opciones), la hoja de una **visita de investigación**, y si patologías, medicamentos y procedimientos salen de un catálogo o son texto libre.

## Correspondencia propuesta

| Apartado del dictado (hoy) | Dónde iría en la historia del centro | Estado |
|---|---|---|
| Apertura (qué visita es, edad) | La visita la da la agenda; la edad sale de la fecha de nacimiento | La edad no se entrega: se usa para la elegibilidad |
| Motivo de la visita | Motivos de consulta | Corresponde |
| Evolución desde la última visita | El texto de la entrada | Corresponde |
| Medicación actual y adherencia | Medicamentos | Corresponde; la adherencia no tiene campo visto |
| Eventos adversos | Sin apartado en la hoja de consultorio | **Falta ver la hoja de investigación** |
| Signos vitales | Signos vitales (TA, FC, FR) y antropometría (peso, talla, IMC, cintura) | Alphi extrae la presión; el resto, ver abajo |
| Examen físico | El texto de la entrada | Sin campo propio visto |
| Laboratorio y estudios | Laboratorios | Corresponde |
| Evaluación | Diagnóstico de la entrada | A confirmar con el formulario |
| Criterios o desvíos | Sin apartado en la hoja de consultorio | **Falta ver la hoja de investigación** |
| Plan | El texto de la entrada; recetas y órdenes si las hay | A confirmar |
| Próxima visita | Turnos | No es un dato de la entrada |
| (no existe en el dictado) | Patologías abiertas, cerradas y crónicas | Alphi guarda «condiciones» sin ese estado |
| (no existe en el dictado) | Procedimientos | Alphi no los extrae |
| (no existe en el dictado) | Antecedentes familiares | Alphi no los extrae |

## Lo que ya se hizo

- El perfil se muestra por bloques, en el orden de las pestañas del centro (PR #184).
- **Peso, talla, IMC y cintura se muestran como «Antropometría», y frecuencia cardíaca, frecuencia respiratoria, temperatura y saturación como «Signos vitales»**, aunque el perfil los guarde junto a los laboratorios. Se clasifica por el nombre y solo al mostrar (`apps/web/lib/subjects/profile-sections.ts`): lo guardado y lo que lee la elegibilidad no cambian. Los nombres son exactos a propósito: «peso molecular» sigue siendo laboratorio. Una unidad escrita al final del nombre («Peso (kg)») no lo cambia de apartado. Un nombre que no esté en la lista queda en «Laboratorios», como antes: es una imprecisión de pantalla, no una pérdida.
- El aviso de una evolución anulada y la pantalla de retiro dicen «Laboratorios y mediciones», para no llamar laboratorio a un peso que la ficha muestra como antropometría.

## Lo que se propone, sin hacer todavía

1. **Que el perfil guarde signos vitales y antropometría en su lugar**, no entre los laboratorios. Cambia el esquema del perfil: va en dos pasos, primero el lector y después quien escribe, como `retiredFacts`. No toca la base.
2. **Que el dictado tenga los apartados de la hoja de investigación**, cuando se pueda ver. Los bloques actuales son provisorios (D6 de `consulta-dictada.md`). No se cambian a ciegas: eventos adversos y criterios o desvíos no existen en la hoja de consultorio y son justamente los de investigación.
3. **Que una condición diga si es abierta, cerrada o crónica**, si el centro lo necesita para recibirla.

## Lo que tiene que mostrar o decidir Santiago

1. El formulario de «Nueva Entrada»: abrirlo sin guardar, para leer los rótulos.
2. La hoja de una visita de investigación.
3. Si patologías, medicamentos y procedimientos se eligen de un catálogo.
4. Si las condiciones tienen que llevar su estado.
