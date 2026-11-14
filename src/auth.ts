// Autenticación: contraseñas con scrypt (sal aleatoria) y tokens de sesión opacos con vencimiento.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from './db.ts'

export type Rol = 'usuario' | 'agente' | 'admin'
export interface Usuario {
  id: number
  nombre: string
  correo: string
  rol: Rol
}

const HORAS_SESION = 8

export function hashClave(clave: string): string {
  const sal = randomBytes(16).toString('hex')
  const hash = scryptSync(clave, sal, 64).toString('hex')
  return `${sal}:${hash}`
}

export function verificarClave(clave: string, guardado: string): boolean {
  const [sal, hash] = guardado.split(':')
  if (!sal || !hash) return false
  const calculado = scryptSync(clave, sal, 64)
  const esperado = Buffer.from(hash, 'hex')
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado)
}

export function crearUsuario(db: Db, datos: { nombre: string; correo: string; clave: string; rol: Rol }): Usuario {
  const r = db
    .prepare('INSERT INTO usuarios (nombre, correo, clave_hash, rol) VALUES (?, ?, ?, ?)')
    .run(datos.nombre, datos.correo.toLowerCase(), hashClave(datos.clave), datos.rol)
  return { id: Number(r.lastInsertRowid), nombre: datos.nombre, correo: datos.correo.toLowerCase(), rol: datos.rol }
}

export function iniciarSesion(db: Db, correo: string, clave: string): { token: string; usuario: Usuario } | null {
  const fila = db.prepare('SELECT id, nombre, correo, rol, clave_hash FROM usuarios WHERE correo = ?').get(String(correo).toLowerCase()) as
    | (Usuario & { clave_hash: string })
    | undefined
  if (!fila || !verificarClave(String(clave), fila.clave_hash)) return null
  const token = randomBytes(24).toString('hex')
  const expira = new Date(Date.now() + HORAS_SESION * 3600_000).toISOString()
  db.prepare('INSERT INTO sesiones (token, usuario_id, expira) VALUES (?, ?, ?)').run(token, fila.id, expira)
  const { clave_hash: _, ...usuario } = fila
  return { token, usuario }
}

export function usuarioDeToken(db: Db, token: string | undefined): Usuario | null {
  if (!token) return null
  const fila = db
    .prepare('SELECT u.id, u.nombre, u.correo, u.rol, s.expira FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?')
    .get(token) as (Usuario & { expira: string }) | undefined
  if (!fila || fila.expira < new Date().toISOString()) return null
  const { expira: _, ...usuario } = fila
  return usuario
}

export function cerrarSesion(db: Db, token: string): void {
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(token)
}
