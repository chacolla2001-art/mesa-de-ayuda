// API REST de la mesa de ayuda (Express 5). Se crea con una base de datos inyectada para poder probarla aislada.
import express, { type NextFunction, type Request, type Response } from 'express'
import { fileURLToPath } from 'node:url'
import type { Db } from './db.ts'
import { cerrarSesion, iniciarSesion, usuarioDeToken, type Usuario } from './auth.ts'
import { ErrorNegocio, asignar, cambiarEstado, comentar, comentarios, crearTicket, historial, listarTickets, metricas, obtenerTicket, puedeVer, type Estado } from './tickets.ts'

type ReqAuth = Request & { usuario?: Usuario; token?: string }

export function crearApp(db: Db) {
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))))

  const autenticar = (req: ReqAuth, _res: Response, next: NextFunction) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const usuario = usuarioDeToken(db, token)
    if (!usuario) return next(new ErrorNegocio('Inicia sesión.', 401))
    req.usuario = usuario
    req.token = token
    next()
  }
  const soloEquipo = (req: ReqAuth, _res: Response, next: NextFunction) =>
    req.usuario?.rol === 'usuario' ? next(new ErrorNegocio('Solo para el equipo de soporte.', 403)) : next()
  const idDe = (req: Request) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new ErrorNegocio('Id inválido.')
    return id
  }

  app.get('/api/salud', (_req, res) => {
    res.json({ ok: true })
  })

  app.post('/api/sesion', (req, res) => {
    const r = iniciarSesion(db, req.body?.correo, req.body?.clave)
    if (!r) throw new ErrorNegocio('Correo o contraseña incorrectos.', 401)
    res.json(r)
  })
  app.delete('/api/sesion', autenticar, (req: ReqAuth, res) => {
    cerrarSesion(db, req.token!)
    res.status(204).end()
  })
  app.get('/api/yo', autenticar, (req: ReqAuth, res) => {
    res.json(req.usuario)
  })

  app.get('/api/tickets', autenticar, (req: ReqAuth, res) => {
    const { estado, prioridad, q, vencidos } = req.query as Record<string, string | undefined>
    res.json(listarTickets(db, req.usuario!, { estado, prioridad, q, vencidos: vencidos === '1' || vencidos === 'true' }))
  })
  app.post('/api/tickets', autenticar, (req: ReqAuth, res) => {
    res.status(201).json(crearTicket(db, req.usuario!, req.body ?? {}))
  })
  app.get('/api/tickets/:id', autenticar, (req: ReqAuth, res) => {
    const t = obtenerTicket(db, idDe(req))
    if (!t || !puedeVer(req.usuario!, t)) throw new ErrorNegocio('Ticket no encontrado.', 404)
    res.json({ ...t, comentarios: comentarios(db, req.usuario!, t.id), historial: req.usuario!.rol === 'usuario' ? undefined : historial(db, t.id) })
  })
  app.patch('/api/tickets/:id/estado', autenticar, (req: ReqAuth, res) => {
    res.json(cambiarEstado(db, req.usuario!, idDe(req), req.body?.estado as Estado))
  })
  app.patch('/api/tickets/:id/asignado', autenticar, soloEquipo, (req: ReqAuth, res) => {
    res.json(asignar(db, req.usuario!, idDe(req), Number(req.body?.agenteId)))
  })
  app.post('/api/tickets/:id/comentarios', autenticar, (req: ReqAuth, res) => {
    res.status(201).json(comentar(db, req.usuario!, idDe(req), req.body?.texto, Boolean(req.body?.interno)))
  })
  app.get('/api/metricas', autenticar, soloEquipo, (_req, res) => {
    res.json(metricas(db))
  })

  app.use('/api', (_req, _res, next) => next(new ErrorNegocio('Ruta no encontrada.', 404)))
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErrorNegocio) return res.status(err.estado).json({ error: err.message })
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido.' })
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  })
  return app
}
