// Interfaz web sin frameworks: consume la API REST.
const $ = (s) => document.querySelector(s)
let token = sessionStorage.getItem('token')
let yo = null

async function api(ruta, opciones = {}) {
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  })
  if (r.status === 204) return null
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`)
  return j
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '')
const SIGUIENTES = { abierto: ['en_progreso', 'en_espera', 'resuelto'], en_progreso: ['en_espera', 'resuelto', 'abierto'], en_espera: ['en_progreso', 'resuelto'], resuelto: ['cerrado', 'en_progreso'], cerrado: ['abierto'] }

async function entrar() {
  try {
    yo = await api('/yo')
  } catch {
    token = null
    sessionStorage.removeItem('token')
    $('#login').hidden = false
    $('#panel').hidden = true
    $('#salir').hidden = true
    $('#quien').textContent = ''
    return
  }
  $('#login').hidden = true
  $('#panel').hidden = false
  $('#salir').hidden = false
  $('#quien').textContent = `${yo.nombre} · ${yo.rol}`
  await Promise.all([cargarTickets(), cargarMetricas()])
}

async function cargarMetricas() {
  const caja = $('#metricas')
  if (yo.rol === 'usuario') return (caja.hidden = true)
  const m = await api('/metricas')
  caja.hidden = false
  caja.innerHTML = `
    <div><strong>${(m.abiertosPorPrioridad.alta || 0) + (m.abiertosPorPrioridad.media || 0) + (m.abiertosPorPrioridad.baja || 0)}</strong><span>abiertos</span></div>
    <div><strong class="${m.vencidos ? 'vencido' : ''}">${m.vencidos}</strong><span>vencidos (fuera de SLA)</span></div>
    <div><strong>${m.porcentajeDentroSla ?? '—'}${m.porcentajeDentroSla == null ? '' : '%'}</strong><span>resueltos dentro del SLA</span></div>
    <div><strong>${m.horasPromedioResolucion ?? '—'}</strong><span>horas promedio de resolución</span></div>`
}

async function cargarTickets() {
  const p = new URLSearchParams()
  if ($('#buscar').value.trim()) p.set('q', $('#buscar').value.trim())
  if ($('#f-estado').value) p.set('estado', $('#f-estado').value)
  if ($('#f-vencidos').checked) p.set('vencidos', '1')
  const lista = await api(`/tickets?${p}`)
  $('#tabla').innerHTML =
    lista
      .map(
        (t) => `<tr data-id="${t.id}">
          <td>${t.id}</td><td>${esc(t.titulo)}</td>
          <td><span class="chip p-${t.prioridad}">${t.prioridad}</span></td>
          <td>${t.estado.replace('_', ' ')}</td>
          <td class="${t.vencido ? 'vencido' : ''}">${fecha(t.vence)}${t.vencido ? ' · vencido' : ''}</td></tr>`,
      )
      .join('') || '<tr><td colspan="5">No hay tickets.</td></tr>'
}

async function verTicket(id) {
  const t = await api(`/tickets/${id}`)
  const caja = $('#detalle')
  caja.hidden = false
  const opciones = (yo.rol === 'usuario' ? SIGUIENTES[t.estado].filter((e) => ['cerrado', 'abierto'].includes(e)) : SIGUIENTES[t.estado])
    .map((e) => `<button class="secundario" data-estado="${e}">→ ${e.replace('_', ' ')}</button>`)
    .join('')
  caja.innerHTML = `
    <h2>#${t.id} · ${esc(t.titulo)}</h2>
    <p>${esc(t.descripcion)}</p>
    <p><span class="chip p-${t.prioridad}">${t.prioridad}</span> · ${t.categoria} · estado <b>${t.estado.replace('_', ' ')}</b> · vence ${fecha(t.vence)}</p>
    <div class="acciones">${opciones}</div>
    <h3>Comentarios</h3>
    ${t.comentarios.map((c) => `<div class="comentario ${c.interno ? 'interno' : ''}"><b>${esc(c.autor)}</b> ${c.interno ? '(nota interna)' : ''} · ${fecha(c.creado)}<br>${esc(c.texto)}</div>`).join('') || '<p>Sin comentarios.</p>'}
    <form id="form-comentario">
      <textarea name="texto" placeholder="Escribe un comentario" required></textarea>
      ${yo.rol !== 'usuario' ? '<label class="check"><input type="checkbox" name="interno"> Nota interna (no la ve el usuario)</label>' : ''}
      <button>Comentar</button>
    </form>
    ${t.historial ? `<details><summary>Historial</summary><ul>${t.historial.map((h) => `<li>${fecha(h.creado)} · ${esc(h.usuario)}: ${esc(h.evento)}</li>`).join('')}</ul></details>` : ''}`
  caja.querySelectorAll('[data-estado]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/tickets/${t.id}/estado`, { method: 'PATCH', body: { estado: b.dataset.estado } })
        await Promise.all([verTicket(t.id), cargarTickets(), cargarMetricas()])
      } catch (e) {
        alert(e.message)
      }
    }),
  )
  caja.querySelector('#form-comentario').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = new FormData(e.target)
    await api(`/tickets/${t.id}/comentarios`, { method: 'POST', body: { texto: f.get('texto'), interno: f.get('interno') === 'on' } })
    verTicket(t.id)
  })
  caja.scrollIntoView({ behavior: 'smooth' })
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  try {
    const r = await api('/sesion', { method: 'POST', body: { correo: f.get('correo'), clave: f.get('clave') } })
    token = r.token
    sessionStorage.setItem('token', token)
    $('#error-login').textContent = ''
    entrar()
  } catch (err) {
    $('#error-login').textContent = err.message
  }
})
$('#salir').addEventListener('click', async () => {
  await api('/sesion', { method: 'DELETE' }).catch(() => {})
  token = null
  sessionStorage.removeItem('token')
  entrar()
})
$('#form-ticket').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await api('/tickets', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })
    e.target.reset()
    $('#error-ticket').textContent = ''
    await Promise.all([cargarTickets(), cargarMetricas()])
  } catch (err) {
    $('#error-ticket').textContent = err.message
  }
})
$('#tabla').addEventListener('click', (e) => {
  const fila = e.target.closest('tr[data-id]')
  if (fila) verTicket(fila.dataset.id)
})
$('#buscar').addEventListener('input', () => cargarTickets())
$('#f-estado').addEventListener('change', () => cargarTickets())
$('#f-vencidos').addEventListener('change', () => cargarTickets())

entrar()
