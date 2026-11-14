import { describe, expect, it } from 'vitest'
import { measurementSection } from '../profile-sections'

/**
 * A qué apartado va cada medición del perfil al mostrarla. El perfil guarda peso, talla o
 * frecuencia cardíaca junto a los laboratorios; la historia clínica del centro los separa en
 * signos vitales y antropometría. Se clasifica al mostrar: los datos guardados no cambian.
 */
describe('measurementSection', () => {
  it('peso, talla, IMC y cintura son antropometría, con o sin acento y en cualquier caja', () => {
    for (const name of ['Peso', 'peso corporal', 'Talla', 'ALTURA', 'Estatura', 'IMC', 'Índice de masa corporal', 'indice de masa corporal', 'Perímetro de cintura', 'P. Cintura', 'Circunferencia de cintura']) {
      expect(measurementSection(name), name).toBe('antropometria')
    }
  })

  it('frecuencia cardíaca, frecuencia respiratoria, temperatura y saturación son signos vitales', () => {
    for (const name of ['Frecuencia cardíaca', 'frecuencia cardiaca', 'FC', 'Frecuencia respiratoria', 'FR', 'Temperatura', 'Saturación de oxígeno', 'SpO2']) {
      expect(measurementSection(name), name).toBe('vitales')
    }
  })

  it('lo demás sigue siendo laboratorio, también lo que se parece', () => {
    for (const name of ['HbA1c', 'Glucemia', 'Creatinina', 'Factor reumatoideo', 'Ferritina', 'Peso molecular', 'Colesterol total', 'Recuento de plaquetas', 'Proteína C reactiva', 'Filtrado glomerular estimado']) {
      expect(measurementSection(name), name).toBe('laboratorio')
    }
  })
})
