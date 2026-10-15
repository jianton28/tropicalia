const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let driverUser = null;
let driverPerfil = null;
let driverWallet = null;
let pedidoActivo = null;
let mapaLeaflet = null;
let marcadorDriver = null;
let canalRealtime = null;

const TECHO_DEUDA = 20.00;

const driverNombreEl = document.getElementById('driver-nombre');
const driverVehiculoEl = document.getElementById('driver-vehiculo');
const btnToggleOnline = document.getElementById('btn-toggle-online');
const walletSaldoEl = document.getElementById('wallet-saldo');
const walletDeudaEl = document.getElementById('wallet-deuda');
const btnSaldarDeuda = document.getElementById('btn-saldar-deuda');
const alertaLimiteDeuda = document.getElementById('alerta-limite-deuda');
const gridCarreras = document.getElementById('grid-carreras');
const seccionCarreraActiva = document.getElementById('seccion-carrera-activa');
const contenedorCarreraActiva = document.getElementById('contenedor-carrera-activa');
const mapaEstadoTexto = document.getElementById('mapa-estado-texto');
const modalEntrega = document.getElementById('modal-entrega');
const inputCodigoEntrega = document.getElementById('input-codigo-entrega');
const inputFotoEntrega = document.getElementById('input-foto-entrega');
const btnFinalizarEntrega = document.getElementById('btn-finalizar-entrega');

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    window.location.replace('portal.html');
    return;
  }

  driverUser = session.user;
  await cargarPerfilDriver();
  inicializarMapa();
  await cargarBilletera();
  
  // Verificar carrera en curso antes de listar las disponibles
  await verificarCarreraEnCurso();
  await cargarCarrerasDisponibles();
  
  suscribirCambiosEnTiempoReal();
})();

async function cargarPerfilDriver() {
  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .eq('id', driverUser.id)
    .maybeSingle();

  if (error || !data) {
    const nombre = driverUser.user_metadata?.full_name || 'Repartidor';
    const tlf = driverUser.user_metadata?.phone || 'Sin número';
    const { data: nuevo } = await db.from('driver_profiles').insert([{
      id: driverUser.id,
      full_name: nombre,
      phone: tlf,
      is_online: false
    }]).select().single();
    driverPerfil = nuevo;
  } else {
    driverPerfil = data;
  }

  driverNombreEl.innerText = driverPerfil.full_name;
  driverVehiculoEl.innerText = `Vehículo: ${driverPerfil.vehicle_type?.toUpperCase() || 'MOTO'} • Placa: ${driverPerfil.vehicle_plate || 'N/A'}`;
  actualizarBotonOnlineUI();
}

function actualizarBotonOnlineUI() {
  if (driverPerfil.is_online) {
    btnToggleOnline.className = 'btn-toggle activo';
    btnToggleOnline.innerText = '🟢 En Línea';
  } else {
    btnToggleOnline.className = 'btn-toggle pausado';
    btnToggleOnline.innerText = '⚪ Desconectado';
  }
}

window.toggleDisponibilidad = async function() {
  const nuevoEstado = !driverPerfil.is_online;
  const { error } = await db
    .from('driver_profiles')
    .update({ is_online: nuevoEstado })
    .eq('id', driverUser.id);

  if (!error) {
    driverPerfil.is_online = nuevoEstado;
    actualizarBotonOnlineUI();
    if (nuevoEstado) {
      await cargarCarrerasDisponibles();
      iniciarTrackingGPS();
    }
  }
};

window.cerrarSesion = async function() {
  try {
    await db.auth.signOut();
  } catch(e) {}
  localStorage.clear();
  sessionStorage.clear();
  window.location.replace('portal.html');
};

async function cargarBilletera() {
  let { data: wallet } = await db
    .from('delivery_wallets')
    .select('*')
    .eq('driver_id', driverUser.id)
    .maybeSingle();

  if (!wallet) {
    const { data: nuevaWallet } = await db.from('delivery_wallets').insert([{
      driver_id: driverUser.id,
      prepaid_balance: 0.00,
      cash_debt: 0.00,
      debt_ceiling: TECHO_DEUDA,
      is_blocked: false
    }]).select().single();
    wallet = nuevaWallet;
  }

  driverWallet = wallet;
  const saldo = parseFloat(wallet.prepaid_balance || 0);
  const deuda = parseFloat(wallet.cash_debt || 0);

  walletSaldoEl.innerText = `$${saldo.toFixed(2)}`;
  walletDeudaEl.innerText = `$${deuda.toFixed(2)} / $${TECHO_DEUDA.toFixed(2)}`;
  btnSaldarDeuda.disabled = !(saldo > 0 && deuda > 0);

  const tieneBloqueoEfectivo = deuda >= TECHO_DEUDA;
  alertaLimiteDeuda.style.display = tieneBloqueoEfectivo ? 'block' : 'none';

  if (tieneBloqueoEfectivo !== wallet.is_blocked) {
    await db.from('delivery_wallets').update({ is_blocked: tieneBloqueoEfectivo }).eq('driver_id', driverUser.id);
    driverWallet.is_blocked = tieneBloqueoEfectivo;
  }
}

window.saldarDeudaConSaldo = async function() {
  const saldo = parseFloat(driverWallet.prepaid_balance || 0);
  const deuda = parseFloat(driverWallet.cash_debt || 0);
  if (saldo <= 0 || deuda <= 0) return;

  const abono = Math.min(saldo, deuda);
  const nuevoSaldo = saldo - abono;
  const nuevaDeuda = deuda - abono;

  const { error } = await db.from('delivery_wallets').update({
    prepaid_balance: nuevoSaldo,
    cash_debt: nuevaDeuda,
    is_blocked: nuevaDeuda >= TECHO_DEUDA
  }).eq('driver_id', driverUser.id);

  if (!error) {
    await db.from('delivery_transactions').insert([{
      driver_id: driverUser.id,
      amount: abono,
      type: 'debt_payment',
      notes: `Amortización voluntaria de deuda con saldo digital`
    }]);

    alert(`¡Has amortizado $${abono.toFixed(2)} a tu deuda!`);
    await cargarBilletera();
    await cargarCarrerasDisponibles();
  }
};

function inicializarMapa() {
  const coordsCaracas = [10.4806, -66.9036];
  mapaLeaflet = L.map('mapa-delivery').setView(coordsCaracas, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapaLeaflet);
}

function iniciarTrackingGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!marcadorDriver) {
        marcadorDriver = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'custom-driver-icon',
            html: '<div style="background:#fbbf24; border:2px solid #000; border-radius:50%; width:16px; height:16px;"></div>',
            iconSize: [16, 16]
          })
        }).addTo(mapaLeaflet).bindPopup('Tu ubicación actual');
      } else {
        marcadorDriver.setLatLng([lat, lng]);
      }
    },
    err => console.warn('GPS:', err),
    { enableHighAccuracy: true }
  );
}

// =========================================================================
// CORRECCIÓN CLAVE: VERIFICACIÓN ROBUSTA DE CARRERA EN CURSO
// =========================================================================
async function verificarCarreraEnCurso() {
  // Buscamos cualquier orden asignada a este driver que no esté entregada ni cancelada
  const { data: activa, error } = await db
    .from('orders')
    .select('*, businesses(name, phone)')
    .eq('driver_id', driverUser.id)
    .not('status', 'in', '("delivered","cancelled","rejected")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error verificando carrera:', error);
  }

  if (activa) {
    pedidoActivo = activa;
    renderizarCarreraActiva();
  } else {
    pedidoActivo = null;
    seccionCarreraActiva.style.display = 'none';
    mapaEstadoTexto.innerText = 'Sin carrera en curso';
  }
}

async function cargarCarrerasDisponibles() {
  if (pedidoActivo) {
    gridCarreras.innerHTML = '<p style="color: #a3a3a3; font-size: 0.85rem;">Ya tienes una carrera activa en curso. Finalízala para ver nuevas asignaciones.</p>';
    return;
  }

  if (!driverPerfil?.is_online) {
    gridCarreras.innerHTML = '<p style="color: #a3a3a3; font-size: 0.85rem;">Ponte en estado <strong>En Línea</strong> para recibir comandas disponibles.</p>';
    return;
  }

  const { data: pedidos, error } = await db
    .from('orders')
    .select('*, businesses(name, phone)')
    .eq('delivery_type', 'delivery')
    .is('driver_id', null)
    .in('status', ['pending', 'cooking', 'on_the_way'])
    .order('created_at', { ascending: true });

  if (error || !pedidos || pedidos.length === 0) {
    gridCarreras.innerHTML = '<p style="color: #888; font-size: 0.85rem;">No hay carreras disponibles en este instante.</p>';
    return;
  }

  const bloqueadoEfectivo = parseFloat(driverWallet?.cash_debt || 0) >= TECHO_DEUDA;

  gridCarreras.innerHTML = pedidos.map(orden => {
    const esEfectivo = orden.payment_method === 'efectivo';
    const flete = parseFloat(orden.delivery_fee || 2.50).toFixed(2);
    const propina = parseFloat(orden.driver_tip || 0).toFixed(2);
    const gananciaTotal = (parseFloat(flete) + parseFloat(propina)).toFixed(2);

    return `
      <div class="carrera-card">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="color: #fbbf24;">#ORD-${orden.id.slice(0, 8)}</strong>
            <span class="badge ${esEfectivo ? 'badge-cooking' : 'badge-on_the_way'}">${esEfectivo ? '💵 Efectivo' : '📲 Pago Digital'}</span>
          </div>
          <p style="margin: 4px 0; font-size: 0.85rem;"><strong>Restaurante:</strong> ${orden.businesses?.name || 'Local'}</p>
          <p style="margin: 4px 0; font-size: 0.85rem;"><strong>Entrega en:</strong> ${orden.delivery_address}</p>
          <div style="background: #222; border-radius: 6px; padding: 8px; margin: 8px 0; font-size: 0.85rem;">
            <span>Ganancia Flete + Propina:</span>
            <strong style="color: #10b981; font-size: 1.1rem; display: block;">$${gananciaTotal}</strong>
          </div>
        </div>
        <div>
          ${(esEfectivo && bloqueadoEfectivo) ? `
            <button type="button" class="btn-estado" disabled style="background:#4b5563; color:#aaa; width:100%; cursor:not-allowed;">
              Bloqueado (Deuda > $20)
            </button>
          ` : `
            <button type="button" onclick="aceptarCarrera('${orden.id}')" class="btn-primario" style="width: 100%;">
              Aceptar Carrera
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.aceptarCarrera = async function(ordenId) {
  // Asignar orden de manera estricta asegurando que driver_id esté libre
  const codigoSeguridad = Math.floor(1000 + Math.random() * 9000).toString();

  const { data, error } = await db
    .from('orders')
    .update({
      driver_id: driverUser.id,
      delivery_status: 'accepted',
      delivery_code: codigoSeguridad
    })
    .eq('id', ordenId)
    .is('driver_id', null)
    .select()
    .maybeSingle();

  if (error || !data) {
    alert('Esta carrera ya fue tomada por otro repartidor o no se pudo asignar.');
  }

  await verificarCarreraEnCurso();
  await cargarCarrerasDisponibles();
};

function renderizarCarreraActiva() {
  if (!pedidoActivo) return;

  seccionCarreraActiva.style.display = 'block';
  const orden = pedidoActivo;
  const esEfectivo = orden.payment_method === 'efectivo';
  const flete = parseFloat(orden.delivery_fee || 2.50).toFixed(2);
  const totalCobrar = parseFloat(orden.total).toFixed(2);

  mapaEstadoTexto.innerText = `Ruta activa: #ORD-${orden.id.slice(0, 8)}`;

  let botonAccion = '';
  if (orden.delivery_status === 'accepted') {
    botonAccion = `<button type="button" onclick="actualizarPasoCarrera('arrived_at_store')" class="btn-primario" style="width: 100%;">1. Llegué al Restaurante</button>`;
  } else if (orden.delivery_status === 'arrived_at_store') {
    botonAccion = `<button type="button" onclick="actualizarPasoCarrera('on_the_way')" class="btn-primario" style="width: 100%; background:#10b981; color:#000;">2. Recibí el paquete (En Camino)</button>`;
  } else if (orden.delivery_status === 'on_the_way') {
    botonAccion = `<button type="button" onclick="abrirModalEntrega()" class="btn-primario" style="width: 100%; background:#6366f1;">3. Entregar al Cliente</button>`;
  }

  contenedorCarreraActiva.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span class="step-badge">${(orden.delivery_status || 'En curso').replace(/_/g, ' ')}</span>
      <strong style="color: #fbbf24;">Ganancia: $${flete}</strong>
    </div>

    <p style="margin: 4px 0; font-size: 0.9rem;"><strong>Restaurante:</strong> ${orden.businesses?.name || 'Local'}</p>
    <p style="margin: 4px 0; font-size: 0.9rem;"><strong>Destino:</strong> ${orden.delivery_address}</p>
    <p style="margin: 4px 0; font-size: 0.9rem;"><strong>Cliente:</strong> ${orden.customer_name || 'Cliente'} (${orden.customer_phone || 'S/N'})</p>
    
    ${esEfectivo ? `
      <div style="background: #3b1818; border: 1px solid #7f1d1d; border-radius: 6px; padding: 8px; margin: 8px 0; font-size: 0.85rem; color: #fca5a5;">
        💵 <strong>Cobro en Efectivo:</strong> Recibir $${totalCobrar} del cliente.
      </div>
    ` : `
      <div style="background: #182818; border: 1px solid #166534; border-radius: 6px; padding: 8px; margin: 8px 0; font-size: 0.85rem; color: #86efac;">
        ✅ <strong>Pago Digital Confirmado.</strong>
      </div>
    `}

    <div style="display: flex; gap: 8px; margin-top: 10px;">
      ${orden.map_url ? `<a href="${orden.map_url}" target="_blank" class="btn-secundario" style="text-align:center; flex:1; text-decoration:none; padding:8px;">📍 Ver Mapa</a>` : ''}
      <a href="https://wa.me/${(orden.customer_phone || '').replace(/\D/g, '')}" target="_blank" class="btn-secundario" style="text-align:center; flex:1; text-decoration:none; padding:8px;">📲 WhatsApp</a>
    </div>

    <div style="margin-top: 12px;">
      ${botonAccion}
    </div>
  `;
}

window.actualizarPasoCarrera = async function(nuevoPaso) {
  if (!pedidoActivo) return;
  const actualizacion = { delivery_status: nuevoPaso };
  if (nuevoPaso === 'on_the_way') {
    actualizacion.status = 'on_the_way';
  }

  const { error } = await db.from('orders').update(actualizacion).eq('id', pedidoActivo.id);
  if (!error) {
    pedidoActivo.delivery_status = nuevoPaso;
    if (nuevoPaso === 'on_the_way') pedidoActivo.status = 'on_the_way';
    renderizarCarreraActiva();
  }
};

window.abrirModalEntrega = function() {
  modalEntrega.style.display = 'flex';
};

window.cerrarModalEntrega = function() {
  modalEntrega.style.display = 'none';
  inputCodigoEntrega.value = '';
  inputFotoEntrega.value = '';
};

window.validarYFinalizarEntrega = async function() {
  if (!pedidoActivo) return;

  const codigoIngresado = inputCodigoEntrega.value.trim();
  const archivoFoto = inputFotoEntrega.files[0];

  btnFinalizarEntrega.disabled = true;
  btnFinalizarEntrega.innerText = 'Validando...';

  try {
    let fotoUrl = null;

    if (codigoIngresado) {
      if (codigoIngresado !== pedidoActivo.delivery_code) {
        throw new Error('El código ingresado no coincide con el del cliente.');
      }
    } else if (archivoFoto) {
      const ext = archivoFoto.name.split('.').pop();
      const ruta = `entregas/${pedidoActivo.id}_${Date.now()}.${ext}`;
      const { error: errUpload } = await db.storage.from('receipts').upload(ruta, archivoFoto);
      if (errUpload) throw errUpload;
      const { data: urlData } = db.storage.from('receipts').getPublicUrl(ruta);
      fotoUrl = urlData.publicUrl;
    } else {
      throw new Error('Debes ingresar el código de 4 dígitos o subir la foto de entrega.');
    }

    await db.from('orders').update({
      delivery_status: 'delivered',
      status: 'delivered',
      delivery_photo_url: fotoUrl
    }).eq('id', pedidoActivo.id);

    await procesarFinanzasEntrega(pedidoActivo);

    alert('¡Entrega concretada con éxito!');
    cerrarModalEntrega();
    await verificarCarreraEnCurso();
    await cargarBilletera();
    await cargarCarrerasDisponibles();

  } catch (err) {
    alert('Error al confirmar: ' + err.message);
  } finally {
    btnFinalizarEntrega.disabled = false;
    btnFinalizarEntrega.innerText = 'Finalizar';
  }
};

async function procesarFinanzasEntrega(orden) {
  // Asegurar que driverWallet exista antes de leer sus propiedades
  if (!driverWallet) {
    let { data: wallet } = await db
      .from('delivery_wallets')
      .select('*')
      .eq('driver_id', driverUser.id)
      .maybeSingle();

    if (!wallet) {
      const { data: nuevaWallet } = await db.from('delivery_wallets').insert([{
        driver_id: driverUser.id,
        prepaid_balance: 0.00,
        cash_debt: 0.00,
        debt_ceiling: 20.00,
        is_blocked: false
      }]).select().single();
      wallet = nuevaWallet;
    }
    driverWallet = wallet;
  }

  const flete = parseFloat(orden.delivery_fee || 2.50);
  const propina = parseFloat(orden.driver_tip || 0);
  const gananciaFlete = flete + propina;
  const esEfectivo = orden.payment_method === 'efectivo';

  let saldoActual = parseFloat(driverWallet.prepaid_balance || 0);
  let deudaActual = parseFloat(driverWallet.cash_debt || 0);

  if (esEfectivo) {
    const valorComida = parseFloat(orden.subtotal_food || (orden.total - gananciaFlete));
    deudaActual += valorComida;
    await db.from('delivery_transactions').insert([{
      driver_id: driverUser.id,
      order_id: orden.id,
      amount: valorComida,
      type: 'cash_collected',
      notes: `Efectivo recaudado comanda #${orden.id.slice(0, 8)}`
    }]);
  } else {
    if (deudaActual > 0) {
      const retencion = gananciaFlete * 0.50;
      const abonoReal = Math.min(deudaActual, retencion);
      const saldoNeto = gananciaFlete - abonoReal;
      deudaActual -= abonoReal;
      saldoActual += saldoNeto;
      await db.from('delivery_transactions').insert([{
        driver_id: driverUser.id,
        order_id: orden.id,
        amount: abonoReal,
        type: 'debt_payment',
        notes: `Retención automática 50% flete digital`
      }]);
    } else {
      saldoActual += gananciaFlelte || gananciaFlete;
    }
    await db.from('delivery_transactions').insert([{
      driver_id: driverUser.id,
      order_id: orden.id,
      amount: gananciaFlete,
      type: 'fee_earned',
      notes: `Ganancia flete comanda #${orden.id.slice(0, 8)}`
    }]);
  }

  await db.from('delivery_wallets').update({
    prepaid_balance: saldoActual,
    cash_debt: deudaActual,
    is_blocked: deudaActual >= 20.00
  }).eq('driver_id', driverUser.id);
  
  // Actualizar la variable local
  driverWallet.prepaid_balance = saldoActual;
  driverWallet.cash_debt = deudaActual;
}

function suscribirCambiosEnTiempoReal() {
  canalRealtime = db.channel('delivery-orders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
      await verificarCarreraEnCurso();
      await cargarCarrerasDisponibles();
    })
    .subscribe();
}