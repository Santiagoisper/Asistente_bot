# Consulta dictada: del audio al borrador de evolución

**Estado:** decidido el 2026-11-12 por mandato de Santiago («necesito hacer realidad el módulo para grabar audio»). Primera versión a construir. Base: [`REGULATORY-BASELINE.md`](../compliance/REGULATORY-BASELINE.md), R5, R6, R9, R11.

## Qué hace la primera versión

En la pantalla del sujeto, el médico graba su dictado (o sube un audio), el navegador lo transcribe, Alphi arma un borrador de evolución ordenado por bloques, el médico lo corrige y lo guarda. Al guardar entra al circuito que ya existe: evolución cifrada → propuesta de datos para el perfil → una persona acepta o descarta → elegibilidad.

```
grabar o subir audio → transcribir en el navegador → borrador por bloques
  → revisar y corregir → guardar evolución (ruta existente) → propuesta de perfil (existente)
```

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| D1 | **La transcripción corre en el equipo del médico**, en el navegador, en un Web Worker: el audio no va a ningún proveedor externo. (Hasta el 12/11 20:50 esta decisión decía además «y no se guarda»; eso lo cambió D14) | R5 (minimización) y la regla de Santiago: el audio no va a proveedores externos. No agrega un proveedor que reciba datos (R9) |
| D2 | Modelo abierto: Whisper `small` multilingüe en ONNX, con `@huggingface/transformers`; WebGPU si el equipo lo tiene, WASM si no. Revisión del modelo fijada por hash (`36050c4…`, en `apps/web/lib/dictation/protocol.ts`) | Es el modelo con el que se hizo la prueba del 12/11 (mismo tamaño, otra implementación). Los pesos se descargan una vez y quedan en caché del navegador: lo que baja es el modelo, no sube ningún dato |
| D3 | Antes de transcribir se recortan los silencios largos | Hallazgo de la prueba del 12/11: sin recorte se pierden valores dictados con pausas |
| D4 | El resultado es un **borrador**. No se guarda nada hasta que el médico toca «Guardar evolución». La pantalla dice que el texto fue generado a partir de un dictado | R6 |
| D5 | Correcciones dictadas («corrijo», «perdón», «mejor dicho»): se detectan, se aplican al borrador y se muestran los dos valores para que el médico decida | Definido el 12/11 (15:17): toda corrección detectada se muestra con el valor original y el corregido |
| D6 | Bloques de la plantilla: lo que el médico no dictó queda marcado **«No mencionado»** y la pantalla lo señala antes de guardar. No bloquea el guardado en la primera versión: avisa | La plantilla del 12/11 pedía bloquear la confirmación; se empieza por el aviso para no trabar el uso y se mide |
| D7 | El registro de auditoría de la evolución suma, sin contenido: origen `dictation`, duración, modelo y revisión, cantidad de correcciones detectadas y de bloques sin mencionar | R3 y R6 (modelo y versión por resultado) |
| D8 | Consentimiento: antes de grabar, la pantalla recuerda que se graba el dictado del profesional y que grabar a un paciente exige su consentimiento. El profesional lo acepta una vez por sesión | El consentimiento vigente cubre a Santiago en consultas simuladas, no a pacientes |
| D9 | Sin firma y sin envío a la HCE | Van con el conector y la firma con clave. (El audio enlazado a la nota quedó resuelto en D14) |
| D10 | **Bucles del transcriptor.** Si la transcripción trae la misma frase de tres palabras o más, tres o más veces seguidas, se deja una sola y la pantalla lo avisa en rojo con la frase y la cantidad: en ese tramo puede faltar lo dicho. Nunca se quita en silencio. Queda la cantidad en el registro | Pasó con voz real el 12/11: en una pasada el modelo repitió doce veces una frase que la persona no dijo. Es texto inventado dentro de un registro clínico |
| D11 | **Texto corrido.** Si la persona nombró menos de tres apartados, o dijo más de la mitad antes del primero, el borrador respeta su texto en el orden en que lo dijo y **no agrega renglones «No mencionado»**: los apartados que no se oyeron se listan aparte, como control. El modo por bloques queda para quien nombra los apartados | El dictado real del 12/11 fue narrativo: la plantilla dejaba casi todo en «Apertura» y agregaba nueve renglones que nadie dijo. Un borrador no le pone palabras a quien dicta |
| D13 | **La guía para dictar** se muestra al lado del panel y sale de las mismas constantes con las que se arma el borrador (`packages/clinical/dictation/guide.ts`). Una prueba dicta la guía entera y comprueba que cada frase cae en su apartado | Pedido de Santiago (12/11 20:52): el médico lee y lo dictado queda ordenado. Si la guía y el reconocedor se escribieran por separado, se desalinearían |
| D14 | **La grabación se guarda**, en almacenamiento privado: en la base de la aplicación, cifrada con la misma clave que los datos clínicos, atada a la evolución. Sale del equipo **recién cuando la persona guarda la evolución**; si descarta el borrador, no se guarda nada. Una por evolución; la adjunta solo quien escribió la evolución. Se conserva **30 días (valor provisorio)** y después se borra el contenido; queda la constancia (quién, cuándo, duración, huella SHA-256, fecha de borrado). Escucharla exige acceso a los datos clínicos del sujeto y cada escucha queda registrada. Tope de 4 MB por grabación (se graba a 24 kbps: veinte minutos entran). Nunca en el repositorio de código | Decidido por Santiago el 12/11 a las 20:50 («sí, claro, guardalo con almacenamiento privado»; «después vemos por cuántos días»). El aviso que lee quien dicta dice lo mismo que hace el sistema. **Sin resolver:** el plazo definitivo; si la grabación es documento fuente y qué conservación le corresponde entonces; el consentimiento del paciente cuando se graba una consulta real |
| D15 | **El audio se corta por las pausas y cada tramo se transcribe por separado.** Un tramo es lo dicho entre dos pausas de 0,7 s o más; ninguno pasa de 28 s. Lo que el modelo devuelve para cada tramo se cierra con punto: las pausas de quien dicta separan las frases. Reemplaza las ventanas fijas de 30 s con solape y el recorte de silencios (D3) | Con voz real (12/11, 75 s leyendo la guía) se perdieron unos veinte segundos: el modelo dio por terminada la primera ventana después de la primera frase, y el empalme entre ventanas duplicó una frase. Con un tramo por pedido no hay «lo que sigue» que se pueda perder ni palabras partidas. **Costo:** más pedidos al modelo por dictado; sin medir en equipos sin WebGPU |
| D16 | **Agregar lo que faltó.** Con un dictado ya en el cuadro, grabar de nuevo suma: cada apartado nombrado va al suyo (uno que decía «No mencionado» pasa a tener lo dictado), y nada de lo escrito se pisa. **Límite:** se guarda una grabación por evolución, la de la primera toma; lo agregado después queda como texto y la pantalla lo dice | Pedido de Santiago (12/11 22:50). Varias grabaciones por evolución exige cambiar la tabla; queda para después |
| D12 | **El botón de grabar** muestra tres estados (reposo, grabando, transcribiendo), el tiempo y el nivel del micrófono, avisa si en cuatro segundos no entró voz y corta a los 20 minutos. El aviso de consentimiento aparece en el primer toque y su botón empieza a grabar | Pedido de Santiago (12/11 20:46). Sin el nivel a la vista, quien dicta no sabe si el micrófono lo está tomando hasta que termina |

## Piezas

Lógica pura, con pruebas (`packages/clinical/dictation/`):

- `trim-silence.ts` — `trimSilence(samples: Float32Array, sampleRate: number, opts?): { samples: Float32Array; removedSec: number }`. Recorta tramos de silencio de más de 0,8 s dejando 0,3 s.
- `corrections.ts` — `applySpokenCorrections(text: string): { text: string; corrections: Array<{ original: string; corrected: string; marker: string }> }`.
- `template.ts` — `DICTATION_BLOCKS` (apertura + bloques, con sus encabezados dictables y sinónimos) y `splitIntoBlocks(text): Array<{ block: BlockId; text: string | null }>`; `null` = no mencionado.
- `draft.ts` — `composeEvolutionDraft(blocks): string` y `dictationFacts(...)` para el registro.

Navegador (`apps/web/lib/dictation/`, `apps/web/components/subjects/`):

- `audio.ts` — decodifica el archivo o la grabación y lo lleva a 16 kHz mono (`OfflineAudioContext`).
- `transcriber.worker.ts` — carga el modelo, informa el avance de la descarga, transcribe por tramos de 30 s en español.
- `dictation-panel.tsx` — grabar (`MediaRecorder`), subir audio, avance, borrador editable por bloques, correcciones detectadas, bloques sin mencionar, «Usar como evolución» (llena el cuadro existente; guardar sigue siendo el botón de siempre).

Servidor: la ruta de evoluciones acepta un campo opcional `source` (`{ kind: 'dictation', durationSec, model, modelRevision, corrections, missingBlocks }`), validado con zod y volcado al registro. Sin columna nueva.

## Bloques (provisorios)

Apertura (sujeto, visita, fecha) · motivo · evolución desde la última visita · medicación actual y adherencia · eventos adversos · signos vitales · examen físico · laboratorio y estudios · evaluación · criterios o desvíos · plan · próxima visita. **Alinear con la plantilla del informe de investigación del 12/11 (apertura + 14 bloques y cinco fórmulas para el dato ausente) antes de fijarlos.**

## Qué queda sin verificar al terminar la primera versión

- Exactitud de la transcripción con habla real: hay que medirla con el dictado de prueba de 5 a 10 minutos que Santiago graba con datos inventados.
- Tiempo de transcripción en un equipo sin WebGPU.
- Safari y móviles.
- Que la descarga del modelo sea aceptable en la red del centro (unos cientos de MB la primera vez). Alternativa prevista: servir los pesos desde el almacenamiento propio.

## Orden de trabajo

1. Lógica pura con pruebas.
2. Campo `source` en la ruta de evoluciones y registro.
3. Audio, worker y panel. Prueba con un archivo de voz sintética (ningún audio real en el repositorio).
4. Evidencia en un despliegue de vista previa propio de la rama. **No tocar la rama `pruebas` hasta que Santiago avise que terminó la demostración del 13/11.**
