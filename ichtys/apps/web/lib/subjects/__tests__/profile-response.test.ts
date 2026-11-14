import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePatientProfile } from '@ichtys/clinical'
import { profileForResponse } from '../profile-response'

/**
 * D24: `retiredFacts` guarda lo que se retiró del perfil por haber entrado desde una evolución
 * registrada en el sujeto equivocado. Son datos clínicos **de otra persona**: se conservan,
 * cifrados, pero no viajan a la pantalla. Hay una sola función de salida, y un guardián.
 */
const EVO = '11111111-1111-4111-8111-111111111111'
const profile = parsePatientProfile({
  version: 1,
  demographics: { ageYears: 58 },
  labs: [{ name: 'HbA1c', value: 7.9, unit: '%' }],
  medications: [{ name: 'Metformina' }],
  conditions: ['Diabetes tipo 2'],
  retiredFacts: [
    { evolutionId: EVO, retiredAt: '2026-11-14T20:00:00.000Z', retiredBy: 'user_md', labs: [{ name: 'Ferritina', value: 480 }], medications: [{ name: 'Atorvastatina' }], conditions: ['Hipotiroidismo'], ageYears: 61 },
  ],
})

describe('profileForResponse', () => {
  it('lo retirado no viaja: ni los datos ni quién los retiró', () => {
    const text = JSON.stringify(profileForResponse(profile))
    for (const leaked of ['retiredFacts', 'Ferritina', 'Atorvastatina', 'Hipotiroidismo', 'user_md', '61']) expect(text).not.toContain(leaked)
  })

  it('deja saber por qué evoluciones ya se revisó el perfil, y cuándo: alcanza para apagar el aviso', () => {
    expect(profileForResponse(profile).retiredFrom).toEqual([{ evolutionId: EVO, retiredAt: '2026-11-14T20:00:00.000Z' }])
  })

  it('el resto del perfil sale igual', () => {
    const { retiredFrom: _retiredFrom, ...rest } = profileForResponse(profile)
    const { retiredFacts: _retiredFacts, ...expected } = profile
    expect(rest).toEqual(expected)
  })

  it('sin nada retirado no agrega la clave', () => {
    const plain = parsePatientProfile({ version: 1, labs: [{ name: 'HbA1c', value: 7.9 }] })
    expect(profileForResponse(plain)).not.toHaveProperty('retiredFrom')
    expect(profileForResponse(plain)).toEqual(plain)
  })
})

/**
 * Guardián. Una ruta que responde con el perfil lo pasa por `profileForResponse`. Se mira lo que
 * va dentro de cada `Response.json(…)`: ahí no puede aparecer la propiedad abreviada `profile`.
 * Lo que no ve: un perfil devuelto con otro nombre de variable, o armado fuera de la llamada.
 */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : routeFiles(path)
    return name === 'route.ts' ? [path] : []
  })
}
const API = join(__dirname, '..', '..', '..', 'app', 'api')
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const BARE_PROFILE = /[{,]\s*profile\s*(?=[,}])/

/** El texto de los argumentos de cada `Response.json(`, hasta el paréntesis que lo cierra. */
function responseBodies(source: string): string[] {
  const bodies: string[] = []
  const opener = 'Response.json('
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    let depth = 1
    let end = at + opener.length
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth += 1
      else if (source[end] === ')') depth -= 1
      end += 1
    }
    bodies.push(source.slice(at + opener.length, end - 1))
  }
  return bodies
}
const leaksProfile = (source: string) => responseBodies(withoutComments(source)).some((body) => BARE_PROFILE.test(body))

describe('guardián — ninguna ruta responde con el perfil sin pasar por profileForResponse', () => {
  const files = routeFiles(API)

  it('recorre las rutas de la aplicación', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('ninguna devuelve `profile` tal cual', () => {
    const offenders = files.filter((file) => leaksProfile(readFileSync(file, 'utf8'))).map((file) => relative(API, file))
    expect(offenders).toEqual([])
  })

  it('las que responden con el perfil usan la función de salida', () => {
    const using = files.filter((file) => /profile:\s*profileForResponse\(/.test(readFileSync(file, 'utf8'))).map((file) => relative(API, file))
    // Perfil, elegibilidad, aceptar y descartar una propuesta, confirmar y descartar laboratorios.
    expect(using.length).toBeGreaterThanOrEqual(6)
  })

  it('el guardián reconoce las formas que tiene que frenar, y no las que no', () => {
    expect(leaksProfile('return Response.json({ subjectCode: subject.subjectCode, profile })')).toBe(true)
    expect(leaksProfile('return Response.json({\n  profile,\n  assessments: [] })')).toBe(true)
    expect(leaksProfile('return Response.json({ items: list.map((x) => ({ id: x.id, profile })) }, { status: 200 })')).toBe(true)
    expect(leaksProfile('return Response.json({ profile: profileForResponse(profile) })')).toBe(false)
    // Leer el perfil o pasárselo a un servicio no es responder con él.
    expect(leaksProfile('const { profile, unreadable } = await loadPatientProfileState(scope)')).toBe(false)
    expect(leaksProfile('await evaluateAndPersistScreening({ orgId, profile, spec })')).toBe(false)
    expect(leaksProfile('// return Response.json({ profile })')).toBe(false)
  })
})
