import { abrirDb } from './db.ts'
import { crearApp } from './app.ts'
import { sembrar } from './seed.ts'

const puerto = Number(process.env.PORT || 3000)
const db = abrirDb(process.env.DB_FILE || 'mesa.db')
if (process.env.SEMBRAR !== '0') sembrar(db)

crearApp(db).listen(puerto, () => {
  console.log(`Mesa de ayuda en http://localhost:${puerto}`)
})
