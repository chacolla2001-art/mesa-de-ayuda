// Datos de demostración: 3 usuarios (uno por rol) y algunos tickets. Solo se cargan si la base está vacía.
import { abrirDb, type Db } from './db.ts'
import { crearUsuario } from './auth.ts'
import { asignar, cambiarEstado, comentar, crearTicket } from './tickets.ts'

export const CUENTAS_DEMO = [
  { nombre: 'Ana Admin', correo: 'admin@demo.local', clave: 'demo-admin-123', rol: 'admin' },
  { nombre: 'Luis Agente', correo: 'agente@demo.local', clave: 'demo-agente-123', rol: 'agente' },
  { nombre: 'María Usuaria', correo: 'usuaria@demo.local', clave: 'demo-usuaria-123', rol: 'usuario' },
] as const

export function sembrar(db: Db): boolean {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get() as { n: number }).n
  if (n > 0) return false
  const [admin, agente, usuaria] = CUENTAS_DEMO.map((c) => crearUsuario(db, { ...c }))
  const hace = (h: number) => new Date(Date.now() - h * 3600_000)
  const t1 = crearTicket(db, usuaria, { titulo: 'No puedo conectarme a la VPN', descripcion: 'Desde ayer la VPN rechaza mi usuario al conectar desde casa.', categoria: 'red', prioridad: 'alta' }, hace(6))
  const t2 = crearTicket(db, usuaria, { titulo: 'Instalar Office en equipo nuevo', descripcion: 'Me entregaron una laptop nueva y necesito Office instalado.', categoria: 'software', prioridad: 'media' }, hace(30))
  crearTicket(db, usuaria, { titulo: 'Solicitud de acceso a carpeta de Finanzas', descripcion: 'Necesito permisos de lectura en la carpeta compartida de Finanzas.', categoria: 'accesos', prioridad: 'baja' }, hace(2))
  asignar(db, admin, t1.id, agente.id)
  cambiarEstado(db, agente, t1.id, 'en_progreso')
  comentar(db, agente, t1.id, 'Revisando el registro del servidor VPN.', true)
  asignar(db, admin, t2.id, agente.id)
  cambiarEstado(db, agente, t2.id, 'resuelto')
  return true
}

// Ejecutado directamente: `npm run seed`.
if (import.meta.main) {
  const db = abrirDb(process.env.DB_FILE || 'mesa.db')
  console.log(sembrar(db) ? 'Datos de demostración cargados.' : 'La base ya tenía datos.')
}
