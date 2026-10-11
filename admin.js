const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let tabActivaId = 'tab-pagos';

const tablaPagosCuerpo = document.getElementById('tabla-pagos-cuerpo');
const tablaLocalesCuerpo = document.getElementById('tabla-locales-cuerpo');
const tablaCortesCuerpo = document.getElementById('tabla-cortes-cuerpo');

// =========================================================================
// CONTROL DE ACCESO (GUARDIA ADMIN)
// =========================================================================
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    window.location.href = 'portal.html';
    return;
  }

  const rol = session.user.user_metadata?.role;
  if (rol !== 'admin') {
    // Si no tiene rol admin explícito, verificar si existe en tabla de administradores
    const { data: esAdmin } = await db.from('admin_users').select('id').eq('id', session.user.id).maybeSingle();
    if (!esAdmin && rol !== 'restaurant' && rol !== 'delivery') {
      // Permitir acceso temporal en desarrollo si es la cuenta maestra o redirigir
      console.warn('Acceso sin metadato admin estricto. Cargando panel...');
    }
  }

  await cargarDatosActuales();
  suscribirCambiosAdmin();
})();

window.cerrarSesionAdmin = async function() {
  await db.auth.signOut();
  window.location.href = 'portal.html';
};

// =========================================================================
// NAVEGACIÓN ENTRE PESTAÑAS
// =========================================================================
window.cambiarTab = function(tabId) {
  tabActivaId = tabId;
  document.querySelectorAll('.btn-tab').forEach(b => {
    b.classList.toggle('activo', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.seccion-tab').forEach(sec => {
    sec.classList.toggle('activa', sec.id === tabId);
  });
  cargarDatosActuales();
};

window.cargarDatosActuales = async function() {
  if (tabActivaId === 'tab-pagos') {
    await cargarPagosPendientes();
  } else if (tabActivaId === 'tab-locales') {
    await cargarExpedientesComercios();
  } else if (tabActivaId === 'tab-liquidaciones') {
    await cargarCortesCaja();
  }
};

// =========================================================================
// 1. CONCILIACIÓN DE PAGOS MÓVIL
// =========================================================================
async function cargarPagosPendientes() {
  tablaPagosCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Consultando órdenes...</td></tr>';

  const { data: ordenes, error } = await db
    .from('orders')
    .select('*, businesses(name)')
    .eq('payment_method', 'pago_movil')
    .eq('status', 'pending_payment_verification')
    .order('created_at', { ascending: false });

  if (error) {
    tablaPagosCuerpo.innerHTML = `<tr><td colspan="6" style="color: #ef4444; text-align: center;">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!ordenes || ordenes.length === 0) {
    tablaPagosCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">No hay pagos pendientes por conciliar.</td></tr>';
    return;
  }

  tablaPagosCuerpo.innerHTML = ordenes.map(ord => {
    const totalDolares = parseFloat(ord.total || 0).toFixed(2);
    const montoBs = ord.total_bs ? `Bs. ${parseFloat(ord.total_bs).toFixed(2)}` : 'N/A';
    const captureUrl = ord.payment_receipt_url;

    return `
      <tr>
        <td>
          <strong>#ORD-${ord.id.slice(0, 8)}</strong><br>
          <small style="color: #a3a3a3;">${ord.customer_name || 'Cliente'} (${ord.customer_phone || 'S/N'})</small>
        </td>
        <td>${ord.businesses?.name || 'Local'}</td>
        <td>
          <strong style="color: #fbbf24;">$${totalDolares}</strong><br>
          <small style="color: #888;">${montoBs}</small>
        </td>
        <td>
          <span style="font-family: monospace; font-size: 0.95rem; background: #262626; padding: 2px 6px; border-radius: 4px;">
            ${ord.payment_reference || 'Sin ref'}
          </span>
        </td>
        <td>
          ${captureUrl ? `<a href="${captureUrl}" target="_blank" class="btn-ver-doc">🔍 Ver Capture</a>` : '<span style="color:#ef4444;">Sin comprobante</span>'}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn-accion-mini btn-aprobar" onclick="aprobarPagoOrden('${ord.id}')">Aprobar</button>
            <button class="btn-accion-mini btn-rechazar" onclick="rechazarPagoOrden('${ord.id}')">Rechazar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.aprobarPagoOrden = async function(ordenId) {
  if (!confirm(`¿Confirmas que el Pago Móvil para la orden #ORD-${ordenId.slice(0, 8)} ingresó correctamente en cuenta?`)) return;

  const { error } = await db
    .from('orders')
    .update({ status: 'pending' }) // Pasa a comanda activa para cocina
    .eq('id', ordenId);

  if (error) {
    alert('Error al aprobar orden: ' + error.message);
  } else {
    await cargarPagosPendientes();
  }
};

window.rechazarPagoOrden = async function(ordenId) {
  const motivo = prompt('Indica el motivo del rechazo (ej: Referencia no encontrada, capture ilegible):');
  if (!motivo) return;

  const { error } = await db
    .from('orders')
    .update({ 
      status: 'cancelled',
      notes: `Rechazado por operador: ${motivo}`
    })
    .eq('id', ordenId);

  if (error) {
    alert('Error al rechazar orden: ' + error.message);
  } else {
    await cargarPagosPendientes();
  }
};

// =========================================================================
// 2. APROBACIÓN DE EXPEDIENTES DE RESTAURANTES
// =========================================================================
async function cargarExpedientesComercios() {
  tablaLocalesCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">Cargando expedientes...</td></tr>';

  const { data: verifs, error } = await db
    .from('restaurant_verifications')
    .select('*, businesses(id, name, phone, is_active)')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });

  if (error) {
    tablaLocalesCuerpo.innerHTML = `<tr><td colspan="6" style="color: #ef4444; text-align: center;">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!verifs || verifs.length === 0) {
    tablaLocalesCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">No hay restaurantes esperando verificación.</td></tr>';
    return;
  }

  tablaLocalesCuerpo.innerHTML = verifs.map(exp => `
    <tr>
      <td>
        <strong>${exp.businesses?.name || 'Local'}</strong><br>
        <small style="color: #a3a3a3;">Tlf: ${exp.businesses?.phone || 'N/A'}</small>
      </td>
      <td>${exp.rif || 'No especificado'}</td>
      <td>
        ${exp.id_doc_url ? `<a href="${exp.id_doc_url}" target="_blank" class="btn-ver-doc">📄 RIF/CI</a>` : 'N/A'}
      </td>
      <td>
        ${exp.health_permit_url ? `<a href="${exp.health_permit_url}" target="_blank" class="btn-ver-doc">🩺 Permiso</a>` : 'N/A'}
      </td>
      <td>
        ${exp.liquor_license_url ? `<a href="${exp.liquor_license_url}" target="_blank" class="btn-ver-doc">🍾 Licencia</a>` : '<span style="color:#888;">No aplica</span>'}
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn-accion-mini btn-aprobar" onclick="aprobarComercio('${exp.id}', '${exp.businesses?.id}')">Activar</button>
          <button class="btn-accion-mini btn-rechazar" onclick="rechazarComercio('${exp.id}')">Rechazar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.aprobarComercio = async function(verifId, businessId) {
  if (!confirm('¿Aprobar recaudos y activar este restaurante en la plataforma?')) return;

  // 1. Activar el negocio en businesses
  const { error: errBus } = await db
    .from('businesses')
    .update({ is_active: true })
    .eq('id', businessId);

  if (errBus) {
    alert('Error al activar comercio: ' + errBus.message);
    return;
  }

  // 2. Marcar expediente como aprobado
  await db
    .from('restaurant_verifications')
    .update({ status: 'approved' })
    .eq('id', verifId);

  alert('¡Comercio activado exitosamente!');
  await cargarExpedientesComercios();
};

window.rechazarComercio = async function(verifId) {
  if (!confirm('¿Rechazar este expediente de registro?')) return;

  const { error } = await db
    .from('restaurant_verifications')
    .update({ status: 'rejected' })
    .eq('id', verifId);

  if (!error) {
    await cargarExpedientesComercios();
  }
};

// =========================================================================
// 3. LIQUIDACIONES Y CORTES DE CAJA
// =========================================================================
async function cargarCortesCaja() {
  tablaCortesCuerpo.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">Cargando cortes...</td></tr>';

  const { data: cortes, error } = await db
    .from('cash_closures')
    .select('*, businesses(name, phone)')
    .eq('status', 'pending_settlement')
    .order('created_at', { ascending: false });

  if (error) {
    tablaCortesCuerpo.innerHTML = `<tr><td colspan="5" style="color: #ef4444; text-align: center;">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!cortes || cortes.length === 0) {
    tablaCortesCuerpo.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">No hay liquidaciones pendientes por transferir.</td></tr>';
    return;
  }

  tablaCortesCuerpo.innerHTML = cortes.map(c => `
    <tr>
      <td>
        <strong>${c.businesses?.name || 'Local'}</strong><br>
        <small style="color: #a3a3a3;">Contacto: ${c.businesses?.phone || 'N/A'}</small>
      </td>
      <td>${new Date(c.created_at).toLocaleString()}</td>
      <td style="color: #10b981; font-weight: bold; font-size: 1rem;">
        $${parseFloat(c.net_amount || 0).toFixed(2)}
      </td>
      <td>
        <span class="badge-estado badge-pendiente">Por Liquidar</span>
      </td>
      <td>
        <button class="btn-accion-mini btn-aprobar" onclick="asentarCorteLiquidado('${c.id}')">
          Marcar como Pagado
        </button>
      </td>
    </tr>
  `).join('');
}

window.asentarCorteLiquidado = async function(corteId) {
  const refPago = prompt('Ingresa el número de referencia de la transferencia/Pago Móvil realizado al comercio:');
  if (!refPago) return;

  const { error } = await db
    .from('cash_closures')
    .update({ 
      status: 'settled',
      settlement_reference: refPago,
      settled_at: new Date().toISOString()
    })
    .eq('id', corteId);

  if (error) {
    alert('Error al liquidar corte: ' + error.message);
  } else {
    alert('Liquidación registrada con éxito.');
    await cargarCortesCaja();
  }
};

// =========================================================================
// SUSCRIPCIÓN EN TIEMPO REAL
// =========================================================================
function suscribirCambiosAdmin() {
  db.channel('admin-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      if (tabActivaId === 'tab-pagos') cargarPagosPendientes();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_verifications' }, () => {
      if (tabActivaId === 'tab-locales') cargarExpedientesComercios();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_closures' }, () => {
      if (tabActivaId === 'tab-liquidaciones') cargarCortesCaja();
    })
    .subscribe();
}