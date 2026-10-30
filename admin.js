const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let tabActivaId = 'tab-activas';
let chartGlobal = null;
let periodoChartAdmin = 'semana';
let cacheOrdenesGlobal = [];
let cacheComandasActivas = [];
let filtroComandasActivasActual = 'todas';
let filtroAuditoriaActual = 'todas';

// Elementos DOM
const tablaComandasActivasCuerpo = document.getElementById('tabla-comandas-activas-cuerpo');
const tablaPagosCuerpo = document.getElementById('tabla-pagos-cuerpo');
const tablaLocalesCuerpo = document.getElementById('tabla-locales-cuerpo');
const tablaComerciosActivos = document.getElementById('tabla-comercios-activos');
const tablaCortesCuerpo = document.getElementById('tabla-cortes-cuerpo');
const tablaDriversCuerpo = document.getElementById('tabla-drivers-cuerpo');
const tablaTodasOrdenes = document.getElementById('tabla-todas-ordenes');

// =========================================================================
// UTILIDADES Y TOAST
// =========================================================================
function showToast(mensaje) {
  const toast = document.getElementById('toast-notif');
  if (!toast) return;
  toast.innerText = mensaje;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 4000);
}

// =========================================================================
// 1. SESIÓN Y CONTROL
// =========================================================================
window.cerrarSesionAdmin = async function() {
  try {
    await db.auth.signOut();
  } catch (e) {
    console.warn('Cierre forzado:', e);
  } finally {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('portal.html');
  }
};

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    window.location.replace('portal.html');
    return;
  }

  await recargarTodoAdmin();
  suscribirCambiosAdmin();
})();

window.cambiarTab = function(tabId) {
  tabActivaId = tabId;
  document.querySelectorAll('.btn-tab').forEach(b => {
    b.classList.toggle('activo', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.seccion-tab').forEach(sec => {
    sec.classList.toggle('activa', sec.id === tabId);
  });
  if (tabId === 'tab-analitica') {
    dibujarGraficoAdmin();
  }
};

window.recargarTodoAdmin = async function() {
  await Promise.all([
    cargarComandasActivas(),
    cargarPagosPendientes(),
    cargarCortesCaja(),
    cargarFlotaRepartidores(),
    cargarComerciosYExpedientes(),
    cargarResumenGlobalYOrdenes()
  ]);
};

// =========================================================================
// 2. GESTIÓN Y CIERRE DE COMANDAS ACTIVAS EN CUALQUIER MOMENTO
// =========================================================================
async function cargarComandasActivas() {
  const { data: ordenes, error } = await db
    .from('orders')
    .select('*, businesses(name, phone), driver_profiles(full_name, phone)')
    .not('status', 'in', '("delivered","cancelled","rejected")')
    .order('created_at', { ascending: false });

  if (error) {
    tablaComandasActivasCuerpo.innerHTML = `<tr><td colspan="8" style="color: #ef4444; text-align: center;">Error al cargar comandas activas: ${error.message}</td></tr>`;
    return;
  }

  cacheComandasActivas = ordenes || [];

  const cant = cacheComandasActivas.length;
  document.getElementById('kpi-comandas-activas').innerText = cant;
  const badgeActivas = document.getElementById('badge-count-activas');
  if (badgeActivas) {
    badgeActivas.style.display = cant > 0 ? 'inline-block' : 'none';
    badgeActivas.innerText = cant;
  }

  renderizarTablaComandasActivas();
}

window.filtrarComandasActivas = function(filtro) {
  filtroComandasActivasActual = filtro;
  ['todas', 'cocina', 'reparto'].forEach(f => {
    document.getElementById(`btn-filtro-act-${f}`)?.classList.toggle('active', f === filtro);
  });
  renderizarTablaComandasActivas();
};

function renderizarTablaComandasActivas() {
  let filtradas = [...cacheComandasActivas];
  if (filtroComandasActivasActual === 'cocina') {
    filtradas = filtradas.filter(o => ['pending', 'in_kitchen', 'ready_for_pickup'].includes(o.status));
  } else if (filtroComandasActivasActual === 'reparto') {
    filtradas = filtradas.filter(o => ['assigned', 'arrived_at_store', 'on_the_way'].includes(o.delivery_status) || o.status === 'out_for_delivery');
  }

  if (filtradas.length === 0) {
    tablaComandasActivasCuerpo.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #888; padding: 22px;">⚡ No hay comandas activas en este momento. ¡Todo despachado!</td></tr>`;
    return;
  }

  tablaComandasActivasCuerpo.innerHTML = filtradas.map(ord => {
    const hora = new Date(ord.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const totalDolares = parseFloat(ord.total || 0).toFixed(2);
    const modalidad = ord.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup';
    const metodoPago = (ord.payment_method || 'Digital').toUpperCase().replace(/_/g, ' ');
    const driver = ord.driver_profiles?.full_name ? `🛵 ${ord.driver_profiles.full_name}` : '<span style="color:#64748b;">Sin asignar</span>';

    let badgeClass = 'badge-pendiente';
    let estadoTexto = ord.status;
    if (['in_kitchen', 'pending'].includes(ord.status)) {
      badgeClass = 'badge-cocina';
      estadoTexto = ord.status === 'in_kitchen' ? 'En Cocina' : 'Pendiente';
    } else if (['ready_for_pickup', 'out_for_delivery'].includes(ord.status) || ord.delivery_status === 'on_the_way') {
      badgeClass = 'badge-reparto';
      estadoTexto = ord.delivery_status === 'on_the_way' ? 'En Camino' : 'Lista para Entrega';
    } else if (ord.status === 'pending_payment_verification') {
      badgeClass = 'badge-pendiente';
      estadoTexto = 'Por Verificar Pago';
    }

    return `
      <tr>
        <td>
          <strong style="color: var(--primary);">#ORD-${ord.id.slice(0, 8)}</strong><br>
          <small style="color: #94a3b8;">Hoy ${hora}</small>
        </td>
        <td>
          <strong style="color: #f1f5f9;">${ord.businesses?.name || 'Local'}</strong>
        </td>
        <td>
          <strong>${ord.customer_name || 'Cliente'}</strong><br>
          <small style="color: #94a3b8;">${ord.customer_phone || 'S/N'}</small>
        </td>
        <td>
          <span style="font-size: 0.8rem; font-weight: 600;">${modalidad}</span><br>
          <small style="color: #94a3b8;">${metodoPago}</small>
        </td>
        <td>
          <strong style="color: #10b981; font-size: 0.96rem;">$${totalDolares}</strong>
        </td>
        <td>
          <span class="badge-estado ${badgeClass}">${estadoTexto}</span>
        </td>
        <td>
          <span style="font-size: 0.82rem;">${driver}</span>
        </td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn-accion-mini btn-cerrar-entregada" onclick="forzarCierreEntregada('${ord.id}')" title="Marcar como entregada exitosamente">
              ✓ Entregada
            </button>
            <button type="button" class="btn-accion-mini btn-cerrar-cancelada" onclick="forzarCierreCancelada('${ord.id}')" title="Cancelar comanda y devolver stock a cocina">
              ✕ Cancelar y Revertir
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// REVERSIÓN DE INSUMOS Y CANCELACIÓN AUTOMÁTICA EN SUPABASE
// =========================================================================
async function revertirStockDeOrdenEnAdmin(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const items = order.items;
    const businessId = order.business_id;

    const productIds = items.map(i => i.product_id || i.id).filter(Boolean);

    let recetas = [];
    if (productIds.length > 0) {
      const { data: recData } = await db
        .from('product_recipes')
        .select('*')
        .in('product_id', productIds);
      recetas = recData || [];
    }

    const { data: insumos } = await db
      .from('inventory_items')
      .select('*')
      .eq('business_id', businessId);

    const insumosMap = new Map((insumos || []).map(i => [i.id, i]));
    const insumosPorNombre = new Map((insumos || []).map(i => [(i.name || '').toLowerCase().trim(), i]));

    let revertedCount = 0;

    for (const item of items) {
      const prodId = item.product_id || item.id;
      const cantOrdenada = parseInt(item.quantity || 1, 10);
      const recsDelPlato = recetas.filter(r => r.product_id === prodId);

      if (recsDelPlato.length > 0) {
        for (const r of recsDelPlato) {
          const ins = insumosMap.get(r.inventory_item_id);
          if (ins) {
            const devuelto = parseFloat(r.quantity_required || 0) * cantOrdenada;
            const nuevaCantidad = parseFloat(ins.quantity || 0) + devuelto;

            await db
              .from('inventory_items')
              .update({ quantity: nuevaCantidad })
              .eq('id', ins.id);

            ins.quantity = nuevaCantidad;
            revertedCount++;
          }
        }
      } else {
        const nombreItem = (item.name || '').toLowerCase().trim();
        const insDirecto = insumosPorNombre.get(nombreItem);
        if (insDirecto) {
          const nuevaCantidad = parseFloat(insDirecto.quantity || 0) + cantOrdenada;
          await db
            .from('inventory_items')
            .update({ quantity: nuevaCantidad })
            .eq('id', insDirecto.id);

          insDirecto.quantity = nuevaCantidad;
          revertedCount++;
        }
      }
    }

    // Registrar en bitácora de cocina
    try {
      await db.from('kitchen_logs').insert([{
        business_id: businessId,
        log_type: 'reversion_cancelacion',
        item_name: `Orden #${order.id.slice(0, 8)}`,
        quantity: items.length,
        amount_usd: parseFloat(order.total || 0),
        notes: `Cierre forzado Admin: reversión automática de insumos devueltos al stock (${revertedCount} items/insumos restaurados)`
      }]);
    } catch (e) {
      // Ignorar fallback de constraint si aplica
    }

    return { success: true, count: revertedCount };
  } catch (err) {
    console.error('Error al revertir stock:', err);
    return { success: false, error: err.message };
  }
}

// Acción: Forzar Cierre Entregada
window.forzarCierreEntregada = async function(ordenId) {
  if (!confirm(`¿Confirmas que deseas cerrar la orden #${ordenId.slice(0, 8)} como ENTREGADA exitosamente?`)) return;

  try {
    const { error } = await db
      .from('orders')
      .update({
        status: 'delivered',
        delivery_status: 'delivered'
      })
      .eq('id', ordenId);

    if (error) throw error;
    showToast('✅ Comanda cerrada exitosamente con estado ENTREGADA.');
    await recargarTodoAdmin();
  } catch (err) {
    alert('Error al cerrar orden: ' + err.message);
  }
};

// Acción: Forzar Cierre Cancelada con Reversión de Insumos
window.forzarCierreCancelada = async function(ordenId) {
  const motivo = prompt(`Indica el motivo de cancelación administrativa de la comanda #${ordenId.slice(0, 8)}:\n(Los ingredientes y artículos se devolverán automáticamente al stock)`);
  if (!motivo) return;

  try {
    const { data: orden, error: ordErr } = await db
      .from('orders')
      .select('*')
      .eq('id', ordenId)
      .single();

    if (ordErr || !orden) throw new Error(ordErr?.message || 'No se localizó la orden.');

    // 1. Revertir insumos de inventario
    const revResult = await revertirStockDeOrdenEnAdmin(orden);

    // 2. Marcar orden como cancelada
    const { error: cancelErr } = await db
      .from('orders')
      .update({
        status: 'cancelled',
        delivery_status: 'cancelled',
        notes: `Cancelada por Administración: ${motivo.trim()}`
      })
      .eq('id', ordenId);

    if (cancelErr) throw cancelErr;

    showToast(`❌ Comanda #${ordenId.slice(0, 8)} cancelada y cerrada. Se reintegraron ${revResult.count || 0} ingredientes al inventario.`);
    await recargarTodoAdmin();
  } catch (err) {
    alert('Error al cancelar comanda: ' + err.message);
  }
};

// =========================================================================
// 3. CONCILIACIÓN DE PAGOS DIGITALES
// =========================================================================
async function cargarPagosPendientes() {
  const { data: ordenes, error } = await db
    .from('orders')
    .select('*, businesses(name)')
    .eq('status', 'pending_payment_verification')
    .order('created_at', { ascending: false });

  if (error) {
    tablaPagosCuerpo.innerHTML = `<tr><td colspan="7" style="color: #ef4444; text-align: center;">Error: ${error.message}</td></tr>`;
    return;
  }

  const lista = ordenes || [];
  document.getElementById('kpi-pagos-pendientes').innerText = lista.length;
  const badgePagos = document.getElementById('badge-count-pagos');
  if (badgePagos) {
    badgePagos.style.display = lista.length > 0 ? 'inline-block' : 'none';
    badgePagos.innerText = lista.length;
  }

  if (lista.length === 0) {
    tablaPagosCuerpo.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 20px;">✅ No hay pagos pendientes por conciliar.</td></tr>';
    return;
  }

  tablaPagosCuerpo.innerHTML = lista.map(ord => {
    const totalDolares = parseFloat(ord.total || 0).toFixed(2);
    const montoBs = ord.total_bs ? `Bs. ${parseFloat(ord.total_bs).toFixed(2)}` : '';
    const captureUrl = ord.payment_receipt_url;
    const metodo = (ord.payment_method || 'Digital').toUpperCase().replace(/_/g, ' ');
    const fecha = new Date(ord.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <tr>
        <td>
          <strong style="color: var(--primary);">#ORD-${ord.id.slice(0, 8)}</strong><br>
          <small style="color: #888;">Hoy ${fecha}</small>
        </td>
        <td>
          <strong>${ord.customer_name || 'Cliente'}</strong><br>
          <small style="color: #a3a3a3;">${ord.customer_phone || 'S/N'}</small>
        </td>
        <td>${ord.businesses?.name || 'Local'}</td>
        <td>
          <span class="badge-estado badge-pendiente">${metodo}</span><br>
          <strong style="color: #34d399; font-size: 0.95rem;">$${totalDolares}</strong>
          ${montoBs ? `<small style="color: #888; display:block;">${montoBs}</small>` : ''}
        </td>
        <td>
          <span style="font-family: monospace; font-size: 0.88rem; background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; color: #fff;">
            Ref: ${ord.payment_reference || 'N/A'}
          </span>
          ${ord.notes ? `<div style="font-size:0.75rem; color:#9ca3af; margin-top:4px;">${ord.notes}</div>` : ''}
        </td>
        <td>
          ${captureUrl ? `<a href="${captureUrl}" target="_blank" class="btn-ver-doc">🔍 Ver Capture</a>` : '<span style="color:#888; font-size:0.78rem;">Sin adjunto</span>'}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-accion-mini btn-aprobar" onclick="aprobarPagoOrden('${ord.id}')">✓ Aprobar</button>
            <button type="button" class="btn-accion-mini btn-rechazar" onclick="rechazarPagoOrden('${ord.id}')">✕ Rechazar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.aprobarPagoOrden = async function(ordenId) {
  if (!confirm(`¿Confirmas que el pago de la orden #ORD-${ordenId.slice(0, 8)} es válido? Pasará directo a cocina.`)) return;

  const { error } = await db
    .from('orders')
    .update({ status: 'pending' })
    .eq('id', ordenId);

  if (error) {
    alert('Error al aprobar orden: ' + error.message);
  } else {
    showToast('✅ Pago aprobado y orden enviada a cocina.');
    await recargarTodoAdmin();
  }
};

window.rechazarPagoOrden = async function(ordenId) {
  const motivo = prompt('Indica el motivo del rechazo del comprobante de pago:');
  if (!motivo) return;

  try {
    const { data: orden } = await db.from('orders').select('*').eq('id', ordenId).single();
    if (orden) {
      await revertirStockDeOrdenEnAdmin(orden);
    }
    await db
      .from('orders')
      .update({
        status: 'cancelled',
        delivery_status: 'cancelled',
        notes: `Pago rechazado por Administración: ${motivo}`
      })
      .eq('id', ordenId);

    showToast('❌ Pago rechazado y comanda cancelada.');
    await recargarTodoAdmin();
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

// =========================================================================
// 4. CORTES DE CAJA Y LIQUIDACIONES A RESTAURANTES
// =========================================================================
async function cargarCortesCaja() {
  const { data: cortes, error } = await db
    .from('cash_closures')
    .select('*, businesses(name, phone)')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    tablaCortesCuerpo.innerHTML = `<tr><td colspan="7" style="color: #ef4444; text-align: center;">Error: ${error.message}</td></tr>`;
    return;
  }

  const lista = cortes || [];
  const pendientesCount = lista.filter(c => c.status === 'pending_settlement').length;
  const badgeCortes = document.getElementById('badge-count-cortes');
  if (badgeCortes) {
    badgeCortes.style.display = pendientesCount > 0 ? 'inline-block' : 'none';
    badgeCortes.innerText = pendientesCount;
  }

  if (lista.length === 0) {
    tablaCortesCuerpo.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 18px;">No hay cortes de caja registrados aún.</td></tr>';
    return;
  }

  tablaCortesCuerpo.innerHTML = lista.map(c => {
    const bruto = parseFloat(c.gross_amount || 0).toFixed(2);
    const comision = parseFloat(c.commission_amount || 0).toFixed(2);
    const neto = parseFloat(c.net_amount || 0).toFixed(2);
    const pendiente = c.status === 'pending_settlement';

    return `
      <tr>
        <td>
          <strong>${c.businesses?.name || 'Local'}</strong><br>
          <small style="color: #a3a3a3;">Tlf: ${c.businesses?.phone || 'N/A'}</small>
        </td>
        <td>${new Date(c.created_at).toLocaleString()}</td>
        <td>$${bruto}</td>
        <td style="color: var(--primary); font-weight: 600;">$${comision}</td>
        <td style="color: #10b981; font-weight: bold; font-size: 0.98rem;">$${neto}</td>
        <td>
          ${pendiente
            ? `<span class="badge-estado badge-pendiente">Por Liquidar</span>`
            : `<span class="badge-estado badge-aprobado">Pagado (${c.settlement_reference || 'OK'})</span>`
          }
        </td>
        <td>
          ${pendiente
            ? `<button type="button" class="btn-accion-mini btn-aprobar" onclick="asentarCorteLiquidado('${c.id}')">Marcar Transferido</button>`
            : `<small style="color:#888;">Liquidado</small>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

window.asentarCorteLiquidado = async function(corteId) {
  const refPago = prompt('Ingresa el número de referencia de la transferencia enviada al restaurante:');
  if (!refPago) return;

  const { error } = await db
    .from('cash_closures')
    .update({
      status: 'settled',
      settlement_reference: refPago.trim(),
      settled_at: new Date().toISOString()
    })
    .eq('id', corteId);

  if (error) {
    alert('Error al liquidar corte: ' + error.message);
  } else {
    showToast('✅ Liquidación registrada con éxito.');
    await cargarCortesCaja();
  }
};

// =========================================================================
// 5. FLOTA DE REPARTIDORES Y CONTROL DE DEUDAS ($25.00)
// =========================================================================
async function cargarFlotaRepartidores() {
  const { data: perfiles } = await db.from('driver_profiles').select('*').order('full_name', { ascending: true });
  const { data: wallets } = await db.from('delivery_wallets').select('*');

  const listaPerfiles = perfiles || [];
  const listaWallets = wallets || [];

  let deudaTotal = 0;
  listaWallets.forEach(w => { deudaTotal += parseFloat(w.cash_debt || 0); });
  document.getElementById('kpi-deuda-drivers').innerText = `$${deudaTotal.toFixed(2)}`;

  if (listaPerfiles.length === 0) {
    tablaDriversCuerpo.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 18px;">No hay repartidores registrados.</td></tr>';
    return;
  }

  tablaDriversCuerpo.innerHTML = listaPerfiles.map(d => {
    const w = listaWallets.find(x => x.driver_id === d.id) || { prepaid_balance: 0, cash_debt: 0, is_blocked: false };
    const saldo = parseFloat(w.prepaid_balance || 0);
    const deuda = parseFloat(w.cash_debt || 0);
    // Techo actualizado a $25.00
    const bloqueado = deuda >= 25.00 || w.is_blocked;

    const pmInfo = (d.pagomovil_bank || d.pagomovil_phone)
      ? `<div style="font-size:0.75rem; color:#cbd5e1;"><strong>${d.pagomovil_bank || 'Banco'}</strong><br>${d.pagomovil_id || ''} • ${d.pagomovil_phone || ''}</div>`
      : `<span style="font-size:0.75rem; color:#64748b;">No configurado</span>`;

    return `
      <tr>
        <td>
          <strong>${d.full_name || 'Repartidor'}</strong><br>
          <small style="color: #94a3b8;">${d.phone || 'S/N'} • ${d.vehicle_type || 'Moto'}</small>
        </td>
        <td>
          <span class="badge-estado ${d.is_online ? 'badge-aprobado' : 'badge-pendiente'}">
            ${d.is_online ? '🟢 En Línea' : '⚪ Offline'}
          </span>
        </td>
        <td>${pmInfo}</td>
        <td style="color: #34d399; font-weight: bold;">$${saldo.toFixed(2)}</td>
        <td style="color: ${deuda >= 25 ? '#ef4444' : deuda > 0 ? '#fbbf24' : '#94a3b8'}; font-weight: bold;">
          $${deuda.toFixed(2)} / $25.00
        </td>
        <td>
          ${bloqueado
            ? `<span class="badge-estado badge-rechazado">🔒 Bloqueado Efectivo</span>`
            : `<span class="badge-estado badge-aprobado">Habilitado</span>`
          }
        </td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn-accion-mini btn-aprobar" onclick="recibirEfectivoDriver('${d.id}', '${(d.full_name || '').replace(/'/g, "\\'")}', ${deuda})" ${deuda <= 0 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
              💵 Recibir Efectivo (Saldar)
            </button>
            <button type="button" class="btn-accion-mini" style="background:#2563eb; color:#fff;" onclick="pagarSaldoDriver('${d.id}', '${(d.full_name || '').replace(/'/g, "\\'")}', ${saldo})" ${saldo <= 0 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
              📲 Liquidar Fletes
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.recibirEfectivoDriver = async function(driverId, nombre, deudaActual) {
  const montoStr = prompt(`El repartidor ${nombre} tiene una deuda de $${deudaActual.toFixed(2)} en efectivo.\n¿Cuánto dinero te entrega en caja para saldar?`, deudaActual.toFixed(2));
  if (!montoStr) return;
  const abono = parseFloat(montoStr);
  if (isNaN(abono) || abono <= 0) return;

  const nuevaDeuda = Math.max(0, deudaActual - abono);
  const { error } = await db.from('delivery_wallets').update({
    cash_debt: nuevaDeuda,
    is_blocked: nuevaDeuda >= 25.00
  }).eq('driver_id', driverId);

  if (!error) {
    try {
      await db.from('delivery_transactions').insert([{
        driver_id: driverId,
        amount: abono,
        type: 'debt_payment',
        notes: 'Entrega de efectivo en caja administrativa'
      }]);
    } catch(e) {}
    showToast(`✅ Deuda saldada. Nueva deuda de ${nombre}: $${nuevaDeuda.toFixed(2)}`);
    await cargarFlotaRepartidores();
  }
};

window.pagarSaldoDriver = async function(driverId, nombre, saldoActual) {
  if (!confirm(`¿Confirmas que transferiste los $${saldoActual.toFixed(2)} de ganancias acumuladas a ${nombre}?`)) return;

  const { error } = await db.from('delivery_wallets').update({
    prepaid_balance: 0
  }).eq('driver_id', driverId);

  if (!error) {
    try {
      await db.from('delivery_transactions').insert([{
        driver_id: driverId,
        amount: saldoActual,
        type: 'payout',
        notes: 'Liquidación administrativa de ganancias acumuladas'
      }]);
    } catch(e) {}
    showToast(`✅ Ganancias de ${nombre} liquidadas a $0.00.`);
    await cargarFlotaRepartidores();
  }
};

// =========================================================================
// 6. COMERCIOS ACTIVOS Y EXPEDIENTES
// =========================================================================
async function cargarComerciosYExpedientes() {
  const { data: locales } = await db.from('businesses').select('*').order('created_at', { ascending: true });
  const listaLocales = locales || [];

  if (listaLocales.length === 0) {
    tablaComerciosActivos.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">No hay restaurantes creados.</td></tr>';
  } else {
    tablaComerciosActivos.innerHTML = listaLocales.map(b => `
      <tr>
        <td><strong style="color:#fff;">${b.name}</strong></td>
        <td>${b.phone || 'S/N'} • <small style="color:#888;">${b.address || 'Caracas'}</small></td>
        <td><code style="font-size:0.75rem; color:#9ca3af;">${b.owner_id || 'Sin vincular'}</code></td>
        <td>
          <span class="badge-estado ${b.is_active ? 'badge-aprobado' : 'badge-rechazado'}">
            ${b.is_active ? '🟢 Abierto' : '🔴 Pausado'}
          </span>
        </td>
        <td>
          <button type="button" class="btn-accion-mini ${b.is_active ? 'btn-rechazar' : 'btn-aprobar'}" onclick="toggleComercioAdmin('${b.id}', ${b.is_active})">
            ${b.is_active ? 'Pausar Local' : 'Activar Local'}
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Expedientes legales pendientes
  const { data: verifs } = await db
    .from('restaurant_verifications')
    .select('*, businesses(id, name, phone, is_active)')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });

  if (!verifs || verifs.length === 0) {
    tablaLocalesCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 16px;">No hay expedientes pendientes de verificación.</td></tr>';
    return;
  }

  tablaLocalesCuerpo.innerHTML = verifs.map(exp => `
    <tr>
      <td>
        <strong>${exp.businesses?.name || 'Local'}</strong><br>
        <small style="color: #a3a3a3;">Tlf: ${exp.businesses?.phone || 'N/A'}</small>
      </td>
      <td>${exp.rif || 'No especificado'}</td>
      <td>${exp.id_doc_url ? `<a href="${exp.id_doc_url}" target="_blank" class="btn-ver-doc">📄 RIF/CI</a>` : 'N/A'}</td>
      <td>${exp.health_permit_url ? `<a href="${exp.health_permit_url}" target="_blank" class="btn-ver-doc">🩺 Permiso</a>` : 'N/A'}</td>
      <td>${exp.liquor_license_url ? `<a href="${exp.liquor_license_url}" target="_blank" class="btn-ver-doc">🍾 Licencia</a>` : '<span style="color:#888;">No aplica</span>'}</td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn-accion-mini btn-aprobar" onclick="aprobarComercio('${exp.id}', '${exp.businesses?.id}')">Activar</button>
          <button type="button" class="btn-accion-mini btn-rechazar" onclick="rechazarComercio('${exp.id}')">Rechazar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.toggleComercioAdmin = async function(id, estadoActual) {
  await db.from('businesses').update({ is_active: !estadoActual }).eq('id', id);
  await cargarComerciosYExpedientes();
};

window.aprobarComercio = async function(verifId, businessId) {
  if (!confirm('¿Aprobar recaudos y activar este restaurante en la plataforma?')) return;
  await db.from('businesses').update({ is_active: true }).eq('id', businessId);
  await db.from('restaurant_verifications').update({ status: 'approved' }).eq('id', verifId);
  await cargarComerciosYExpedientes();
};

window.rechazarComercio = async function(verifId) {
  if (!confirm('¿Rechazar este expediente de registro?')) return;
  await db.from('restaurant_verifications').update({ status: 'rejected' }).eq('id', verifId);
  await cargarComerciosYExpedientes();
};

// =========================================================================
// 7. ANALÍTICA GLOBAL Y AUDITORÍA DE ÓRDENES
// =========================================================================
async function cargarResumenGlobalYOrdenes() {
  const { data: ordenes } = await db
    .from('orders')
    .select('*, businesses(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  cacheOrdenesGlobal = ordenes || [];

  const entregadas = cacheOrdenesGlobal.filter(o => o.status === 'delivered');
  const volumenBruto = entregadas.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);
  const comisionTotal = volumenBruto * 0.10;

  document.getElementById('kpi-volumen-bruto').innerText = `$${volumenBruto.toFixed(2)}`;
  document.getElementById('kpi-comision-admin').innerText = `$${comisionTotal.toFixed(2)}`;

  renderizarAuditoriaOrdenes();
  dibujarGraficoAdmin();
}

window.filtrarAuditoriaOrdenes = function(filtro) {
  filtroAuditoriaActual = filtro;
  renderizarAuditoriaOrdenes();
};

function renderizarAuditoriaOrdenes() {
  let lista = [...cacheOrdenesGlobal];
  if (filtroAuditoriaActual === 'activas') {
    lista = lista.filter(o => !['delivered', 'cancelled', 'rejected'].includes(o.status));
  } else if (filtroAuditoriaActual === 'delivered') {
    lista = lista.filter(o => o.status === 'delivered');
  } else if (filtroAuditoriaActual === 'cancelled') {
    lista = lista.filter(o => o.status === 'cancelled');
  }

  if (lista.length === 0) {
    tablaTodasOrdenes.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 18px;">No hay órdenes para este criterio.</td></tr>';
    return;
  }

  tablaTodasOrdenes.innerHTML = lista.slice(0, 30).map(o => {
    const esActiva = !['delivered', 'cancelled', 'rejected'].includes(o.status);

    return `
      <tr>
        <td><strong>#ORD-${o.id.slice(0, 8)}</strong><br><small style="color:#888;">${new Date(o.created_at).toLocaleString()}</small></td>
        <td>${o.businesses?.name || 'Local'}</td>
        <td>${o.customer_name || 'Cliente'}<br><small style="color:#888;">${o.customer_phone || ''}</small></td>
        <td>${o.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'} • <small>${(o.payment_method || '').toUpperCase()}</small></td>
        <td style="color:var(--primary); font-weight:bold;">$${parseFloat(o.total || 0).toFixed(2)}</td>
        <td><span class="badge-estado ${o.status === 'delivered' ? 'badge-aprobado' : o.status === 'cancelled' ? 'badge-rechazado' : 'badge-pendiente'}">${o.status.toUpperCase()}</span></td>
        <td>
          ${esActiva
            ? `<div style="display:flex; gap:4px;">
                 <button type="button" class="btn-accion-mini btn-cerrar-entregada" onclick="forzarCierreEntregada('${o.id}')">✓ Entregada</button>
                 <button type="button" class="btn-accion-mini btn-cerrar-cancelada" onclick="forzarCierreCancelada('${o.id}')">✕ Cancelar</button>
               </div>`
            : `<small style="color:#64748b;">Cerrada</small>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

window.cambiarPeriodoChartAdmin = function(periodo) {
  periodoChartAdmin = periodo;
  ['dia', 'semana', 'mes', 'anio'].forEach(p => {
    document.getElementById(`btn-adm-${p}`)?.classList.toggle('active', p === periodo);
  });
  dibujarGraficoAdmin();
};

function dibujarGraficoAdmin() {
  const canvas = document.getElementById('chartGlobalAdmin');
  if (!canvas) return;

  const entregadas = cacheOrdenesGlobal.filter(o => o.status === 'delivered');
  const ahora = new Date();
  let labels = [];
  let valores = [];

  if (periodoChartAdmin === 'dia') {
    labels = ['00-04h', '04-08h', '08-12h', '12-16h', '16-20h', '20-24h'];
    valores = new Array(6).fill(0);
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
    entregadas.forEach(o => {
      const f = new Date(o.created_at);
      if (f.getTime() >= inicioHoy) {
        const idx = Math.min(5, Math.floor(f.getHours() / 4));
        valores[idx] += parseFloat(o.total || 0);
      }
    });
  } else if (periodoChartAdmin === 'semana') {
    const mapa = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(ahora.getDate() - i);
      mapa[d.toISOString().split('T')[0]] = 0;
    }
    entregadas.forEach(o => {
      const k = o.created_at.split('T')[0];
      if (mapa[k] !== undefined) mapa[k] += parseFloat(o.total || 0);
    });
    labels = Object.keys(mapa).map(k => { const p = k.split('-'); return `${p[2]}/${p[1]}`; });
    valores = Object.values(mapa);
  } else if (periodoChartAdmin === 'mes') {
    labels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
    valores = [0, 0, 0, 0];
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
    entregadas.forEach(o => {
      const f = new Date(o.created_at);
      if (f.getTime() >= inicioMes) {
        valores[Math.min(3, Math.floor((f.getDate() - 1) / 7))] += parseFloat(o.total || 0);
      }
    });
  } else {
    labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    valores = new Array(12).fill(0);
    entregadas.forEach(o => {
      const f = new Date(o.created_at);
      if (f.getFullYear() === ahora.getFullYear()) {
        valores[f.getMonth()] += parseFloat(o.total || 0);
      }
    });
  }

  if (chartGlobal) chartGlobal.destroy();
  chartGlobal = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ventas Globales ($)',
        data: valores,
        backgroundColor: '#ef9d24',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#94a3b8' } },
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
      }
    }
  });
}

function suscribirCambiosAdmin() {
  db.channel('admin-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => recargarTodoAdmin())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_closures' }, () => cargarCortesCaja())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_wallets' }, () => cargarFlotaRepartidores())
    .subscribe();
}
