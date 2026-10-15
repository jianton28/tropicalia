const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let localActivo = null;
let productosLocal = [];
let comandasActivas = [];

const gridComandas = document.getElementById('grid-comandas');
const selectPlatoSalon = document.getElementById('select-plato-salon');

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    window.location.href = 'portal.html';
    return;
  }

  await cargarNegocioCocina(session.user);
  await cargarCatalogoLocal();
  await cargarComandasCocina();
  suscribirComandasRealtime();
})();

async function cargarNegocioCocina(user) {
  let { data: neg } = await db.from('businesses').select('*').eq('owner_id', user.id).maybeSingle();
  if (!neg) {
    const { data: primero } = await db.from('businesses').select('*').limit(1).single();
    neg = primero;
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

async function cargarCatalogoLocal() {
  const { data } = await db.from('products').select('*').eq('business_id', localActivo.id);
  productosLocal = data || [];
  selectPlatoSalon.innerHTML = productosLocal.map(p => `<option value="${p.id}">${p.name} ($${parseFloat(p.price).toFixed(2)} - Stock: ${p.stock ?? 99})</option>`).join('');
}

window.cargarComandasCocina = async function() {
  const { data: ordenes, error } = await db
    .from('orders')
    .select('*')
    .eq('business_id', localActivo.id)
    .in('status', ['pending', 'cooking', 'on_the_way', 'delivered'])
    .order('created_at', { ascending: false });

  if (error) return;
  comandasActivas = ordenes || [];

  // Calcular montos entregados hoy para corte
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
    
    // CÁLCULO DE ETA DEL REPARTIDOR PARA LA COCINA (SIN MAPA)
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

// FORMULARIO A: VENTA EN SALÓN
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

// FORMULARIO B: BAJA POR MERMA
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
    })
    .subscribe();
}