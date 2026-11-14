/**
 * La ruta de un dato que no validó, para escribirla en un registro operativo.
 *
 * zod arma la ruta con lo que encontró en el valor, no con lo que declara el esquema: en un
 * `z.record` (la confianza por laboratorio, por medicación y por condición del perfil) la
 * clave es un dato clínico y aparece en la ruta tal cual. Por eso la ruta se recorre junto
 * con el esquema y solo se copian los nombres de campo que el esquema declara y los índices.
 * Una clave que es dato se escribe «*»; lo que el esquema no declara, o una forma de esquema
 * que esta función no conoce, se escribe «?».
 */

interface SchemaDef {
  type: string
  innerType?: SchemaNode
  in?: SchemaNode
  out?: SchemaNode
  shape?: Record<string, SchemaNode>
  element?: SchemaNode
  valueType?: SchemaNode
  options?: SchemaNode[]
}

/** Lo que esta función necesita de un esquema de zod 4: su definición. */
export interface SchemaNode {
  _zod: { def: unknown }
}

const ROOT = '(raíz)'
const WRAPPERS = new Set(['optional', 'default', 'prefault', 'nullable', 'nonoptional', 'readonly', 'catch'])
const MAX_WRAPPERS = 16

const defOf = (node: SchemaNode): SchemaDef => node._zod.def as SchemaDef

/** Saca los envoltorios (opcional, valor por defecto, transformación) hasta la forma que tiene campos. */
function unwrap(node: SchemaNode): SchemaNode {
  let current = node
  for (let depth = 0; depth < MAX_WRAPPERS; depth += 1) {
    const def = defOf(current)
    if (WRAPPERS.has(def.type) && def.innerType) current = def.innerType
    // `.transform()` valida y después transforma; `z.preprocess()` transforma y después valida.
    else if (def.type === 'pipe' && def.in && def.out) current = defOf(def.in).type === 'transform' ? def.out : def.in
    else return current
  }
  return current
}

type Step = { text: string; next: SchemaNode | null }

/** Un paso de la ruta sobre un nodo del esquema, o `null` si el esquema no declara ese paso. */
function declaredStep(node: SchemaNode, segment: PropertyKey): Step | null {
  const base = unwrap(node)
  const def = defOf(base)
  if (def.type === 'object' && typeof segment === 'string' && def.shape && Object.hasOwn(def.shape, segment)) {
    return { text: `.${segment}`, next: def.shape[segment] ?? null }
  }
  if (def.type === 'array' && typeof segment === 'number' && def.element) return { text: `[${segment}]`, next: def.element }
  if (def.type === 'record' && def.valueType) return { text: '.*', next: def.valueType }
  if (def.type === 'union' && def.options) {
    for (const option of def.options) {
      const step = declaredStep(option, segment)
      if (step) return step
    }
  }
  return null
}

export function safeIssuePath(schema: SchemaNode, path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return ROOT
  let node: SchemaNode | null = schema
  let text = ''
  for (const segment of path) {
    // Un índice no es un dato; cualquier otra cosa que el esquema no declare se tapa.
    const step: Step = (node && declaredStep(node, segment)) ?? { text: typeof segment === 'number' ? `[${segment}]` : '.?', next: null }
    text += step.text
    node = step.next
  }
  return text.startsWith('.') ? text.slice(1) : text
}
