# Clinical Research OS — Subproyecto 1: cáscara e Inicio

**Fecha:** 2026-11-10
**Estado:** borrador para revisión de Santiago
**Rama:** `spec/os-cascara-inicio`
**Referencia visual:** captura "Panel clínico de investigación" entregada por Santiago el 2026-11-10.

---

## 1. Propósito

Convertir la app de Alphi (`ichtys/apps/web`) en la pantalla única de operación de un sitio de
investigación clínica: un menú lateral con todos los módulos y una pantalla de Inicio que muestra el
estado del día. Es el primero de ocho subproyectos; los otros siete se enchufan en esta cáscara.

### Lo que dijo Santiago

- El producto es para su empresa; el primer hito es un piloto en un sitio propio.
- La interfaz tiene que parecerse mucho a la captura.
- Unir Alphi con `cinme-query-automation` (Queries), `proyecto_cordoba` (Viáticos) y `korozov`
  (Operación) como **OS federado**: cada sistema sigue vivo y expone datos por API.
- La grabación de consultas arranca con consultas simuladas (subproyecto 6).
- Los montos se muestran siempre en dólares estadounidenses (USD).
- Usuarios: médicos y, sobre todo, asistentes de investigación.
- Ante un error: hasta tres vueltas de corrección; si no cierra, se frena y se escala.

### Supuestos de este documento

- Una sola organización en el piloto. No se quita el aislamiento por organización que Alphi ya tiene.
- Nombre visible del producto: "Clinical Research OS", definido en una sola constante para poder
  cambiarlo sin tocar pantallas.
- Zona horaria de presentación: `America/Argentina/Buenos_Aires`.

---

## 2. Alcance

### Dentro

1. Cáscara nueva: menú lateral, barra superior, buscador y campana.
2. Pantalla de Inicio con los widgets de la captura, cada uno con datos reales o con un estado
   honesto de "todavía no disponible".
3. Página de Laboratorios (lista de revisiones pendientes).
4. Contrato de integración con los tres sistemas satélite, lado OS completo.
5. Página de Integraciones con el estado de cada satélite.
6. Una migración: marca no sensible de "revisión de laboratorio pendiente".
7. Interruptor `ALPHI_OS` para activar la cáscara sin romper la app actual.

### Fuera (y en qué subproyecto entra)

| Tema | Subproyecto |
|---|---|
| Agenda, visitas agendadas, Jornada de hoy con datos | 2 |
| Cabina de visita real y lector de cronograma | 3 |
| Endpoint de resumen en `cinme-query-automation` | 4 |
| Endpoints de resumen en `proyecto_cordoba` y `korozov` | 5 |
| Grabación, transcripción y borrador de evolución | 6 |
| Métricas, comparaciones "vs. ayer", búsqueda en satélites | 7 |
| Validación del piloto (OQ ampliado, PQ, VSR) | 8 |

Regla de esta etapa: **no se muestra un número que el sistema no pueda respaldar**. Las variaciones
"vs. ayer" de la captura necesitan una foto diaria de los contadores; se agregan en el subproyecto 7.
Tampoco se dibuja la onda de audio ni un borrador de evolución de ejemplo.

---

## 3. Diseño

### 3.1 Cáscara

Se reemplaza el encabezado azul actual por la disposición de la captura, detrás del interruptor.

- **Menú lateral** (216 px, fondo blanco, ítem activo con fondo `alphi-teallit`):
  Inicio, Agenda, Visitas, Protocolos, Laboratorios, Queries, Operación, Viáticos, Integraciones,
  Métricas. Debajo, un grupo "Configuración" con las pantallas que hoy existen y no figuran en la
  captura: Librería, Consumo, Ajustes.
- **Barra superior** (fondo blanco): nombre del producto con la marca de Alphi, buscador, campana,
  selector de organización y menú de usuario de Clerk.
- **Por debajo de 1024 px** el menú pasa a un cajón que se abre con un botón. Objetivos táctiles de
  44 px como mínimo, igual que la cabina.
- Íconos: se suma `lucide-react` (la app hoy no tiene librería de íconos; Córdoba ya usa Lucide).
- Paleta: los tokens `alphi-*` existentes de `tailwind.config.ts`. No se agregan colores sueltos.
- Pie de página: se conserva la leyenda "Verificar siempre con el protocolo original".

Destino de cada ítem en esta etapa:

| Ítem | Ruta | Comportamiento en el subproyecto 1 |
|---|---|---|
| Inicio | `/inicio` | Pantalla nueva. `/dashboard` redirige acá con el interruptor encendido |
| Protocolos | `/studies` | Pantalla existente, sin cambios |
| Laboratorios | `/laboratorios` | Pantalla nueva (3.3) |
| Integraciones | `/integraciones` | Pantalla nueva (3.5) |
| Queries, Operación, Viáticos | `/queries`, `/operacion`, `/viaticos` | Estado del satélite y botón "Abrir sistema" si está configurado |
| Agenda, Visitas, Métricas | `/agenda`, `/visitas`, `/metricas` | Página que dice qué va a hacer el módulo y en qué etapa llega |

Los ítems sin módulo llevan una etiqueta discreta "Próximamente" en el menú.

**Buscador (Ctrl/⌘ K).** Busca en lo que Alphi ya tiene: estudios (código y título) y sujetos (código),
siempre dentro de la organización activa. Un endpoint `GET /api/search?q=` con tope de 10 resultados
por tipo y mínimo de 2 caracteres. Visitas, laboratorios y queries se suman cuando existan.

**Campana.** Muestra la cantidad de ítems de "Atención prioritaria" y lleva a esa sección. No hay
sistema de notificaciones en esta etapa.

### 3.2 Inicio

Componentes de servidor, uno por widget. Cada widget obtiene sus datos por separado y tiene su propio
límite de error: si uno falla, muestra "No se pudo cargar" y los demás siguen.

| Widget | Fuente en el subproyecto 1 | Estado si no hay datos |
|---|---|---|
| Saludo | Nombre de Clerk; "Buen día / Buenas tardes / Buenas noches" según la hora local | — |
| Visitas de hoy | Ninguna todavía | "Sin agenda" con enlace a la explicación de Agenda |
| Labs pendientes | Conteo de la marca nueva (3.4) | 0 |
| Queries abiertas | Adaptador de Queries (3.5) | "Sin conectar" |
| Protocolos activos | `studies` con `status = 'active'` | 0 |
| Jornada de hoy | Ninguna todavía | Estado vacío que explica que llega con la Agenda |
| Atención prioritaria | Ver abajo | "Nada pendiente" |
| Protocol Intelligence | Chat RAG existente | Si no hay estudios con documentos listos, invita a cargar uno |
| Consulta asistida | Ninguna todavía | Tarjeta "Próximamente", sin onda ni texto de ejemplo |
| Laboratorios | Pendientes (marca nueva); confirmados y rechazados de los últimos 30 días desde `audit_logs` (`lab.confirm`, `lab.reject`) | Ceros |
| Flujo del site | Adaptador de Operación | "Sin conectar" |
| Viáticos | Adaptador de Viáticos; montos en USD | "Sin conectar" |

**Atención prioritaria** junta, ordenado por severidad y antigüedad, lo que hoy se puede saber:

1. Sujetos con revisión de laboratorio pendiente (código de sujeto y estudio).
2. Versiones de documento con ingesta en `error`.
3. Specs en `draft` cuya extracción quedó parcial y esperan revisión.
4. Alertas que devuelvan los satélites conectados.

Cada ítem enlaza a la pantalla donde se resuelve. Tope de 8 ítems, con "ver todos".

**Protocol Intelligence** reutiliza el endpoint `/api/chat/stream` y los componentes de
`components/chat` (respuesta, insignia de confianza, lista de evidencia). El widget agrega un selector
de estudio, crea la conversación en ese estudio y muestra la respuesta con sus citas. "Ver protocolo"
abre los documentos del estudio; "Abrir conversación" continúa en la pantalla de chat. No se crea
una segunda vía de respuesta: mismas barreras, mismo registro de auditoría, mismo consumo medido.

### 3.3 Laboratorios

Lista de sujetos con revisión pendiente: estudio, código de sujeto, desde cuándo espera y enlace a la
ficha del sujeto, donde ya existen "confirmar" y "rechazar". Sin valores de laboratorio en la lista.

### 3.4 Cambio de datos

Hoy la revisión pendiente vive dentro de `patient_profiles.profile_encrypted`. Contarla exigiría
descifrar todos los perfiles en cada carga del Inicio, y eso no es aceptable.

- Migración `0011`: en `patient_profiles`, `lab_review_pending boolean not null default false` y
  `lab_review_pending_since timestamptz null`, más un índice parcial por organización donde la marca
  es verdadera. Son datos operativos, no clínicos.
- `lib/subjects/lab-review-service.ts` enciende la marca al proponer una revisión y la apaga al
  confirmar o rechazar, en la misma escritura que actualiza el perfil.
- Script `scripts/backfill-lab-review-pending.ts`: recorre los perfiles por organización, descifra y
  fija la marca. Se corre una vez, a mano, y es idempotente.
- Las migraciones no se aplican solas en el despliegue. Orden obligatorio: aplicar `0011` en Neon,
  correr el backfill, y recién entonces encender `ALPHI_OS` en producción.
- El issue #76 (orden temporal del journal de Drizzle) se resuelve antes de agregar `0011`.

### 3.5 Contrato de integración

Paquete nuevo `@ichtys/integrations`. Un adaptador por satélite, los tres con la misma forma.

**Pedido.** `GET {baseUrl}/api/os/summary` con `Authorization: Bearer <token>`.

**Token.** JWT firmado por el OS con EdDSA (Ed25519). Los satélites solo tienen la clave pública: pueden
verificar, no emitir. Reclamos: `iss = "clinical-research-os"`, `aud` = módulo, `sub` = id de usuario de
Clerk, `org` = id de la organización, `exp` a 60 segundos como máximo.

**Respuesta**, validada con zod y con topes de tamaño:

```ts
type ModuleSummary = {
  module: 'queries' | 'viaticos' | 'operacion'
  generatedAt: string                      // ISO 8601
  counters: Array<{
    key: string                            // estable, p. ej. "open_queries"
    label: string
    value: number
    unit: 'count' | 'percent' | 'usd'
  }>
  alerts: Array<{
    id: string
    severity: 'high' | 'medium' | 'low'
    title: string
    detail: string
    href: string                           // enlace directo dentro del satélite
  }>
  openHref: string
}
```

**Estado que ve el OS:** `ok`, `not_configured`, `unreachable`, `unauthorized` o `invalid_response`.
Tiempo límite de 2,5 segundos por satélite; las respuestas `ok` se guardan 60 segundos; los errores
no se guardan.

**Reglas del contrato**

- Solo lectura. El OS no escribe en ningún satélite.
- Sin datos identificatorios: se admiten códigos de sujeto y de protocolo, nunca nombres ni documentos.
- Montos en USD. Un satélite que guarde otra moneda convierte antes de responder y declara la fecha
  del tipo de cambio en `detail`.
- Configuración por variables de entorno: `OS_QUERIES_URL`, `OS_VIATICOS_URL`, `OS_OPERACION_URL` y
  `OS_SIGNING_PRIVATE_KEY`. Sin URL, el estado es `not_configured`.

En esta etapa se entrega el lado OS (firma, cliente, validación, caché, estados) probado contra un
servidor de prueba. Los endpoints reales de cada satélite son los subproyectos 4 y 5, de modo que en
producción los tres aparecen como "Sin conectar" hasta entonces.

**Página de Integraciones.** Una fila por satélite: estado, última respuesta correcta y botón para
reintentar. Visible solo para administradores de la organización.

### 3.6 Interruptor

`isOsEnabled()` en `lib/flags.ts`, con la misma lógica que la cabina: encendido en vista previa y
desarrollo; en producción solo si `ALPHI_OS=on`. Apagado, la app se ve y se comporta como hoy.

---

## 4. Seguridad y aislamiento

- Toda consulta nueva filtra por `organizationId` con las ayudas de `@ichtys/auth`. El buscador y los
  datos del Inicio entran a la prueba de fuga entre organizaciones.
- Ningún widget del Inicio descifra PHI. El Inicio muestra códigos de sujeto, nunca contenido clínico.
- La clave privada de firma vive solo en variables de entorno del OS. No se registra el token ni el
  cuerpo crudo de una respuesta inválida.
- Las rutas nuevas quedan detrás del middleware de Clerk existente.
- El `organization_id` sale siempre del token de Clerk, nunca del pedido (regla 2 de `docs/CLAUDE.md`).
- El buscador y la lista de Laboratorios devuelven códigos, no contenido clínico. Abrir la ficha del
  sujeto sigue registrando `subject.view` en `audit_logs`, como hoy.

### Entrega en tres PR

`docs/CLAUDE.md` pide un PR por capa y no mezclar cambios de schema con lógica:

1. **Datos:** migración `0011`, marca en el servicio de laboratorio, backfill y sus pruebas.
2. **Integración:** paquete `@ichtys/integrations` con firma, cliente, validación y pruebas.
3. **Interfaz:** interruptor, cáscara, Inicio, Laboratorios, Integraciones, buscador y pruebas.

---

## 5. Pruebas

| Qué | Cómo |
|---|---|
| Funciones de datos del Inicio y del buscador | Vitest, con el patrón de pruebas de `apps/web` |
| Fuga entre organizaciones | Casos nuevos en `tests/leakage` |
| Marca de laboratorio | Proponer la enciende; confirmar y rechazar la apagan; backfill idempotente |
| Cliente de integración | Servidor de prueba local: respuesta válida, tiempo agotado, 401, cuerpo inválido, cuerpo demasiado grande |
| Firma del token | Verificación con la clave pública; rechazo por `aud` equivocado y por vencimiento |
| Cáscara y widgets | happy-dom: ítem activo, estados "Sin conectar", "Sin agenda" y de error |
| Interruptor | Apagado conserva el layout actual; encendido redirige `/dashboard` a `/inicio` |

Compuerta antes de pedir revisión: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:leakage`.
Si una prueba falla, hasta tres vueltas de corrección; a la tercera sin verde, se frena y se informa.

---

## 6. Criterios de aceptación

1. Con `ALPHI_OS` encendido, la app muestra el menú lateral y el Inicio con la disposición de la
   captura; apagado, no cambia nada respecto de hoy.
2. "Protocolos activos" y "Labs pendientes" coinciden con una consulta directa a la base.
3. Una pregunta en Protocol Intelligence devuelve una respuesta con citas del estudio elegido y queda
   guardada como conversación.
4. Con un satélite caído o sin configurar, su tarjeta lo dice y el resto del Inicio carga.
5. Ningún widget muestra un número inventado ni una variación sin respaldo.
6. Un usuario de otra organización no ve estudios, sujetos ni conteos ajenos, tampoco por el buscador.
7. La compuerta de pruebas pasa completa.

---

## 7. Riesgos

- **Parecido con la captura.** Varios bloques quedan en estado vacío hasta los subproyectos 2 a 6. La
  disposición es la de la captura; el contenido se completa por etapas.
- **Orden de despliegue.** Encender el interruptor antes de aplicar `0011` rompe el Inicio. Mitigación:
  la verificación de entorno (`pnpm iq:check`) suma un chequeo de la columna.
- **Cambio de layout.** Afecta a todas las pantallas logueadas. Mitigación: el interruptor, y una pasada
  visual por cada ruta existente a 1280, 820 y 390 px antes de encenderlo en producción.
