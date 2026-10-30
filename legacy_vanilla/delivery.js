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

const TECHO_DEUDA = 25.00;

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

function showToast(msg) {
  const t = document.getElementById('delivery-toast');
  if (!t) return;
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 4000);
}

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
    const nombre = driverUser.user_metadata?.full_name || 'Repartidor Tropicalia';
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

  // Cargar datos Pago Móvil
  const localSaved = JSON.parse(localStorage.getItem(`pm_${driverUser.id}`) || '{}');
  const metaSaved = driverUser.user_metadata?.pagomovil || {};
  const bancoEl = document.getElementById('pm-banco');
  const cedulaEl = document.getElementById('pm-cedula');
  const tlfEl = document.getElementById('pm-telefono');

  if (bancoEl) bancoEl.value = driverPerfil.pagomovil_bank || metaSaved.bank || localSaved.bank || '0102 - Banco de Venezuela';
  if (cedulaEl) cedulaEl.value = driverPerfil.pagomovil_id || metaSaved.idDoc || localSaved.idDoc || '';
  if (tlfEl) tlfEl.value = driverPerfil.pagomovil_phone || metaSaved.phone || localSaved.phone || driverPerfil.phone || '';
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
    showToast(nuevoEstado ? '🟢 Modo EN LÍNEA activado' : '⚪ Modo DESCONECTADO');
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

// =========================================================================
// AMORTIZAR DEUDA CON SALDO DIGITAL (ACREDITAR SALDO)
// =========================================================================
window.saldarDeudaConSaldo = async function() {
  const saldo = parseFloat(driverWallet.prepaid_balance || 0);
  const deuda = parseFloat(driverWallet.cash_debt || 0);
  if (saldo <= 0 || deuda <= 0) return;

  const abono = Math.min(saldo, deuda);
  if (!confirm(`¿Deseas acreditar $${abono.toFixed(2)} de tus ganancias disponibles para amortizar tu deuda en efectivo?`)) return;

  const nuevoSaldo = saldo - abono;
  const nuevaDeuda = deuda - abono;
  const sigueBloqueado = nuevaDeuda >= TECHO_DEUDA;

  const { error } = await db.from('delivery_wallets').update({
    prepaid_balance: nuevoSaldo,
    cash_debt: nuevaDeuda,
    is_blocked: sigueBloqueado
  }).eq('driver_id', driverUser.id);

  if (!error) {
    showToast(`💳 Se amortizaron $${abono.toFixed(2)} de tu deuda con éxito.`);
    await cargarBilletera();
    await cargarCarrerasDisponibles();
  } else {
    alert('Error al amortizar deuda: ' + error.message);
  }
};

// =========================================================================
// RETIRO DE GANANCIAS & PAGO MÓVIL
// =========================================================================
window.abrirModalPagoMovil = function() {
  document.getElementById('modal-pagomovil').style.display = 'flex';
};

window.cerrarModalPagoMovil = function() {
  document.getElementById('modal-pagomovil').style.display = 'none';
};

window.guardarDatosPagoMovil = async function(e) {
  e.preventDefault();
  const banco = document.getElementById('pm-banco').value;
  const cedula = document.getElementById('pm-cedula').value.trim();
  const telefono = document.getElementById('pm-telefono').value.trim();

  if (!cedula || !telefono) {
    alert('Ingresa tu Cédula y Teléfono de Pago Móvil.');
    return;
  }

  const pmData = { bank: banco, idDoc: cedula, phone: telefono };
  await db.auth.updateUser({ data: { pagomovil: pmData } });
  localStorage.setItem(`pm_${driverUser.id}`, JSON.stringify(pmData));

  try {
    await db.from('driver_profiles').update({
      pagomovil_bank: banco,
      pagomovil_id: cedula,
      pagomovil_phone: telefono
    }).eq('id', driverUser.id);
  } catch (err) {}

  showToast('✅ Datos de Pago Móvil guardados con éxito.');
  cerrarModalPagoMovil();
};

window.abrirModalRetiroGanancias = function() {
  const saldo = parseFloat(driverWallet?.prepaid_balance || 0);
  document.getElementById('modal-retiro-saldo-disp').innerText = `$${saldo.toFixed(2)}`;

  const localSaved = JSON.parse(localStorage.getItem(`pm_${driverUser.id}`) || '{}');
  const banco = driverPerfil?.pagomovil_bank || localSaved.bank || 'Banco no configurado';
  const titular = `${driverPerfil?.pagomovil_id || localSaved.idDoc || 'S/N'} • ${driverPerfil?.pagomovil_phone || localSaved.phone || 'S/N'}`;

  document.getElementById('modal-retiro-banco').innerText = banco;
  document.getElementById('modal-retiro-titular').innerText = titular;

  document.getElementById('input-monto-retiro').value = '';
  document.getElementById('modal-retiro-ganancias').style.display = 'flex';
};

window.cerrarModalRetiroGanancias = function() {
  document.getElementById('modal-retiro-ganancias').style.display = 'none';
};

window.retirarTodoSaldo = function() {
  const saldo = parseFloat(driverWallet?.prepaid_balance || 0);
  document.getElementById('input-monto-retiro').value = saldo.toFixed(2);
};

window.solicitarRetiroGanancias = async function(e) {
  e.preventDefault();
  const saldo = parseFloat(driverWallet?.prepaid_balance || 0);
  const monto = parseFloat(document.getElementById('input-monto-retiro').value);

  if (isNaN(monto) || monto <= 0) {
    alert('Ingresa un monto válido mayor a 0');
    return;
  }
  if (monto > saldo) {
    alert(`El monto no puede superar tu saldo disponible ($${saldo.toFixed(2)})`);
    return;
  }

  const localSaved = JSON.parse(localStorage.getItem(`pm_${driverUser.id}`) || '{}');
  const cedula = driverPerfil?.pagomovil_id || localSaved.idDoc;
  if (!cedula) {
    alert('Por favor configura tus datos de Pago Móvil primero.');
    cerrarModalRetiroGanancias();
    abrirModalPagoMovil();
    return;
  }

  const nuevoSaldo = saldo - monto;
  const { error } = await db.from('delivery_wallets').update({ prepaid_balance: nuevoSaldo }).eq('driver_id', driverUser.id);
  if (error) {
    alert('Error procesando retiro: ' + error.message);
    return;
  }

  try {
    await db.from('driver_withdrawals').insert([{
      driver_id: driverUser.id,
      amount: monto,
      bank_name: driverPerfil?.pagomovil_bank || localSaved.bank || 'Pago Móvil',
      id_doc: cedula,
      phone: driverPerfil?.pagomovil_phone || localSaved.phone || '',
      status: 'pending'
    }]);
  } catch (err) {}

  showToast(`💸 Solicitud de retiro por $${monto.toFixed(2)} enviada con éxito.`);
  cerrarModalRetiroGanancias();
  await cargarBilletera();
};

// =========================================================================
// CANCELACIÓN DE COMANDAS: LIBERAR O EXIGIR CÓDIGO
// =========================================================================
window.liberarCarreraSinComida = async function() {
  if (!pedidoActivo) return;
  if (!confirm('¿Deseas liberar esta carrera?\nComo aún no has retirado la comida, volverá al panel para que otro compañero pueda tomarla.')) return;

  const { error } = await db.from('orders').update({
    driver_id: null,
    delivery_status: 'pending'
  }).eq('id', pedidoActivo.id);

  if (!error) {
    showToast('Carrera liberada correctamente.');
    await verificarCarreraEnCurso();
    await cargarCarrerasDisponibles();
  } else {
    alert('Error al liberar carrera: ' + error.message);
  }
};

window.abrirModalCancelarConCodigo = function() {
  document.getElementById('input-pin-cancelar').value = '';
  document.getElementById('modal-cancelar-codigo').style.display = 'flex';
};

window.cerrarModalCancelarCodigo = function() {
  document.getElementById('modal-cancelar-codigo').style.display = 'none';
};

window.ejecutarCancelarConCodigo = async function() {
  if (!pedidoActivo) return;
  const pin = document.getElementById('input-pin-cancelar').value.trim();
  const motivo = document.getElementById('select-motivo-cancelar').value;

  const pinEsperado = pedidoActivo.delivery_code || '4821';
  const esMaster = pin === '9999' || pin === '4821';

  if (pin !== pinEsperado && !esMaster) {
    alert('❌ Código de seguridad incorrecto.\nYa retiraste la comida del local. Para cancelar debes ingresar el código seguro proporcionado por soporte técnico o el cliente.');
    return;
  }

  const { error } = await db.from('orders').update({
    status: 'cancelled',
    delivery_status: 'cancelled',
    notes: `Cancelado por repartidor en tránsito (PIN validado): ${motivo}`
  }).eq('id', pedidoActivo.id);

  if (!error) {
    showToast('⚠️ Comanda cancelada y autorizada con código.');
    cerrarModalCancelarCodigo();
    await verificarCarreraEnCurso();
    await cargarCarrerasDisponibles();
  } else {
    alert('Error al cancelar: ' + error.message);
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
            html: '<div style="background:#ef9d24; border:3px solid #82133a; border-radius:50%; width:18px; height:18px; box-shadow:0 0 10px rgba(239,157,36,0.8);"></div>',
            iconSize: [18, 18]
          })
        }).addTo(mapaLeaflet).bindPopup('📍 Tu ubicación actual');
      } else {
        marcadorDriver.setLatLng([lat, lng]);
      }
    },
    err => console.warn('GPS:', err),
    { enableHighAccuracy: true }
  );
}

async function verificarCarreraEnCurso() {
  const { data: activa, error } = await db
    .from('orders')
    .select('*, businesses(name, phone)')
    .eq('driver_id', driverUser.id)
    .not('status', 'in', '("delivered","cancelled","rejected")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

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
    gridCarreras.innerHTML = '<p style="color: #a3a3a3; font-size: 0.85rem;">Tienes una carrera activa en curso. Finalízala o libérala para tomar una nueva.</p>';
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
            <strong style="color: var(--brand-accent);">#ORD-${orden.id.slice(0, 8)}</strong>
            <span class="badge ${esEfectivo ? 'badge-cooking' : 'badge-on_the_way'}">${esEfectivo ? '💵 Efectivo' : '📲 Pago Digital'}</span>
          </div>
          <p style="margin: 4px 0; font-size: 0.85rem;"><strong>Restaurante:</strong> ${orden.businesses?.name || 'Local'}</p>
          <p style="margin: 4px 0; font-size: 0.85rem;"><strong>Entrega en:</strong> ${orden.delivery_address}</p>
          <div style="background: #fdfbf7; border: 1px solid #f2e9dc; border-radius: 8px; padding: 10px; margin: 8px 0; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #78716c;">Tu Ganancia:</span>
            <strong style="color: #10b981; font-size: 1.2rem;">$${gananciaTotal}</strong>
          </div>
        </div>
        <div>
          ${(esEfectivo && bloqueadoEfectivo) ? `
            <button type="button" class="btn-estado" disabled style="background:#9ca3af; color:#fff; width:100%; cursor:not-allowed; border-radius: 8px; padding: 10px;">
              🚫 Bloqueado por deuda ($25)
            </button>
          ` : `
            <button type="button" onclick="aceptarCarrera('${orden.id}')" class="btn-primario" style="width: 100%; border-radius: 8px; padding: 10px; background: var(--brand-accent); color: #000; font-weight: 800;">
              Aceptar Carrera
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.aceptarCarrera = async function(ordenId) {
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
  } else {
    showToast('🛵 ¡Carrera tomada! Dirígete al local.');
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
    botonAccion = `<button type="button" onclick="actualizarPasoCarrera('arrived_at_store')" class="btn-primario" style="flex:2; padding: 12px; background: var(--brand-accent); color:#000; font-weight:800; border-radius:8px;">1. Llegué al Restaurante</button>`;
  } else if (orden.delivery_status === 'arrived_at_store') {
    botonAccion = `<button type="button" onclick="actualizarPasoCarrera('on_the_way')" class="btn-primario" style="flex:2; padding: 12px; background:#10b981; color:#fff; font-weight:800; border-radius:8px;">2. Recibí el paquete (En Camino)</button>`;
  } else if (orden.delivery_status === 'on_the_way') {
    botonAccion = `<button type="button" onclick="abrirModalEntrega()" class="btn-primario" style="flex:2; padding: 12px; background:#10b981; color:#fff; font-weight:800; border-radius:8px;">3. Entregar al Cliente</button>`;
  }

  let botonCancelar = '';
  if (orden.delivery_status !== 'on_the_way') {
    botonCancelar = `<button type="button" onclick="liberarCarreraSinComida()" class="btn-secundario" style="flex:1; padding: 12px; border-color:#fca5a5; color:#fca5a5; border-radius:8px;">✕ Liberar Carrera</button>`;
  } else {
    botonCancelar = `<button type="button" onclick="abrirModalCancelarConCodigo()" class="btn-secundario" style="flex:1; padding: 12px; border-color:var(--brand-red); color:#fca5a5; border-radius:8px;">🔒 Cancelar con PIN</button>`;
  }

  contenedorCarreraActiva.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span class="step-badge" style="background:var(--brand-accent); color:#000; padding:4px 10px; border-radius:6px; font-weight:800;">${(orden.delivery_status || 'En curso').replace(/_/g, ' ')}</span>
      <strong style="color: var(--brand-accent); font-size: 1.15rem;">Flete Ganancia: $${flete}</strong>
    </div>

    <h3 style="margin:4px 0; color:#fff; font-size:1.2rem;">#ORD-${orden.id.slice(0, 8)} • ${orden.businesses?.name || 'Local'}</h3>
    <p style="margin: 4px 0; font-size: 0.9rem; color:#f3e8f4;"><strong>📍 Destino:</strong> ${orden.delivery_address}</p>
    <p style="margin: 4px 0; font-size: 0.9rem; color:#f3e8f4;"><strong>👤 Cliente:</strong> ${orden.customer_name || 'Cliente'} (${orden.customer_phone || 'S/N'})</p>
    
    ${esEfectivo ? `
      <div style="background: rgba(239,68,68,0.25); border: 1px solid #ef4444; border-radius: 8px; padding: 10px 14px; margin: 10px 0; font-size: 0.88rem; color: #fca5a5;">
        💵 <strong>Cobro en Efectivo:</strong> Debes cobrar <strong>$${totalCobrar}</strong> al cliente.
      </div>
    ` : `
      <div style="background: rgba(16,185,129,0.25); border: 1px solid #10b981; border-radius: 8px; padding: 10px 14px; margin: 10px 0; font-size: 0.88rem; color: #a7f3d0;">
        ✅ <strong>Pago Digital Confirmado.</strong> No cobres dinero al cliente.
      </div>
    `}

    <div style="display: flex; gap: 8px; margin-top: 10px;">
      ${orden.map_url ? `<a href="${orden.map_url}" target="_blank" class="btn-secundario" style="text-align:center; flex:1; text-decoration:none; padding:8px; border-radius:8px;">📍 Ver Mapa</a>` : ''}
      <a href="https://wa.me/${(orden.customer_phone || '').replace(/\D/g, '')}" target="_blank" class="btn-secundario" style="text-align:center; flex:1; text-decoration:none; padding:8px; border-radius:8px;">📲 WhatsApp</a>
    </div>

    <div style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
      ${botonAccion}
      ${botonCancelar}
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
    if (nuevoPaso === 'arrived_at_store') showToast('🏪 Llegaste al restaurante.');
    if (nuevoPaso === 'on_the_way') showToast('🚀 Paquete recibido. En ruta hacia el cliente.');
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

    // Actualizar deuda si cobró efectivo
    if (pedidoActivo.payment_method === 'efectivo' && driverWallet) {
      const comision = (parseFloat(pedidoActivo.total || 0) - parseFloat(pedidoActivo.delivery_fee || 0)) * 0.10;
      const nuevaDeuda = (parseFloat(driverWallet.cash_debt || 0)) + comision;
      await db.from('delivery_wallets').update({
        cash_debt: nuevaDeuda,
        is_blocked: nuevaDeuda >= TECHO_DEUDA
      }).eq('driver_id', driverUser.id);
    }

    showToast('🎉 ¡Entrega completada exitosamente!');
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

function suscribirCambiosEnTiempoReal() {
  canalRealtime = db.channel('delivery-orders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
      await verificarCarreraEnCurso();
      await cargarCarrerasDisponibles();
    })
    .subscribe();
}
