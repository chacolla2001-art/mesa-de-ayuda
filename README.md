# 🛟 Mesa de ayuda (Help Desk)

Sistema de tickets de soporte técnico: los usuarios reportan problemas, el equipo de soporte los asigna, cambia su estado y responde, y la jefatura ve métricas de cumplimiento del **SLA** (tiempo máximo de resolución según la prioridad).

*Help desk ticketing system with SLA tracking, role-based access, internal notes, audit history and metrics. REST API + web UI.*

## Qué resuelve
En muchas empresas los pedidos de soporte llegan por WhatsApp o correo y se pierden. Este sistema centraliza los pedidos, ordena por prioridad, avisa cuáles están **vencidos** y mide si el equipo cumple los tiempos acordados.

## Funciones
- **Roles:** usuario (reporta y sigue sus tickets), agente y admin (atienden, asignan y ven métricas).
- **SLA por prioridad:** alta 4 h, media 24 h, baja 72 h. Se marcan los tickets vencidos.
- **Flujo de estados controlado:** abierto → en progreso → en espera → resuelto → cerrado (y reabrir). Las transiciones inválidas responden `409`.
- **Comentarios y notas internas** que el usuario no ve.
- **Historial de auditoría:** quién cambió qué y cuándo.
- **Métricas:** abiertos por prioridad, vencidos, % resuelto dentro del SLA y horas promedio de resolución.
- **Seguridad:** contraseñas con `scrypt` y sal, sesiones con token y vencimiento, validación de entradas y errores sin filtrar detalles internos.

## Tecnología
Node.js 24+ con TypeScript (ejecución directa con *type stripping*), Express 5, SQLite (`node:sqlite`, sin dependencias nativas), HTML/CSS/JS sin frameworks, pruebas con `node:test` y CI con GitHub Actions.

## Cómo correrlo
```bash
npm install
npm start          # http://localhost:3000 (crea mesa.db y datos de demostración)
npm test           # 18 pruebas: reglas de negocio y API de punta a punta
```
Cuentas de demostración: `admin@demo.local / demo-admin-123`, `agente@demo.local / demo-agente-123`, `usuaria@demo.local / demo-usuaria-123`.

## API
| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| POST | `/api/sesion` | todos | Inicia sesión (`{correo, clave}`) y devuelve un token |
| DELETE | `/api/sesion` | con sesión | Cierra la sesión |
| GET | `/api/tickets?estado=&prioridad=&q=&vencidos=1` | con sesión | Lista (el usuario solo ve los suyos) |
| POST | `/api/tickets` | con sesión | Crea un ticket |
| GET | `/api/tickets/:id` | con sesión | Detalle, comentarios e historial |
| PATCH | `/api/tickets/:id/estado` | con sesión | Cambia el estado según el flujo |
| PATCH | `/api/tickets/:id/asignado` | equipo | Asigna a un agente |
| POST | `/api/tickets/:id/comentarios` | con sesión | Comenta (el equipo puede dejar notas internas) |
| GET | `/api/metricas` | equipo | Métricas de SLA |

## Estructura
```
src/db.ts        esquema SQLite
src/auth.ts      contraseñas y sesiones
src/tickets.ts   reglas de negocio (SLA, estados, permisos, métricas)
src/app.ts       rutas HTTP y manejo de errores
public/          interfaz web
test/            pruebas
```

## Decisiones de diseño
- Las reglas viven en `tickets.ts`, separadas de HTTP, para probarlas sin servidor.
- La app recibe la base de datos por parámetro: las pruebas usan una base en memoria.
- SQLite nativo de Node evita compilar dependencias; para producción se cambiaría a PostgreSQL.

## Mejoras posibles
Notificaciones por correo al vencer el SLA, adjuntos, paginación y despliegue con PostgreSQL.

---
Licencia MIT.
