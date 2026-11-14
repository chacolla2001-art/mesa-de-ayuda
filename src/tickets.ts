// Reglas de negocio de los tickets: SLA por prioridad, flujo de estados permitido y métricas.
import type { Db } from './db.ts'
import type { Usuario } from './auth.ts'

export const PRIORIDADES = ['alta', 'media', 'baja'] as const
export const CATEGORIAS = ['hardware', 'software', 'red', 'accesos', 'otro'] as const
export const ESTADOS = ['abierto', 'en_progreso', 'en_espera', 'resuelto', 'cerrado'] as const
export type Prioridad = (typeof PRIORIDADES)[number]
export type Categoria = (typeof CATEGORIAS)[number]
export type Estado = (typeof ESTADOS)[number]

/** Horas para resolver según la prioridad (acuerdo de nivel de servicio). */
export const SLA_HORAS: Record<Prioridad, number> = { alta: 4, media: 24, baja: 72 }

/** Transiciones de estado permitidas. Un ticket cerrado solo se puede reabrir. */
export const TRANSICIONES: Record<Estado, Estado[]> = {
  abierto: ['en_progreso', 'en_espera', 'resuelto'],
  en_progreso: ['en_espera', 'resuelto', 'abierto'],
  en_espera: ['en_progreso', 'resuelto'],
  resuelto: ['cerrado', 'en_progreso'],
  cerrado: ['abierto'],
}

export class ErrorNegocio extends Error {
  estado: number
  constructor(mensaje: string, estado = 400) {
    super(mensaje)
    this.estado = estado
  }
}

export interface Ticket {
  id: number
  titulo: string
  descripcion: string
  categoria: Categoria
  prioridad: Prioridad
  estado: Estado
  solicitante_id: number
  asignado_id: number | null
  creado: string
  vence: string
  resuelto: string | null
}

export function calcularVencimiento(prioridad: Prioridad, desde: Date): string {
  return new Date(desde.getTime() + SLA_HORAS[prioridad] * 3600_000).toISOString()
}

export function puedeCambiar(de: Estado, a: Estado): boolean {
  return TRANSICIONES[de].includes(a)
}

const ahora = () => new Date().toISOString()
const registrar = (db: Db, ticketId: number, usuarioId: number, evento: string) =>
  db.prepare('INSERT INTO historial (ticket_id, usuario_id, evento, creado) VALUES (?, ?, ?, ?)').run(ticketId, usuarioId, evento, ahora())

export function validarNuevo(datos: Record<string, unknown>): { titulo: string; descripcion: string; categoria: Categoria; prioridad: Prioridad } {
  const titulo = String(datos.titulo ?? '').trim()
  const descripcion = String(datos.descripcion ?? '').trim()
  const categoria = String(datos.categoria ?? 'otro') as Categoria
  const prioridad = String(datos.prioridad ?? 'media') as Prioridad
  if (titulo.length < 5 || titulo.length > 120) throw new ErrorNegocio('El título debe tener entre 5 y 120 caracteres.')
  if (descripcion.length < 10) throw new ErrorNegocio('Describe el problema con al menos 10 caracteres.')
  if (!CATEGORIAS.includes(categoria)) throw new ErrorNegocio(`Categoría inválida. Opciones: ${CATEGORIAS.join(', ')}.`)
  if (!PRIORIDADES.includes(prioridad)) throw new ErrorNegocio(`Prioridad inválida. Opciones: ${PRIORIDADES.join(', ')}.`)
  return { titulo, descripcion, categoria, prioridad }
}

export function crearTicket(db: Db, usuario: Usuario, datos: Record<string, unknown>, cuando = new Date()): Ticket {
  const v = validarNuevo(datos)
  const creado = cuando.toISOString()
  const r = db
    .prepare('INSERT INTO tickets (titulo, descripcion, categoria, prioridad, solicitante_id, creado, vence) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(v.titulo, v.descripcion, v.categoria, v.prioridad, usuario.id, creado, calcularVencimiento(v.prioridad, cuando))
  const id = Number(r.lastInsertRowid)
  registrar(db, id, usuario.id, 'Ticket creado')
  return obtenerTicket(db, id)!
}

export function obtenerTicket(db: Db, id: number): Ticket | undefined {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Ticket | undefined
}

/** Un usuario común solo ve sus tickets; agentes y admin ven todos. */
export function puedeVer(usuario: Usuario, t: Ticket): boolean {
  return usuario.rol !== 'usuario' || t.solicitante_id === usuario.id
}

export function listarTickets(db: Db, usuario: Usuario, filtros: { estado?: string; prioridad?: string; q?: string; vencidos?: boolean } = {}): (Ticket & { vencido: boolean })[] {
  const condiciones: string[] = []
  const valores: (string | number)[] = []
  if (usuario.rol === 'usuario') {
    condiciones.push('solicitante_id = ?')
    valores.push(usuario.id)
  }
  if (filtros.estado) {
    condiciones.push('estado = ?')
    valores.push(filtros.estado)
  }
  if (filtros.prioridad) {
    condiciones.push('prioridad = ?')
    valores.push(filtros.prioridad)
  }
  if (filtros.q) {
    condiciones.push('(titulo LIKE ? OR descripcion LIKE ?)')
    valores.push(`%${filtros.q}%`, `%${filtros.q}%`)
  }
  const ahoraIso = ahora()
  if (filtros.vencidos) {
    condiciones.push("vence < ? AND estado NOT IN ('resuelto', 'cerrado')")
    valores.push(ahoraIso)
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
  const filas = db
    .prepare(`SELECT * FROM tickets ${where} ORDER BY CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, vence`)
    .all(...valores) as unknown as Ticket[]
  return filas.map((t) => ({ ...t, vencido: !['resuelto', 'cerrado'].includes(t.estado) && t.vence < ahoraIso }))
}

export function cambiarEstado(db: Db, usuario: Usuario, id: number, nuevo: Estado): Ticket {
  const t = obtenerTicket(db, id)
  if (!t || !puedeVer(usuario, t)) throw new ErrorNegocio('Ticket no encontrado.', 404)
  if (!ESTADOS.includes(nuevo)) throw new ErrorNegocio('Estado inválido.')
  // El solicitante solo puede cerrar o reabrir su ticket; el resto del flujo es del equipo de soporte.
  if (usuario.rol === 'usuario' && !(['cerrado', 'abierto'] as Estado[]).includes(nuevo)) {
    throw new ErrorNegocio('Solo el equipo de soporte puede cambiar a ese estado.', 403)
  }
  if (!puedeCambiar(t.estado, nuevo)) throw new ErrorNegocio(`No se puede pasar de «${t.estado}» a «${nuevo}».`, 409)
  const resuelto = nuevo === 'resuelto' ? ahora() : nuevo === 'cerrado' ? t.resuelto : null
  db.prepare('UPDATE tickets SET estado = ?, resuelto = ? WHERE id = ?').run(nuevo, resuelto, id)
  registrar(db, id, usuario.id, `Estado: ${t.estado} → ${nuevo}`)
  return obtenerTicket(db, id)!
}

export function asignar(db: Db, usuario: Usuario, id: number, agenteId: number): Ticket {
  if (usuario.rol === 'usuario') throw new ErrorNegocio('Solo el equipo de soporte puede asignar tickets.', 403)
  const t = obtenerTicket(db, id)
  if (!t) throw new ErrorNegocio('Ticket no encontrado.', 404)
  const agente = db.prepare('SELECT id, rol, nombre FROM usuarios WHERE id = ?').get(agenteId) as { id: number; rol: string; nombre: string } | undefined
  if (!agente || agente.rol === 'usuario') throw new ErrorNegocio('Solo se puede asignar a un agente o admin.')
  db.prepare('UPDATE tickets SET asignado_id = ? WHERE id = ?').run(agenteId, id)
  registrar(db, id, usuario.id, `Asignado a ${agente.nombre}`)
  return obtenerTicket(db, id)!
}

export function comentar(db: Db, usuario: Usuario, id: number, texto: string, interno = false) {
  const t = obtenerTicket(db, id)
  if (!t || !puedeVer(usuario, t)) throw new ErrorNegocio('Ticket no encontrado.', 404)
  const limpio = String(texto ?? '').trim()
  if (!limpio) throw new ErrorNegocio('El comentario está vacío.')
  // Las notas internas solo las escribe y ve el equipo de soporte.
  const esInterno = interno && usuario.rol !== 'usuario' ? 1 : 0
  const r = db
    .prepare('INSERT INTO comentarios (ticket_id, autor_id, texto, interno, creado) VALUES (?, ?, ?, ?, ?)')
    .run(id, usuario.id, limpio, esInterno, ahora())
  return { id: Number(r.lastInsertRowid), ticket_id: id, autor_id: usuario.id, texto: limpio, interno: Boolean(esInterno) }
}

export function comentarios(db: Db, usuario: Usuario, id: number) {
  const filas = db
    .prepare('SELECT c.id, c.texto, c.interno, c.creado, u.nombre AS autor FROM comentarios c JOIN usuarios u ON u.id = c.autor_id WHERE c.ticket_id = ? ORDER BY c.id')
    .all(id) as { id: number; texto: string; interno: number; creado: string; autor: string }[]
  return filas.filter((c) => usuario.rol !== 'usuario' || !c.interno).map((c) => ({ ...c, interno: Boolean(c.interno) }))
}

export function historial(db: Db, id: number) {
  return db
    .prepare('SELECT h.evento, h.creado, u.nombre AS usuario FROM historial h JOIN usuarios u ON u.id = h.usuario_id WHERE h.ticket_id = ? ORDER BY h.id')
    .all(id)
}

/** Métricas para el equipo: abiertos por prioridad, vencidos, % dentro del SLA y horas promedio de resolución. */
export function metricas(db: Db) {
  const ahoraIso = ahora()
  const porEstado = Object.fromEntries(
    (db.prepare('SELECT estado, COUNT(*) AS n FROM tickets GROUP BY estado').all() as { estado: string; n: number }[]).map((f) => [f.estado, f.n]),
  )
  const abiertosPorPrioridad = Object.fromEntries(
    (
      db.prepare("SELECT prioridad, COUNT(*) AS n FROM tickets WHERE estado NOT IN ('resuelto', 'cerrado') GROUP BY prioridad").all() as {
        prioridad: string
        n: number
      }[]
    ).map((f) => [f.prioridad, f.n]),
  )
  const vencidos = (db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE vence < ? AND estado NOT IN ('resuelto', 'cerrado')").get(ahoraIso) as { n: number }).n
  const resueltos = db.prepare('SELECT creado, vence, resuelto FROM tickets WHERE resuelto IS NOT NULL').all() as { creado: string; vence: string; resuelto: string }[]
  const dentroSla = resueltos.filter((t) => t.resuelto <= t.vence).length
  const horas = resueltos.map((t) => (Date.parse(t.resuelto) - Date.parse(t.creado)) / 3600_000)
  return {
    porEstado,
    abiertosPorPrioridad,
    vencidos,
    resueltos: resueltos.length,
    porcentajeDentroSla: resueltos.length ? Math.round((dentroSla / resueltos.length) * 100) : null,
    horasPromedioResolucion: horas.length ? Math.round((horas.reduce((a, b) => a + b, 0) / horas.length) * 10) / 10 : null,
  }
}
