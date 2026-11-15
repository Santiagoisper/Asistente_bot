# @ichtys/integrations

Lado OS del contrato de integración del Clinical Research OS con sus sistemas
satélite (Queries, Viáticos, Operación). Solo lectura.

- `signOsToken` / `verifyOsToken` — JWT EdDSA (Ed25519) de vida corta. El OS
  firma con la clave privada; cada satélite verifica con la pública.
- `moduleSummarySchema` — forma de `GET {baseUrl}/api/os/summary`.
- `fetchModuleSummary` — cliente con tiempo límite, tope de tamaño, validación
  y caché de respuestas correctas.

## Variables de entorno (solo en el OS)

| Variable | Uso |
|---|---|
| `OS_QUERIES_URL`, `OS_VIATICOS_URL`, `OS_OPERACION_URL` | URL base de cada satélite. Sin valor: `not_configured`. Debe ser `https://` salvo `localhost`/`127.0.0.1`. |
| `OS_SIGNING_PRIVATE_KEY` | Clave privada Ed25519 en PEM (PKCS#8). Admite `\n` escapados. |

Generar el par de claves:

```bash
openssl genpkey -algorithm ed25519 -out os-signing.pem
openssl pkey -in os-signing.pem -pubout -out os-signing.pub.pem
```

La pública se entrega a cada satélite. La privada no sale del OS.

## Reglas del contrato

- El satélite responde `ModuleSummary` y nada más: sin nombres ni documentos
  de pacientes; se admiten códigos de sujeto y de protocolo.
- Montos en USD (`unit: "usd"`).
- Reclamos del token: `iss = "clinical-research-os"`, `aud` = módulo,
  `sub` = usuario de Clerk, `org` = organización, `exp - iat ≤ 60 s`.

## Contrato de conector (sistemas de destino)

`connector.ts` — qué puede hacer un sistema de destino (historia clínica, eCRF,
grabador) y qué se puede afirmar de una entrega. El núcleo no conoce a ningún
sistema en particular: un conector declara capacidades y `describeDelivery`
decide el texto que se muestra.

- Capacidades: `resolve_context`, `fetch_document`, `deliver_proposal`,
  `check_delivery`, `open_record`, `export`.
- Cuatro estados que no se confunden: propuesta → revisada → enviada →
  registrada.
- "Registrado en el destino" solo existe si el destino lo confirmó **y** el
  conector declara `check_delivery`. Sin eso se dice "enviado".
- Un conector con `simulated: true` siempre se nombra como "(simulador)".
- `NO_DESTINATION` — centro sin sistema de destino: solo `export`. Es el único
  conector que existe hoy; no hay ninguna integración real con otro sistema.

Desde un componente cliente se importa `@ichtys/integrations/connector`, que no
arrastra el firmado de tokens.

## Contrato de entrega y destino simulado

`delivery.ts` — qué se le manda a un sistema de destino y qué contesta. **Es una
propuesta:** qué campos recibe el destino real y cómo confirma todavía no se
conoce. Solo para el servidor.

- `deliveryFingerprint(content)` — huella SHA-256 del contenido en forma
  canónica: claves ordenadas, saltos de línea unificados, Unicode compuesto
  (NFC). El mismo contenido da siempre la misma huella. Si la forma canónica
  cambia, las huellas ya guardadas dejan de coincidir.
- **La forma canónica acepta solo JSON plano:** texto, números finitos,
  booleanos, `null`, arreglos y objetos sin clase. Con cualquier otra cosa
  (`Date`, `Map`, `Set`, una instancia de clase, bytes, `NaN`, infinito,
  `bigint`, una función, un símbolo, un lugar sin valor en un arreglo, dos claves
  que quedan iguales después de normalizar, un objeto que se contiene a sí
  mismo) lanza `NonCanonicalContentError` y no hay huella. No convierte nada en
  silencio: un `Date` convertido quedaría en `{}`, y dos fechas distintas
  tendrían la misma huella. **Las fechas las pasa quien llama, ya como texto ISO
  8601.** El error dice el motivo (`reason`), qué encontró (`found`) y dónde
  (`path`); el mensaje no repite el contenido ni sus claves.
- `buildDeliveryEnvelope` — el sobre: registro y versión, huella, quién revisó
  (identificador de cuenta, nunca un nombre), cuándo, y solo códigos de estudio y
  de sujeto. Sin una persona que revisó no hay sobre; con un contenido que no es
  JSON plano, tampoco.
- **Qué datos lleva el sobre:** ni nombres ni documentos, pero sí el contenido
  (`content`), que es el informe o la evolución: dato de salud de una persona
  identificada por código. Es dato **seudonimizado, no anónimo**, y así hay que
  tratarlo el día que el sobre salga hacia un destino real.
- La huella lleva delante la versión de la forma canónica (`h1:…`), para que una
  huella guardada diga cómo se calculó.
- La clave de idempotencia es origen (organización y entorno) + registro + versión: entregar dos veces no registra
  dos veces. **Una versión no se edita nunca:** si el registro se corrige, sube
  la versión. La misma clave con otra huella es siempre un error (`conflict`),
  nunca un reenvío.
- `toDeliveryRecord` — «registrada» solo si el conector declara que puede
  comprobar (`check_delivery`) y el destino confirmó **la misma huella** que se
  envió.
- `createSimulatedDestination()` — destino en memoria para ejercitar el circuito.
  No hay ningún sistema real detrás, no guarda el contenido (solo clave y huella)
  y se pierde al reiniciar. Siempre se nombra «(simulador)».

Lo que no existe todavía: guardar las entregas en la base, la pantalla, y
cualquier conector a un sistema real.
