// Pruebas de las reglas de negocio (sin servidor HTTP).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrirDb } from '../src/db.ts'
import { crearUsuario, iniciarSesion, usuarioDeToken, verificarClave, hashClave } from '../src/auth.ts'
import { ErrorNegocio, SLA_HORAS, asignar, calcularVencimiento, cambiarEstado, comentar, comentarios, crearTicket, listarTickets, metricas, puedeCambiar } from '../src/tickets.ts'

function escenario() {
  const db = abrirDb()
  const agente = crearUsuario(db, { nombre: 'Agente', correo: 'agente@x.com', clave: 'clave-agente', rol: 'agente' })
  const ana = crearUsuario(db, { nombre: 'Ana', correo: 'ana@x.com', clave: 'clave-ana', rol: 'usuario' })
  const beto = crearUsuario(db, { nombre: 'Beto', correo: 'beto@x.com', clave: 'clave-beto', rol: 'usuario' })
  return { db, agente, ana, beto }
}
const nuevo = { titulo: 'Impresora no imprime', descripcion: 'La impresora del piso 2 no responde.', categoria: 'hardware', prioridad: 'alta' }

test('las contraseñas se guardan con hash y sal, y se verifican', () => {
  const h = hashClave('secreta')
  assert.notEqual(h, 'secreta')
  assert.notEqual(hashClave('secreta'), h, 'cada hash usa una sal distinta')
  assert.ok(verificarClave('secreta', h))
  assert.ok(!verificarClave('otra', h))
})

test('iniciar sesión devuelve un token válido; con clave errónea, nada', () => {
  const { db } = escenario()
  assert.equal(iniciarSesion(db, 'ana@x.com', 'mala'), null)
  const s = iniciarSesion(db, 'ANA@x.com', 'clave-ana')
  assert.ok(s)
  assert.equal(usuarioDeToken(db, s.token)?.correo, 'ana@x.com')
})

test('el vencimiento depende de la prioridad (SLA)', () => {
  const desde = new Date('2026-01-01T08:00:00Z')
  assert.equal(calcularVencimiento('alta', desde), new Date(desde.getTime() + SLA_HORAS.alta * 3600_000).toISOString())
  assert.equal(calcularVencimiento('baja', desde), '2026-01-04T08:00:00.000Z')
})

test('valida los datos del ticket', () => {
  const { db, ana } = escenario()
  assert.throws(() => crearTicket(db, ana, { ...nuevo, titulo: 'x' }), ErrorNegocio)
  assert.throws(() => crearTicket(db, ana, { ...nuevo, prioridad: 'urgentísima' }), /Prioridad inválida/)
  assert.throws(() => crearTicket(db, ana, { ...nuevo, descripcion: 'corta' }), /al menos 10/)
})

test('un usuario solo ve sus tickets; el agente ve todos', () => {
  const { db, agente, ana, beto } = escenario()
  crearTicket(db, ana, nuevo)
  crearTicket(db, beto, { ...nuevo, titulo: 'Sin internet en la sala' })
  assert.equal(listarTickets(db, ana).length, 1)
  assert.equal(listarTickets(db, beto).length, 1)
  assert.equal(listarTickets(db, agente).length, 2)
})

test('los estados siguen un flujo permitido', () => {
  assert.ok(puedeCambiar('abierto', 'en_progreso'))
  assert.ok(!puedeCambiar('cerrado', 'resuelto'))
  const { db, agente, ana } = escenario()
  const t = crearTicket(db, ana, nuevo)
  assert.throws(() => cambiarEstado(db, agente, t.id, 'cerrado'), (e: ErrorNegocio) => e.estado === 409)
  assert.equal(cambiarEstado(db, agente, t.id, 'resuelto').estado, 'resuelto')
  assert.ok(cambiarEstado(db, agente, t.id, 'cerrado').resuelto, 'conserva la fecha de resolución al cerrar')
})

test('el solicitante solo puede cerrar o reabrir', () => {
  const { db, agente, ana } = escenario()
  const t = crearTicket(db, ana, nuevo)
  assert.throws(() => cambiarEstado(db, ana, t.id, 'en_progreso'), (e: ErrorNegocio) => e.estado === 403)
  cambiarEstado(db, agente, t.id, 'resuelto')
  assert.equal(cambiarEstado(db, ana, t.id, 'cerrado').estado, 'cerrado')
  assert.equal(cambiarEstado(db, ana, t.id, 'abierto').estado, 'abierto')
})

test('solo se asigna a agentes, y solo lo hace el equipo', () => {
  const { db, agente, ana, beto } = escenario()
  const t = crearTicket(db, ana, nuevo)
  assert.throws(() => asignar(db, ana, t.id, agente.id), (e: ErrorNegocio) => e.estado === 403)
  assert.throws(() => asignar(db, agente, t.id, beto.id), /agente o admin/)
  assert.equal(asignar(db, agente, t.id, agente.id).asignado_id, agente.id)
})

test('las notas internas no las ve el usuario', () => {
  const { db, agente, ana } = escenario()
  const t = crearTicket(db, ana, nuevo)
  comentar(db, agente, t.id, 'Pedí repuesto al proveedor', true)
  comentar(db, agente, t.id, 'Estamos revisando tu impresora')
  comentar(db, ana, t.id, 'Gracias', true) // un usuario no puede crear notas internas
  assert.equal(comentarios(db, agente, t.id).length, 3)
  assert.deepEqual(
    comentarios(db, ana, t.id).map((c) => c.texto),
    ['Estamos revisando tu impresora', 'Gracias'],
  )
})

test('un usuario no puede ver ni comentar tickets ajenos', () => {
  const { db, ana, beto } = escenario()
  const t = crearTicket(db, ana, nuevo)
  assert.throws(() => comentar(db, beto, t.id, 'hola'), (e: ErrorNegocio) => e.estado === 404)
})

test('detecta tickets vencidos y calcula métricas de SLA', () => {
  const { db, agente, ana } = escenario()
  const hace = (h: number) => new Date(Date.now() - h * 3600_000)
  const viejo = crearTicket(db, ana, nuevo, hace(10)) // alta: vence a las 4 h → vencido
  crearTicket(db, ana, { ...nuevo, titulo: 'Mouse roto en caja', prioridad: 'baja' }, hace(1))
  const rapido = crearTicket(db, ana, { ...nuevo, titulo: 'Cambio de contraseña', prioridad: 'media' })
  cambiarEstado(db, agente, rapido.id, 'resuelto')
  assert.deepEqual(listarTickets(db, agente, { vencidos: true }).map((t) => t.id), [viejo.id])
  const m = metricas(db)
  assert.equal(m.vencidos, 1)
  assert.equal(m.resueltos, 1)
  assert.equal(m.porcentajeDentroSla, 100)
  assert.equal(m.abiertosPorPrioridad.alta, 1)
})
