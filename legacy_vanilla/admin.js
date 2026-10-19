const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let tabActivaId = 'tab-pagos';
let chartGlobal = null;
let periodoChartAdmin = 'semana';
let cacheOrdenesGlobal = [];

// Elementos DOM
const tablaPagosCuerpo = document.getElementById('tabla-pagos-cuerpo');
const tablaLocalesCuerpo = document.getElementById('tabla-locales-cuerpo');
const tablaComerciosActivos = document.getElementById('tabla-comercios-activos');
const tablaCortesCuerpo = document.getElementById('tabla-cortes-cuerpo');
const tablaDriversCuerpo = document.getElementById('tabla-drivers-cuerpo');
const tablaTodasOrdenes = document.getElementById('tabla-todas-ordenes');

// =========================================================================
// 1. SESIÓN Y SALIDA SEGURA
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
    cargarPagosPendientes(),
    cargarCortesCaja(),
    cargarFlotaRepartidores(),
    cargarComerciosYExpedientes(),
    cargarResumenGlobalYOrdenes()
  ]);
};

// =========================================================================
// 2. CONCILIACIÓN DE PAGOS DIGITALES (TODOS LOS MÉTODOS)
// =========================================================================
async function cargarPagosPendientes() {
  // Buscamos TODA orden que esté en verificación de pago (Pago Móvil, Binance, Zelle, Zinli, Punto)
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
    tablaPagosCuerpo.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888; padding: 18px;">✅ No hay pagos pendientes por conciliar.</td></tr>';
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
          <strong style="color:#fbbf24;">#ORD-${ord.id.slice(0, 8)}</strong><br>
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
          <span style="font-family: monospace; font-size: 0.9rem; background: #262626; padding: 3px 7px; border-radius: 4px; color: #fff;">
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
    await recargarTodoAdmin();
  }
};

window.rechazarPagoOrden = async function(ordenId) {
  const motivo = prompt('Indica el motivo del rechazo (ej: Referencia no encontrada, monto incompleto):');
  if (!motivo) return;

  const { error } = await db
    .from('orders')
    .update({
      status: 'cancelled',
      notes: `Pago rechazado por Administración: ${motivo}`
    })
    .eq('id', ordenId);

  if (error) {
    alert('Error al rechazar orden: ' + error.message);
  } else {
    await recargarTodoAdmin();
  }
};

// =========================================================================
// 3. CORTES DE CAJA Y LIQUIDACIONES A RESTAURANTES
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
        <td style="color: #fbbf24;">$${comision}</td>
        <td style="color: #10b981; font-weight: bold; font-size: 0.98rem;">$${neto}</td>
        <td>
          ${pendiente
            ? `<span class="badge-estado badge-pendiente">Por Liquidar</span>`
            : `<span class="badge-estado badge-aprobado">Pagado (Ref: ${c.settlement_reference || 'OK'})</span>`
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
    alert('✅ Liquidación registrada con éxito.');
    await cargarCortesCaja();
  }
};

// =========================================================================
// 4. FLOTA DE REPARTIDORES Y AUDITORÍA DE DEUDAS ($20)
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
    tablaDriversCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 18px;">No hay repartidores registrados.</td></tr>';
    return;
  }

  tablaDriversCuerpo.innerHTML = listaPerfiles.map(d => {
    const w = listaWallets.find(x => x.driver_id === d.id) || { prepaid_balance: 0, cash_debt: 0, is_blocked: false };
    const saldo = parseFloat(w.prepaid_balance || 0);
    const deuda = parseFloat(w.cash_debt || 0);
    const bloqueado = deuda >= 20 || w.is_blocked;

    return `
      <tr>
        <td>
          <strong>${d.full_name || 'Repartidor'}</strong><br>
          <small style="color: #a3a3a3;">${d.phone || 'S/N'} • ${d.vehicle_type || 'Moto'}</small>
        </td>
        <td>
          <span class="badge-estado ${d.is_online ? 'badge-aprobado' : 'badge-pendiente'}">
            ${d.is_online ? '🟢 En Línea' : '⚪ Offline'}
          </span>
        </td>
        <td style="color: #34d399; font-weight: bold;">$${saldo.toFixed(2)}</td>
        <td style="color: ${deuda > 0 ? '#fca5a5' : '#888'}; font-weight: bold;">$${deuda.toFixed(2)} / $20.00</td>
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
            <button type="button" class="btn-accion-mini" style="background:#3b82f6; color:#fff;" onclick="pagarSaldoDriver('${d.id}', '${(d.full_name || '').replace(/'/g, "\\'")}', ${saldo})" ${saldo <= 0 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
              📲 Liquidar Fletes
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.recibirEfectivoDriver = async function(driverId, nombre, deudaActual) {
  const montoStr = prompt(`El repartidor ${nombre} debe $${deudaActual.toFixed(2)} en efectivo.\n¿Cuánto dinero te está entregando a caja?`, deudaActual.toFixed(2));
  if (!montoStr) return;
  const abono = parseFloat(montoStr);
  if (isNaN(abono) || abono <= 0) return;

  const nuevaDeuda = Math.max(0, deudaActual - abono);
  const { error } = await db.from('delivery_wallets').update({
    cash_debt: nuevaDeuda,
    is_blocked: nuevaDeuda >= 20.00
  }).eq('driver_id', driverId);

  if (!error) {
    await db.from('delivery_transactions').insert([{
      driver_id: driverId,
      amount: abono,
      type: 'debt_payment',
      notes: 'Entrega de efectivo en caja administrativa'
    }]);
    alert(`✅ Deuda actualizada. Nueva deuda de ${nombre}: $${nuevaDeuda.toFixed(2)}`);
    await cargarFlotaRepartidores();
  }
};

window.pagarSaldoDriver = async function(driverId, nombre, saldoActual) {
  if (!confirm(`¿Marcar como pagados los $${saldoActual.toFixed(2)} de fletes acumulados a favor de ${nombre}?`)) return;

  const { error } = await db.from('delivery_wallets').update({
    prepaid_balance: 0
  }).eq('driver_id', driverId);

  if (!error) {
    await db.from('delivery_transactions').insert([{
      driver_id: driverId,
      amount: saldoActual,
      type: 'payout',
      notes: 'Liquidación administrativa de fletes acumulados'
    }]);
    alert(`✅ Saldo de ${nombre} liquidado a $0.00.`);
    await cargarFlotaRepartidores();
  }
};

// =========================================================================
// 5. COMERCIOS ACTIVOS Y EXPEDIENTES LEGALES
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
    tablaLocalesCuerpo.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 14px;">No hay expedientes pendientes de verificación.</td></tr>';
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
// 6. RESUMEN FINANCIERO GLOBAL, GRÁFICO Y MONITOR DE ÓRDENES
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

  if (cacheOrdenesGlobal.length === 0) {
    tablaTodasOrdenes.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">No hay órdenes registradas.</td></tr>';
  } else {
    tablaTodasOrdenes.innerHTML = cacheOrdenesGlobal.slice(0, 25).map(o => `
      <tr>
        <td><strong>#ORD-${o.id.slice(0, 8)}</strong><br><small style="color:#888;">${new Date(o.created_at).toLocaleString()}</small></td>
        <td>${o.businesses?.name || 'Local'}</td>
        <td>${o.customer_name || 'Cliente'}<br><small style="color:#888;">${o.customer_phone || ''}</small></td>
        <td>${o.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'} • <small>${(o.payment_method || '').toUpperCase()}</small></td>
        <td style="color:#fbbf24; font-weight:bold;">$${parseFloat(o.total || 0).toFixed(2)}</td>
        <td><span class="badge-estado badge-pendiente">${o.status.toUpperCase()}</span></td>
        <td>
          ${!['delivered', 'cancelled'].includes(o.status)
            ? `<button type="button" class="btn-accion-mini btn-rechazar" onclick="cancelarOrdenAdmin('${o.id}')">Cancelar</button>`
            : `<small style="color:#666;">Cerrada</small>`
          }
        </td>
      </tr>
    `).join('');
  }

  dibujarGraficoAdmin();
}

window.cancelarOrdenAdmin = async function(ordenId) {
  const motivo = prompt('Motivo de cancelación administrativa:');
  if (!motivo) return;
  await db.from('orders').update({ status: 'cancelled', notes: `Cancelada por Admin: ${motivo}` }).eq('id', ordenId);
  await recargarTodoAdmin();
};

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
        backgroundColor: '#10b981',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#9ca3af' } },
        x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
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