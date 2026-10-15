const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let localActivo = null;
let productosLocal = [];
let insumosLocal = [];
let comandasActivas = [];
let miGraficoVentas = null;

const gridComandas = document.getElementById('grid-comandas');
const selectPlatoSalon = document.getElementById('select-plato-salon');
const tbodyMenu = document.getElementById('tbody-menu');
const tbodyInsumos = document.getElementById('tbody-insumos');

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    window.location.href = 'portal.html';
    return;
  }

  await cargarNegocioCocina(session.user);
  await cargarCatalogoLocal();
  await cargarInventarioInsumos();
  await cargarComandasCocina();
  await cargarEstadisticasFinancieras();
  suscribirComandasRealtime();
})();

async function cargarNegocioCocina(user) {
  // Búsqueda estricta por el ID del propietario autenticado
  let { data: neg, error } = await db
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error || !neg) {
    alert('Esta cuenta no tiene ningún restaurante asociado. Contacta al administrador o vincula tu usuario en la base de datos.');
    window.location.href = 'portal.html';
    return;
  }

  localActivo = neg;
  document.getElementById('cocina-titulo').innerText = `${neg.name} - Operaciones`;
  actualizarBotonEstadoLocal();
}

function actualizarBotonEstadoLocal() {
  const btn = document.getElementById('btn-estado-local');
  if (localActivo.is_active) {
    btn.className = 'btn-toggle activo';
    btn.innerText = '🟢 Local Abierto';
  } else {
    btn.className = 'btn-toggle pausado';
    btn.innerText = '🔴 Local Pausado';
  }
}

window.toggleEstadoLocal = async function() {
  const nuevo = !localActivo.is_active;
  const { error } = await db.from('businesses').update({ is_active: nuevo }).eq('id', localActivo.id);
  if (!error) {
    localActivo.is_active = nuevo;
    actualizarBotonEstadoLocal();
  }
};

// ==========================================
// GESTIÓN DE MENÚ Y CATÁLOGO
// ==========================================
async function cargarCatalogoLocal() {
  const { data } = await db.from('products').select('*').eq('business_id', localActivo.id).order('name', { ascending: true });
  productosLocal = data || [];
  renderizarMenuCocina(productosLocal);
  
  selectPlatoSalon.innerHTML = productosLocal.map(p => `<option value="${p.id}">${p.name} ($${parseFloat(p.price).toFixed(2)} - Stock: ${p.stock ?? 99})</option>`).join('');
}

function renderizarMenuCocina(lista) {
  if (lista.length === 0) {
    tbodyMenu.innerHTML = `<tr><td colspan="5" style="padding: 12px; color: #888; text-align: center;">No hay platos en el menú.</td></tr>`;
    return;
  }

  tbodyMenu.innerHTML = lista.map(p => `
    <tr style="border-bottom: 1px solid #222;">
      <td style="padding: 10px; font-weight: 600; color: #fff;">${p.name}</td>
      <td style="padding: 10px; color: var(--gold);">$${parseFloat(p.price).toFixed(2)}</td>
      <td style="padding: 10px;">${p.stock ?? 99} unds</td>
      <td style="padding: 10px;"><span class="badge ${p.is_available ? 'badge-on_the_way' : 'badge-pending'}">${p.is_available ? 'Disponible' : 'Pausado'}</span></td>
      <td style="padding: 10px; text-align: right;">
        <button onclick="toggleDisponibilidadPlato('${p.id}', ${p.is_available})" class="btn-secundario" style="padding: 4px 8px; font-size: 0.75rem;">${p.is_available ? 'Pausar' : 'Activar'}</button>
        <button onclick="eliminarPlatoMenu('${p.id}')" class="btn-secundario" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--red); color: #fca5a5;">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

window.filtrarMenuCocina = function() {
  const query = document.getElementById('buscador-menu').value.toLowerCase();
  const filtrados = productosLocal.filter(p => p.name.toLowerCase().includes(query));
  renderizarMenuCocina(filtrados);
};

document.getElementById('form-nuevo-plato').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('nuevo-plato-nombre').value.trim();
  const price = parseFloat(document.getElementById('nuevo-plato-precio').value);
  const stock = parseInt(document.getElementById('nuevo-plato-stock').value);

  const { error } = await db.from('products').insert([{
    business_id: localActivo.id,
    name,
    price,
    stock,
    is_available: true
  }]);

  if (!error) {
    alert('Plato agregado al menú correctamente.');
    e.target.reset();
    await cargarCatalogoLocal();
  } else {
    alert('Error al agregar plato: ' + error.message);
  }
});

window.toggleDisponibilidadPlato = async function(id, estadoActual) {
  await db.from('products').update({ is_available: !estadoActual }).eq('id', id);
  await cargarCatalogoLocal();
};

window.eliminarPlatoMenu = async function(id) {
  if (confirm('¿Seguro que deseas eliminar este plato del menú?')) {
    await db.from('products').delete().eq('id', id);
    await cargarCatalogoLocal();
  }
};

// ==========================================
// GESTIÓN DE INVENTARIO E INSUMOS
// ==========================================
async function cargarInventarioInsumos() {
  const { data } = await db.from('inventory_items').select('*').eq('business_id', localActivo.id).order('name', { ascending: true });
  insumosLocal = data || [];
  renderizarInventario(insumosLocal);
  verificarAlertasInsumos(insumosLocal);
}

function renderizarInventario(lista) {
  if (lista.length === 0) {
    tbodyInsumos.innerHTML = `<tr><td colspan="5" style="padding: 12px; color: #888; text-align: center;">No hay insumos registrados.</td></tr>`;
    return;
  }

  tbodyInsumos.innerHTML = lista.map(ins => {
    const bajoStock = parseFloat(ins.quantity) <= parseFloat(ins.min_threshold);
    return `
      <tr style="border-bottom: 1px solid #222;">
        <td style="padding: 10px; font-weight: 600; color: #fff;">${ins.name}</td>
        <td style="padding: 10px; color: ${bajoStock ? '#fca5a5' : '#fff'}; font-weight: ${bajoStock ? 'bold' : 'normal'};">${ins.quantity} ${ins.unit}</td>
        <td style="padding: 10px; color: var(--text-muted);">${ins.min_threshold} ${ins.unit}</td>
        <td style="padding: 10px;"><span class="badge" style="background: ${bajoStock ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}; color: ${bajoStock ? '#fca5a5' : '#34d399'};">${bajoStock ? '⚠️ Stock Bajo' : 'Normal'}</span></td>
        <td style="padding: 10px; text-align: right;">
          <button onclick="ajustarInsumo('${ins.id}', ${ins.quantity}, 10)" class="btn-secundario" style="padding: 4px 8px; font-size: 0.75rem;">+10</button>
          <button onclick="ajustarInsumo('${ins.id}', ${ins.quantity}, -5)" class="btn-secundario" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--red); color: #fca5a5;">-5</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.filtrarInsumosCocina = function() {
  const query = document.getElementById('buscador-insumos').value.toLowerCase();
  const filtrados = insumosLocal.filter(i => i.name.toLowerCase().includes(query));
  renderizarInventario(filtrados);
};

document.getElementById('form-nuevo-insumo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('insumo-nombre').value.trim();
  const quantity = parseFloat(document.getElementById('insumo-cantidad').value);
  const unit = document.getElementById('insumo-unidad').value.trim();
  const min_threshold = parseFloat(document.getElementById('insumo-min').value);

  const { error } = await db.from('inventory_items').insert([{
    business_id: localActivo.id,
    name,
    quantity,
    unit,
    min_threshold
  }]);

  if (!error) {
    alert('Insumo registrado con éxito.');
    e.target.reset();
    await cargarInventarioInsumos();
  } else {
    alert('Error al registrar insumo: ' + error.message);
  }
});

window.ajustarInsumo = async function(id, actual, delta) {
  const nuevaCant = Math.max(0, parseFloat(actual) + delta);
  await db.from('inventory_items').update({ quantity: nuevaCant }).eq('id', id);
  await cargarInventarioInsumos();
};

function verificarAlertasInsumos(lista) {
  const alertaBox = document.getElementById('alerta-insumos-bajos');
  const bajos = lista.filter(i => parseFloat(i.quantity) <= parseFloat(i.min_threshold));
  if (bajos.length > 0) {
    alertaBox.style.display = 'block';
    alertaBox.innerHTML = `⚠️ <strong>¡Atención!</strong> Insumos por agotarse: ${bajos.map(b => `<b>${b.name} (${b.quantity}${b.unit})</b>`).join(', ')}.`;
  } else {
    alertaBox.style.display = 'none';
  }
}

// ==========================================
// COMANDAS EN TIEMPO REAL
// ==========================================
window.cargarComandasCocina = async function() {
  const { data: ordenes, error } = await db
    .from('orders')
    .select('*')
    .eq('business_id', localActivo.id)
    .in('status', ['pending', 'cooking', 'on_the_way', 'delivered'])
    .order('created_at', { ascending: false });

  if (error) return;
  comandasActivas = ordenes || [];

  const entregadas = comandasActivas.filter(o => o.status === 'delivered');
  const bruto = entregadas.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);
  document.getElementById('corte-bruto').innerText = `$${bruto.toFixed(2)}`;
  document.getElementById('corte-neto').innerText = `$${(bruto * 0.90).toFixed(2)}`;

  const enCurso = comandasActivas.filter(o => o.status !== 'delivered');
  if (enCurso.length === 0) {
    gridComandas.innerHTML = '<p style="color:#888;">No hay comandas pendientes en cocina.</p>';
    return;
  }

  gridComandas.innerHTML = enCurso.map(ord => {
    const itemsHtml = (ord.items || []).map(i => `<div><strong>${i.quantity}x ${i.name}</strong> ($${i.price})</div>`).join('');
    
    let badgeEtaDelivery = '';
    if (ord.delivery_type === 'delivery') {
      if (!ord.driver_id) {
        badgeEtaDelivery = `<div style="background:#262626; padding:6px 10px; border-radius:6px; font-size:0.8rem; color:#fbbf24; margin-top:8px;">🛵 Buscando repartidor cercano...</div>`;
      } else if (ord.delivery_status === 'accepted') {
        const eta = ord.driver_eta_mins || 8;
        badgeEtaDelivery = `<div style="background:rgba(251,191,36,0.15); border:1px solid var(--gold); padding:6px 10px; border-radius:6px; font-size:0.8rem; color:var(--gold); margin-top:8px;">🛵 <strong>Repartidor en camino al local:</strong> Llega en ~${eta} min</div>`;
      } else if (ord.delivery_status === 'arrived_at_store') {
        badgeEtaDelivery = `<div style="background:rgba(16,185,129,0.2); border:1px solid var(--green); padding:6px 10px; border-radius:6px; font-size:0.8rem; color:#34d399; margin-top:8px;">✅ <strong>¡Repartidor esperando en puerta!</strong> Entrega la bolsa sellada.</div>`;
      } else if (ord.delivery_status === 'on_the_way') {
        badgeEtaDelivery = `<div style="background:#1f2937; padding:6px 10px; border-radius:6px; font-size:0.8rem; color:#9ca3af; margin-top:8px;">🚀 Paquete en manos del repartidor rumbo al cliente.</div>`;
      }
    }

    let btnSiguiente = '';
    if (ord.status === 'pending') {
      btnSiguiente = `<button onclick="cambiarEstadoComanda('${ord.id}', 'cooking')" class="btn-primario" style="flex:1;">👨‍🍳 Pasar a Cocinando</button>`;
    } else if (ord.status === 'cooking') {
      btnSiguiente = `<button onclick="cambiarEstadoComanda('${ord.id}', 'on_the_way')" class="btn-primario" style="flex:1; background:var(--green);">📦 Entregar a Repartidor / Listo</button>`;
    }

    return `
      <div class="card" style="border-left: 4px solid var(--gold);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong>#ORD-${ord.id.slice(0, 8)}</strong>
          <span class="badge badge-${ord.status}">${ord.status.toUpperCase()}</span>
        </div>
        <div style="font-size: 0.9rem; border-bottom: 1px dashed #333; padding-bottom: 8px; margin-bottom: 8px;">
          ${itemsHtml}
        </div>
        <div style="font-size: 0.82rem; color: #ccc;">
          <div><strong>Cliente:</strong> ${ord.customer_name} (${ord.customer_phone})</div>
          <div><strong>Modalidad:</strong> ${ord.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'}</div>
          ${ord.notes ? `<div style="color:var(--gold);"><strong>Nota:</strong> ${ord.notes}</div>` : ''}
        </div>
        ${badgeEtaDelivery}
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          ${btnSiguiente}
        </div>
      </div>
    `;
  }).join('');
};

window.cambiarEstadoComanda = async function(ordenId, nuevoEstado) {
  const payload = { status: nuevoEstado };
  if (nuevoEstado === 'on_the_way') {
    payload.delivery_status = 'on_the_way';
  }
  await db.from('orders').update(payload).eq('id', ordenId);
  await cargarComandasCocina();
};

// ==========================================
// ESTADÍSTICAS Y GRÁFICOS FINANCIEROS
// ==========================================
async function cargarEstadisticasFinancieras() {
  const { data: ordenes, error } = await db
    .from('orders')
    .select('total, subtotal_food, created_at')
    .eq('business_id', localActivo.id)
    .eq('status', 'delivered');

  if (error || !ordenes) return;

  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  
  const primerDiaSemana = new Date(ahora);
  primerDiaSemana.setDate(ahora.getDate() - ahora.getDay());
  primerDiaSemana.setHours(0, 0, 0, 0);

  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1).getTime();

  let totalDia = 0;
  let totalSemana = 0;
  let totalMes = 0;
  let totalAnio = 0;

  const diasVentas = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(ahora.getDate() - i);
    const key = d.toISOString().split('T')[0];
    diasVentas[key] = 0;
  }

  ordenes.forEach(o => {
    const monto = parseFloat(o.subtotal_food || o.total || 0);
    const fechaOrden = new Date(o.created_at);
    const tiempoOrden = fechaOrden.getTime();
    const fechaKey = o.created_at.split('T')[0];

    if (tiempoOrden >= inicioHoy) totalDia += monto;
    if (tiempoOrden >= primerDiaSemana.getTime()) totalSemana += monto;
    if (tiempoOrden >= inicioMes) totalMes += monto;
    if (tiempoOrden >= inicioAnio) totalAnio += monto;

    if (diasVentas[fechaKey] !== undefined) {
      diasVentas[fechaKey] += monto;
    }
  });

  document.getElementById('stat-dia').innerText = `$${totalDia.toFixed(2)}`;
  document.getElementById('stat-semana').innerText = `$${totalSemana.toFixed(2)}`;
  document.getElementById('stat-mes').innerText = `$${totalMes.toFixed(2)}`;
  document.getElementById('stat-anio').innerText = `$${totalAnio.toFixed(2)}`;

  const ctx = document.getElementById('chartVentas').getContext('2d');
  const labels = Object.keys(diasVentas).map(f => {
    const partes = f.split('-');
    return `${partes[2]}/${partes[1]}`;
  });
  const valores = Object.values(diasVentas);

  if (miGraficoVentas) {
    miGraficoVentas.destroy();
  }

  miGraficoVentas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Ventas USD ($)',
        data: valores,
        backgroundColor: '#fbbf24',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#222' },
          ticks: { color: '#9ca3af' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af' }
        }
      }
    }
  });
}

// VENTA EN SALÓN Y MERMA
document.getElementById('form-venta-salon').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prodId = selectPlatoSalon.value;
  const cant = parseInt(document.getElementById('cant-venta-salon').value);
  const prod = productosLocal.find(p => p.id === prodId);
  if (!prod) return;

  const nuevoStock = Math.max(0, (prod.stock ?? 50) - cant);
  await db.from('products').update({ stock: nuevoStock }).eq('id', prod.id);

  await db.from('kitchen_logs').insert([{
    business_id: localActivo.id,
    log_type: 'venta_salon',
    item_name: prod.name,
    quantity: cant,
    amount_usd: parseFloat(prod.price) * cant,
    notes: 'Venta presencial en mostrador'
  }]);

  alert(`Venta en salón registrada: ${cant}x ${prod.name}`);
  await cargarCatalogoLocal();
});

document.getElementById('form-merma').addEventListener('submit', async (e) => {
  e.preventDefault();
  const insumo = document.getElementById('merma-insumo').value.trim();
  const cant = parseFloat(document.getElementById('merma-cantidad').value);
  const motivo = document.getElementById('merma-motivo').value.trim();

  await db.from('kitchen_logs').insert([{
    business_id: localActivo.id,
    log_type: 'merma',
    item_name: insumo,
    quantity: cant,
    amount_usd: 0,
    notes: motivo
  }]);

  alert('Baja por merma registrada para auditoría.');
  e.target.reset();
});

window.solicitarCorteCaja = async function() {
  const entregadas = comandasActivas.filter(o => o.status === 'delivered');
  const bruto = entregadas.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);
  if (bruto <= 0) {
    alert('No tienes órdenes entregadas pendientes por liquidar.');
    return;
  }

  const comision = bruto * 0.10;
  const neto = bruto - comision;

  const { error } = await db.from('cash_closures').insert([{
    business_id: localActivo.id,
    gross_amount: bruto,
    commission_amount: comision,
    net_amount: neto,
    status: 'pending_settlement'
  }]);

  if (!error) {
    alert(`Solicitud de corte enviada por $${neto.toFixed(2)}. Administración procesará tu transferencia.`);
  } else {
    alert('Error al enviar corte: ' + error.message);
  }
};

window.cerrarSesionCocina = async function() {
  await db.auth.signOut();
  window.location.href = 'portal.html';
};

function suscribirComandasRealtime() {
  db.channel('cocina-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      cargarComandasCocina();
      cargarEstadisticasFinancieras();
    })
    .subscribe();
}