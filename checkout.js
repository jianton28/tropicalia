const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let carrito = JSON.parse(localStorage.getItem('tropicalia_cart') || '[]');
let businessId = localStorage.getItem('tropicalia_business_id');
let businessName = localStorage.getItem('tropicalia_business_name') || 'Restaurante';
let tasaBCV = parseFloat(localStorage.getItem('tropicalia_bcv') || '875.65');
let usuarioActual = null;

const listaItemsEl = document.getElementById('lista-items-checkout');
const localNombreEl = document.getElementById('checkout-local-nombre');

(async () => {
  if (carrito.length === 0 || !businessId) {
    alert('Tu carrito está vacío. Agrega platos desde el menú.');
    window.location.href = 'index.html';
    return;
  }

  localNombreEl.innerText = businessName;
  await verificarSesionCliente();
  renderizarItemsCheckout();
  recalcularTotalesCheckout();
})();

async function verificarSesionCliente() {
  const { data: { session } } = await db.auth.getSession();
  if (session && session.user) {
    usuarioActual = session.user;
    const meta = usuarioActual.user_metadata || {};

    if (meta.full_name) document.getElementById('chk-nombre').value = meta.full_name;
    if (meta.phone) document.getElementById('chk-telefono').value = meta.phone;

    // Si ya inició sesión, aceptó los términos al registrarse: no molestar de nuevo
    const chkTyc = document.getElementById('chk-tyc');
    const bloqueTyc = document.getElementById('bloque-tyc-checkout');
    chkTyc.checked = true;
    chkTyc.required = false;
    bloqueTyc.innerHTML = '<small style="color: #888;">✅ Sesión activa: Términos de servicio previamente aceptados en tu cuenta.</small>';
  }
}

function renderizarItemsCheckout() {
  listaItemsEl.innerHTML = carrito.map((item, index) => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #242424;">
      <div>
        <strong>${item.quantity}x ${item.name}</strong>
        <small style="color: var(--text-muted); display: block;">$${item.price.toFixed(2)} c/u</small>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <strong>$${(item.price * item.quantity).toFixed(2)}</strong>
        <button type="button" onclick="cambiarCantidad(${index}, -1)" class="btn-secundario" style="padding: 2px 8px;">-</button>
        <button type="button" onclick="cambiarCantidad(${index}, 1)" class="btn-secundario" style="padding: 2px 8px;">+</button>
      </div>
    </div>
  `).join('');
}

window.cambiarCantidad = function(idx, delta) {
  carrito[idx].quantity += delta;
  if (carrito[idx].quantity <= 0) {
    carrito.splice(idx, 1);
  }
  localStorage.setItem('tropicalia_cart', JSON.stringify(carrito));
  if (carrito.length === 0) {
    window.location.href = 'index.html';
    return;
  }
  renderizarItemsCheckout();
  recalcularTotalesCheckout();
};

window.vaciarCarritoCheckout = function() {
  localStorage.removeItem('tropicalia_cart');
  window.location.href = 'index.html';
};

window.recalcularTotalesCheckout = function() {
  const modalidad = document.getElementById('chk-modalidad').value;
  const bloqueDir = document.getElementById('bloque-direccion-delivery');
  const propinaVal = parseFloat(document.getElementById('chk-select-propina').value || '0');

  const subtotal = carrito.reduce((acc, el) => acc + (el.price * el.quantity), 0);
  const costoDelivery = modalidad === 'delivery' ? 2.50 : 0.00;
  const propina = modalidad === 'delivery' ? propinaVal : 0.00;
  const totalUsd = subtotal + costoDelivery + propina;
  const totalBs = totalUsd * tasaBCV;

  bloqueDir.style.display = modalidad === 'delivery' ? 'block' : 'none';

  document.getElementById('chk-subtotal').innerText = `$${subtotal.toFixed(2)}`;
  document.getElementById('chk-delivery').innerText = `$${costoDelivery.toFixed(2)}`;
  document.getElementById('chk-propina').innerText = `$${propina.toFixed(2)}`;
  document.getElementById('chk-total-usd').innerText = `$${totalUsd.toFixed(2)}`;
  document.getElementById('chk-total-bs').innerText = `Bs. ${totalBs.toFixed(2)}`;

  return { subtotal, costoDelivery, propina, totalUsd, totalBs };
};

window.alternarBloquePagoMovil = function() {
  const metodo = document.getElementById('chk-metodo-pago').value;
  document.getElementById('bloque-pago-movil').style.display = metodo === 'pago_movil' ? 'block' : 'none';
};

window.obtenerUbicacionGPSCliente = function() {
  const btn = document.getElementById('btn-capturar-gps');
  const inputUrl = document.getElementById('chk-map-url');
  const txtDir = document.getElementById('chk-direccion');

  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización.');
    return;
  }

  btn.innerText = '⏳ Obteniendo coordenadas GPS...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      inputUrl.value = gmapsUrl;
      if (!txtDir.value.trim()) {
        txtDir.value = `Ubicación GPS exacta (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }
      btn.innerText = '✅ Ubicación GPS Capturada';
      btn.style.borderColor = '#10b981';
      btn.style.color = '#10b981';
    },
    err => {
      alert('No se pudo obtener el GPS. Escribe tu punto de referencia manualmente.');
      btn.innerText = '📍 Usar mi ubicación GPS actual';
    },
    { enableHighAccuracy: true }
  );
};

document.getElementById('form-checkout').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btnSubmit = document.getElementById('btn-submit-orden');
  btnSubmit.disabled = true;
  btnSubmit.innerText = 'Procesando tu orden...';

  try {
    const modalidad = document.getElementById('chk-modalidad').value;
    const metodoPago = document.getElementById('chk-metodo-pago').value;
    const direccion = document.getElementById('chk-direccion').value.trim();
    const referencia = document.getElementById('chk-referencia').value.trim();
    const archivoCaptura = document.getElementById('chk-captura').files[0];

    if (modalidad === 'delivery' && !direccion) {
      throw new Error('Por favor usa el botón de ubicación GPS o indica tu dirección de entrega.');
    }

    let urlComprobante = null;
    if (metodoPago === 'pago_movil') {
      if (!referencia) throw new Error('Ingresa los últimos dígitos de la referencia de Pago Móvil.');
      if (archivoCaptura) {
        const ext = archivoCaptura.name.split('.').pop();
        const fileName = `pagos/pm_${Date.now()}.${ext}`;
        const { error: upErr } = await db.storage.from('receipts').upload(fileName, archivoCaptura);
        if (!upErr) {
          const { data: pubUrl } = db.storage.from('receipts').getPublicUrl(fileName);
          urlComprobante = pubUrl.publicUrl;
        }
      }
    }

    const { subtotal, costoDelivery, propina, totalUsd, totalBs } = recalcularTotalesCheckout();
    const estadoInicial = metodoPago === 'pago_movil' ? 'pending_payment_verification' : 'pending';

    const payloadOrden = {
      business_id: businessId,
      customer_name: document.getElementById('chk-nombre').value.trim(),
      customer_phone: document.getElementById('chk-telefono').value.trim(),
      delivery_type: modalidad,
      delivery_address: modalidad === 'delivery' ? direccion : 'Retiro en local (Pickup)',
      map_url: document.getElementById('chk-map-url').value || null,
      notes: document.getElementById('chk-notas').value.trim(),
      payment_method: metodoPago,
      payment_reference: metodoPago === 'pago_movil' ? referencia : 'EFECTIVO',
      payment_receipt_url: urlComprobante,
      items: carrito,
      subtotal_food: subtotal,
      delivery_fee: costoDelivery,
      driver_tip: propina,
      total: totalUsd,
      total_bs: totalBs,
      status: estadoInicial
    };

    const { data: orden, error: ordenError } = await db
      .from('orders')
      .insert([payloadOrden])
      .select()
      .single();

    if (ordenError) throw ordenError;

    // Guardar ID para acceso rápido y limpiar carrito
    localStorage.setItem('tropicalia_last_order_id', orden.id);
    localStorage.removeItem('tropicalia_cart');

    window.location.href = `tracking.html?order_id=${orden.id}`;

  } catch (err) {
    alert('Error al procesar el pedido: ' + err.message);
    btnSubmit.disabled = false;
    btnSubmit.innerText = 'Confirmar y Enviar Pedido';
  }
});