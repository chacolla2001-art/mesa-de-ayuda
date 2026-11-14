// Pruebas de la API HTTP de punta a punta (servidor real en un puerto libre).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { abrirDb } from '../src/db.ts'
import { crearApp } from '../src/app.ts'
import { sembrar, CUENTAS_DEMO } from '../src/seed.ts'

let servidor: Server
let base = ''

before(async () => {
  const db = abrirDb()
  sembrar(db)
  servidor = crearApp(db).listen(0)
  await new Promise((r) => servidor.once('listening', r))
  const dir = servidor.address()
  base = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`
})
after(() => servidor.close())

async function pedir(ruta: string, opciones: { method?: string; body?: unknown; token?: string } = {}) {
  const r = await fetch(base + ruta, {
    method: opciones.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}) },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  })
  return { estado: r.status, json: r.status === 204 ? null : await r.json() }
}
async function entrar(rol: 'admin' | 'agente' | 'usuario') {
  const c = CUENTAS_DEMO.find((x) => x.rol === rol)!
  const r = await pedir('/api/sesion', { method: 'POST', body: { correo: c.correo, clave: c.clave } })
  return r.json.token as string
}

test('sin sesión responde 401', async () => {
  assert.equal((await pedir('/api/tickets')).estado, 401)
})

test('credenciales incorrectas responden 401', async () => {
  assert.equal((await pedir('/api/sesion', { method: 'POST', body: { correo: 'admin@demo.local', clave: 'x' } })).estado, 401)
})

test('flujo completo: crear, asignar, resolver y cerrar', async () => {
  const usuaria = await entrar('usuario')
  const agente = await entrar('agente')
  const creado = await pedir('/api/tickets', {
    method: 'POST',
    token: usuaria,
    body: { titulo: 'No abre el correo', descripcion: 'Outlook se cierra al abrirlo desde esta mañana.', categoria: 'software', prioridad: 'media' },
  })
  assert.equal(creado.estado, 201)
  const id = creado.json.id
  const yoAgente = await pedir('/api/yo', { token: agente })
  assert.equal((await pedir(`/api/tickets/${id}/asignado`, { method: 'PATCH', token: agente, body: { agenteId: yoAgente.json.id } })).estado, 200)
  assert.equal((await pedir(`/api/tickets/${id}/estado`, { method: 'PATCH', token: agente, body: { estado: 'resuelto' } })).json.estado, 'resuelto')
  assert.equal((await pedir(`/api/tickets/${id}/estado`, { method: 'PATCH', token: usuaria, body: { estado: 'cerrado' } })).json.estado, 'cerrado')
  const detalle = await pedir(`/api/tickets/${id}`, { token: agente })
  assert.ok(detalle.json.historial.length >= 3)
})

test('un usuario no puede ver métricas ni asignar', async () => {
  const usuaria = await entrar('usuario')
  assert.equal((await pedir('/api/metricas', { token: usuaria })).estado, 403)
  assert.equal((await pedir('/api/tickets/1/asignado', { method: 'PATCH', token: usuaria, body: { agenteId: 1 } })).estado, 403)
})

test('el equipo ve las métricas', async () => {
  const admin = await entrar('admin')
  const m = await pedir('/api/metricas', { token: admin })
  assert.equal(m.estado, 200)
  assert.ok('porcentajeDentroSla' in m.json)
})

test('id inválido y ruta inexistente', async () => {
  const admin = await entrar('admin')
  assert.equal((await pedir('/api/tickets/abc', { token: admin })).estado, 400)
  assert.equal((await pedir('/api/no-existe', { token: admin })).estado, 404)
})

test('cerrar sesión invalida el token', async () => {
  const t = await entrar('agente')
  assert.equal((await pedir('/api/sesion', { method: 'DELETE', token: t })).estado, 204)
  assert.equal((await pedir('/api/yo', { token: t })).estado, 401)
})
