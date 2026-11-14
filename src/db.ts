// Base de datos SQLite (módulo node:sqlite, sin dependencias externas).
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function abrirDb(archivo = ':memory:'): Db {
  const db = new DatabaseSync(archivo)
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      correo TEXT NOT NULL UNIQUE,
      clave_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('usuario', 'agente', 'admin')),
      creado TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sesiones (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expira TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      categoria TEXT NOT NULL CHECK (categoria IN ('hardware', 'software', 'red', 'accesos', 'otro')),
      prioridad TEXT NOT NULL CHECK (prioridad IN ('alta', 'media', 'baja')),
      estado TEXT NOT NULL CHECK (estado IN ('abierto', 'en_progreso', 'en_espera', 'resuelto', 'cerrado')) DEFAULT 'abierto',
      solicitante_id INTEGER NOT NULL REFERENCES usuarios(id),
      asignado_id INTEGER REFERENCES usuarios(id),
      creado TEXT NOT NULL,
      vence TEXT NOT NULL,
      resuelto TEXT
    );
    CREATE TABLE IF NOT EXISTS comentarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      autor_id INTEGER NOT NULL REFERENCES usuarios(id),
      texto TEXT NOT NULL,
      interno INTEGER NOT NULL DEFAULT 0,
      creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      evento TEXT NOT NULL,
      creado TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);
    CREATE INDEX IF NOT EXISTS idx_tickets_asignado ON tickets(asignado_id);
  `)
  return db
}
