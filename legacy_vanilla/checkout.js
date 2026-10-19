const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let carrito = JSON.parse(localStorage.getItem('tropicalia_cart') || '[]');
let businessId = localStorage.getItem('tropicalia_business_id');
let businessName = localStorage.getItem('tropicalia_business_name') || 'Restaurante';
let tasaBCV = parseFloat(localStorage.getItem('tropicalia_bcv') || '875.65');
let usuarioActual = null;

// Coordenadas por defecto del restaurante en Caracas (se actualizan desde la BD)
let coordsRestaurante = { lat: 10.4806, lng: -66.9036 };
let distanciaCalculadaKm = 1.5; // Distancia inicial estimada
let fleteCalculadoUsd = 1.50;   // Tarifa inicial antes de GPS
let metodoSeleccionado = 'pago_movil';

const listaItemsEl = document.getElementById('lista-items-checkout');
const localNombreEl = document.getElementById('checkout-local-nombre');

(async () => {
  if (carrito.length === 0 || !businessId) {
    alert('Tu carrito está vacío. Agrega platos desde el menú.');
    window.location.href = 'index.html';
    return;
  }

  localNombreEl.innerText = businessName;
  await cargarCoordenadasRestaurante();
  await verificarSesionCliente();
  renderizarItemsCheckout();
  recalcularTotalesCheckout();
  renderizarFormularioMetodoPago('pago_movil');
})();

async function cargarCoordenadasRestaurante() {
  const { data: neg } = await db
    .from('businesses')
    .select('name, lat, lng')
    .eq('id', businessId)
    .maybeSingle();

  if (neg) {
    if (neg.name) localNombreEl.innerText = neg.name;
    if (neg.lat && neg.lng) {
      coordsRestaurante = {
        lat: parseFloat(neg.lat),
        lng: parseFloat(neg.lng)
      };
    }
  }
}

async function verificarSesionCliente() {
  const { data: { session } } = await db.auth.getSession();
  if (session && session.user) {
    usuarioActual = session.user;
    const meta = usuarioActual.user_metadata || {};

    if (meta.full_name) document.getElementById('chk-nombre').value = meta.full_name;
    if (meta.phone) document.getElementById('chk-telefono').value = meta.phone;

    const chkTyc = document.getElementById('chk-tyc');
    const bloqueTyc = document.getElementById('bloque-tyc-checkout');
    if (chkTyc && bloqueTyc) {
      chkTyc.checked = true;
      chkTyc.required = false;
      bloqueTyc.innerHTML = '<small style="color: #888;">✅ Sesión activa: Términos de servicio previamente aceptados en tu cuenta.</small>';
    }
  }
}

function renderizarItemsCheckout() {
  listaItemsEl.innerHTML = carrito.map((item, index) => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #242424;">
      <div>
        <strong>${item.quantity}x ${item.name}</strong>
        <small style="color: var(--text-muted); display: block;">$${parseFloat(item.price).toFixed(2)} c/u</small>
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

// =========================================================================
// 1. CÁLCULO DE TARIFA DE DELIVERY POR DISTANCIA REAL (HAVERSINE)
// =========================================================================
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Multiplicamos por 1.25 para compensar curvas de calles urbanas frente a línea recta
  return Math.max(0.2, R * c * 1.25);
}

function calcularTarifaPorKm(km) {
  // Hasta 1 km (pocas cuadras): $1.00 fijo. Luego +$0.50 por cada km extra (tope $6.00)
  if (km <= 1.0) return 1.00;
  const tarifa = 1.00 + ((km - 1.0) * 0.50);
  // Redondear a múltiplos limpios de $0.25
  const redondeado = Math.round(tarifa * 4) / 4;
  return Math.min(6.00, Math.max(1.00, redondeado));
}

window.seleccionarDistanciaManual = function() {
  const kmManual = parseFloat(document.getElementById('chk-distancia-manual').value || '1.5');
  distanciaCalculadaKm = kmManual;
  fleteCalculadoUsd = calcularTarifaPorKm(kmManual);

  const badge = document.getElementById('badge-km-calculados');
  if (badge) {
    badge.innerText = `📏 ~${kmManual.toFixed(1)} km ($${fleteCalculadoUsd.toFixed(2)})`;
  }
  recalcularTotalesCheckout();
};

window.obtenerUbicacionGPSCliente = function() {
  const btn = document.getElementById('btn-capturar-gps');
  const inputUrl = document.getElementById('chk-map-url');
  const txtDir = document.getElementById('chk-direccion');
  const badge = document.getElementById('badge-km-calculados');

  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización. Selecciona la distancia estimada al lado.');
    return;
  }

  btn.innerText = '⏳ Calculando distancia GPS...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      inputUrl.value = gmapsUrl;

      // Calcular distancia real con Haversine
      const km = calcularDistanciaKm(coordsRestaurante.lat, coordsRestaurante.lng, lat, lng);
      distanciaCalculadaKm = km;
      fleteCalculadoUsd = calcularTarifaPorKm(km);

      if (!txtDir.value.trim()) {
        txtDir.value = `Ubicación GPS exacta (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }

      btn.innerText = `✅ GPS Listo (${km.toFixed(1)} km)`;
      btn.style.borderColor = '#10b981';
      btn.style.color = '#10b981';

      if (badge) {
        badge.innerText = `🛵 Distancia real: ${km.toFixed(1)} km → Flete: $${fleteCalculadoUsd.toFixed(2)}`;
      }

      recalcularTotalesCheckout();
    },
    err => {
      alert('No se pudo obtener el GPS automático. Puedes elegir la distancia aproximada en el selector al lado.');
      btn.innerText = '📍 Calcular con mi GPS actual';
    },
    { enableHighAccuracy: true }
  );
};

window.recalcularTotalesCheckout = function() {
  const modalidad = document.getElementById('chk-modalidad').value;
  const bloqueDir = document.getElementById('bloque-direccion-delivery');
  const propinaVal = parseFloat(document.getElementById('chk-select-propina').value || '0');

  const subtotal = carrito.reduce((acc, el) => acc + (el.price * el.quantity), 0);
  const costoDelivery = modalidad === 'delivery' ? fleteCalculadoUsd : 0.00;
  const propina = modalidad === 'delivery' ? propinaVal : 0.00;
  const totalUsd = subtotal + costoDelivery + propina;
  const totalBs = totalUsd * tasaBCV;

  bloqueDir.style.display = modalidad === 'delivery' ? 'block' : 'none';

  document.getElementById('chk-subtotal').innerText = `$${subtotal.toFixed(2)}`;
  document.getElementById('chk-delivery').innerText = `$${costoDelivery.toFixed(2)}`;
  const distLabel = document.getElementById('chk-distancia-label');
  if (distLabel) {
    distLabel.innerText = modalidad === 'delivery' ? `(~${distanciaCalculadaKm.toFixed(1)} km)` : '(Pickup Gratis)';
  }
  document.getElementById('chk-propina').innerText = `$${propina.toFixed(2)}`;
  document.getElementById('chk-total-usd').innerText = `$${totalUsd.toFixed(2)}`;
  document.getElementById('chk-total-bs').innerText = `Bs. ${totalBs.toFixed(2)}`;

  // Actualizar montos automáticos si los inputs dinámicos están en pantalla
  const inputMontoVes = document.getElementById('dyn-monto-ves');
  if (inputMontoVes) inputMontoVes.value = totalBs.toFixed(2);
  const inputMontoUsd = document.getElementById('dyn-monto-usd');
  if (inputMontoUsd) inputMontoUsd.value = totalUsd.toFixed(2);

  return { subtotal, costoDelivery, propina, totalUsd, totalBs };
};

// =========================================================================
// 2. MÉTODOS DE PAGO CON REQUERIMIENTOS DINÁMICOS
// =========================================================================
window.seleccionarMetodoPago = function(metodo) {
  metodoSeleccionado = metodo;
  document.getElementById('chk-metodo-pago').value = metodo;

  document.querySelectorAll('.metodo-card').forEach(card => {
    card.classList.toggle('activo', card.dataset.metodo === metodo);
  });

  renderizarFormularioMetodoPago(metodo);
};

function renderizarFormularioMetodoPago(metodo) {
  const cont = document.getElementById('contenedor-campos-pago');
  const bloqueCaptura = document.getElementById('bloque-captura-digital');
  const { totalUsd, totalBs } = recalcularTotalesCheckout();

  // Ocultar captura de pantalla cuando es efectivo o punto presencial
  if (['efectivo', 'efectivo_bs', 'punto'].includes(metodo)) {
    bloqueCaptura.style.display = 'none';
  } else {
    bloqueCaptura.style.display = 'block';
  }

  if (metodo === 'pago_movil') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Datos Pago Móvil Tropicalia:</strong><br>
        Banco: <strong>Banesco (0134)</strong> • RIF/CI: <strong>V-24.123.456</strong> • Teléfono: <strong>0412-1234567</strong>
      </div>
      <div class="grid-2-cols">
        <div>
          <label>Banco Origen / Destino:</label>
          <select id="dyn-pm-banco" required>
            <option value="">Seleccione el banco...</option>
            <option value="0134 - Banesco">0134 - Banesco</option>
            <option value="0102 - Banco de Venezuela">0102 - Banco de Venezuela</option>
            <option value="0105 - Mercantil">0105 - Mercantil</option>
            <option value="0108 - Provincial">0108 - Provincial</option>
            <option value="0191 - BNC">0191 - BNC</option>
            <option value="0172 - Bancamiga">0172 - Bancamiga</option>
            <option value="Otro Banco">Otro Banco Nacional</option>
          </select>
        </div>
        <div>
          <label>Teléfono Origen (Desde donde pagas):</label>
          <input type="tel" id="dyn-pm-telefono" required placeholder="Ej: 04121234567" />
        </div>
      </div>
      <div class="grid-2-cols">
        <div>
          <label>Referencia (Últimos 4 o 6 dígitos):</label>
          <input type="text" id="dyn-referencia" maxlength="8" required placeholder="Ej: 849201" />
        </div>
        <div>
          <label>Monto Exacto (VES):</label>
          <input type="text" id="dyn-monto-ves" value="${totalBs.toFixed(2)}" readonly style="background:#1f1f1f; color:#34d399; font-weight:bold;" />
        </div>
      </div>
    `;
  } else if (metodo === 'binance') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Datos Binance Pay (USDT):</strong><br>
        Pay ID: <strong>248192031</strong> • Correo: <strong>pagos@tropicalia.com</strong>
      </div>
      <div>
        <label>Tu Binance UID, Pay ID o Correo Emisor:</label>
        <input type="text" id="dyn-binance-id" required placeholder="Ej: 12345678 o tu_usuario@correo.com" />
      </div>
      <div class="grid-2-cols">
        <div>
          <label>Order ID / Referencia (Opcional):</label>
          <input type="text" id="dyn-referencia" placeholder="Últimos dígitos del Order ID" />
        </div>
        <div>
          <label>Monto a Enviar (USDT):</label>
          <input type="text" id="dyn-monto-usd" value="${totalUsd.toFixed(2)}" readonly style="background:#1f1f1f; color:#fbbf24; font-weight:bold;" />
        </div>
      </div>
    `;
  } else if (metodo === 'zelle') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Cuenta Zelle Receptor:</strong><br>
        Correo: <strong>zelle@tropicalia.com</strong> • Titular: <strong>Tropicalia LLC</strong>
      </div>
      <div class="grid-2-cols">
        <div>
          <label>Nombre del Titular o Correo Zelle Emisor:</label>
          <input type="text" id="dyn-zelle-titular" required placeholder="Ej: Juan Pérez / juan@mail.com" />
        </div>
        <div>
          <label>Código de Confirmación / Referencia:</label>
          <input type="text" id="dyn-referencia" required placeholder="Ej: WF-94820" />
        </div>
      </div>
    `;
  } else if (metodo === 'zinli') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Billetera Zinli Receptor:</strong><br>
        Correo / Usuario: <strong>zinli@tropicalia.com</strong>
      </div>
      <div class="grid-2-cols">
        <div>
          <label>Correo o Teléfono Zinli Emisor:</label>
          <input type="text" id="dyn-zinli-emisor" required placeholder="Ej: usuario@correo.com" />
        </div>
        <div>
          <label>Referencia de Transacción:</label>
          <input type="text" id="dyn-referencia" required placeholder="Ej: 993812" />
        </div>
      </div>
    `;
  } else if (metodo === 'punto') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Pago por Punto de Venta:</strong><br>
        Si pides Delivery, nuestro motorizado llevará el punto inalámbrico. Si es Pickup, pagas directo en mostrador.
      </div>
      <div class="grid-2-cols">
        <div>
          <label>Tipo de Tarjeta:</label>
          <select id="dyn-punto-tipo" required>
            <option value="Débito">Tarjeta de Débito / Maestro</option>
            <option value="Crédito">Tarjeta de Crédito (Visa / Master)</option>
            <option value="Internacional">Tarjeta Internacional (Contactless)</option>
          </select>
        </div>
        <div>
          <label>Referencia Voucher (Solo si ya pagaste en caja):</label>
          <input type="text" id="dyn-referencia" placeholder="Opcional al pedir" />
        </div>
      </div>
    `;
  } else if (metodo === 'efectivo') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Efectivo en Divisas ($ USD):</strong><br>
        Total a pagar al recibir: <strong>$${totalUsd.toFixed(2)}</strong>. Indica con qué billete pagarás para enviar vuelto exacto.
      </div>
      <div>
        <label>¿Con qué billete vas a pagar? (Para preparar tu vuelto):</label>
        <input type="text" id="dyn-efectivo-billete" required placeholder="Ej: Pago exacto / Billete de $20 / Billete de $50" />
      </div>
    `;
  } else if (metodo === 'efectivo_bs') {
    cont.innerHTML = `
      <div class="datos-receptor-box">
        <strong style="color:var(--gold);">Efectivo en Bolívares (Bs):</strong><br>
        Monto equivalente a entregar: <strong>Bs. ${totalBs.toFixed(2)}</strong>.
      </div>
      <div>
        <label>Observación de pago en efectivo (Opcional):</label>
        <input type="text" id="dyn-efectivo-billete" placeholder="Ej: Sencillo en billetes nuevos" />
      </div>
    `;
  }
}

// =========================================================================
// 3. PROCESAMIENTO Y ENVÍO DE LA ORDEN
// =========================================================================
document.getElementById('form-checkout').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btnSubmit = document.getElementById('btn-submit-orden');
  btnSubmit.disabled = true;
  btnSubmit.innerText = 'Procesando tu orden...';

  try {
    const modalidad = document.getElementById('chk-modalidad').value;
    const metodoPago = metodoSeleccionado;
    const direccion = document.getElementById('chk-direccion').value.trim();
    const archivoCaptura = document.getElementById('chk-captura')?.files[0];

    if (modalidad === 'delivery' && !direccion) {
      throw new Error('Por favor usa el botón de ubicación GPS o escribe tu dirección de entrega.');
    }

    // Construir el resumen detallado de pago según el método elegido
    let referenciaFinal = '';
    let detalleExtraPago = '';

    if (metodoPago === 'pago_movil') {
      const banco = document.getElementById('dyn-pm-banco')?.value || '';
      const tlfOrigen = document.getElementById('dyn-pm-telefono')?.value.trim() || '';
      const ref = document.getElementById('dyn-referencia')?.value.trim() || '';
      if (!banco || !tlfOrigen || !ref) throw new Error('Completa el banco, teléfono origen y referencia del Pago Móvil.');
      referenciaFinal = `${ref} (${banco} - ${tlfOrigen})`;
    } else if (metodoPago === 'binance') {
      const binanceId = document.getElementById('dyn-binance-id')?.value.trim() || '';
      const ref = document.getElementById('dyn-referencia')?.value.trim() || 'S/R';
      if (!binanceId) throw new Error('Ingresa tu Binance UID, Pay ID o Correo desde donde enviaste los USDT.');
      referenciaFinal = `UID/Email: ${binanceId} (Ref: ${ref})`;
    } else if (metodoPago === 'zelle') {
      const titular = document.getElementById('dyn-zelle-titular')?.value.trim() || '';
      const ref = document.getElementById('dyn-referencia')?.value.trim() || '';
      if (!titular || !ref) throw new Error('Ingresa el titular de la cuenta Zelle y la referencia.');
      referenciaFinal = `Zelle: ${titular} (#${ref})`;
    } else if (metodoPago === 'zinli') {
      const emisor = document.getElementById('dyn-zinli-emisor')?.value.trim() || '';
      const ref = document.getElementById('dyn-referencia')?.value.trim() || '';
      if (!emisor || !ref) throw new Error('Ingresa tu usuario Zinli y el número de referencia.');
      referenciaFinal = `Zinli: ${emisor} (#${ref})`;
    } else if (metodoPago === 'punto') {
      const tipoTarjeta = document.getElementById('dyn-punto-tipo')?.value || 'Débito';
      const ref = document.getElementById('dyn-referencia')?.value.trim() || 'Cobrar con punto';
      referenciaFinal = `Punto (${tipoTarjeta}) - ${ref}`;
    } else if (metodoPago === 'efectivo' || metodoPago === 'efectivo_bs') {
      const billete = document.getElementById('dyn-efectivo-billete')?.value.trim() || 'Efectivo exacto';
      referenciaFinal = `EFECTIVO (${billete})`;
      detalleExtraPago = `[Pago con: ${billete}]`;
    }

    // Subir comprobante si el cliente adjuntó imagen
    let urlComprobante = null;
    if (archivoCaptura) {
      const ext = archivoCaptura.name.split('.').pop();
      const fileName = `pagos/${metodoPago}_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from('receipts').upload(fileName, archivoCaptura);
      if (!upErr) {
        const { data: pubUrl } = db.storage.from('receipts').getPublicUrl(fileName);
        urlComprobante = pubUrl.publicUrl;
      }
    }

    const { subtotal, costoDelivery, propina, totalUsd, totalBs } = recalcularTotalesCheckout();

    // Si es efectivo o punto por cobrar al entregar, entra directo a cocina ('pending').
    // Si es transferencia/digital (Pago Móvil, Binance, Zelle, Zinli), pasa por verificación en Admin.
    const requiereVerificacionPrevia = ['pago_movil', 'binance', 'zelle', 'zinli'].includes(metodoPago);
    const estadoInicial = requiereVerificacionPrevia ? 'pending_payment_verification' : 'pending';

    const notasUsuario = document.getElementById('chk-notas').value.trim();
    const notasCompletas = [notasUsuario, detalleExtraPago].filter(Boolean).join(' • ');

    const payloadOrden = {
      business_id: businessId,
      customer_name: document.getElementById('chk-nombre').value.trim(),
      customer_phone: document.getElementById('chk-telefono').value.trim(),
      delivery_type: modalidad,
      delivery_address: modalidad === 'delivery' ? `${direccion} (~${distanciaCalculadaKm.toFixed(1)} km)` : 'Retiro en local (Pickup)',
      map_url: document.getElementById('chk-map-url').value || null,
      notes: notasCompletas,
      payment_method: metodoPago,
      payment_reference: referenciaFinal,
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

    localStorage.setItem('tropicalia_last_order_id', orden.id);
    localStorage.removeItem('tropicalia_cart');

    window.location.href = `tracking.html?order_id=${orden.id}`;

  } catch (err) {
    alert('Error al procesar el pedido: ' + err.message);
    btnSubmit.disabled = false;
    btnSubmit.innerText = 'Confirmar y Enviar Pedido';
  }
});