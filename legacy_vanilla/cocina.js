const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let localActivo = null;
let productosLocal = [];
let insumosLocal = [];
let recetasLocal = [];
let comandasActivas = [];
let logsSalonHoy = [];
let mermasHistorial = [];
let miGraficoVentas = null;
let periodoGraficoActual = 'semana';
let filtroComprasActual = 'todos';
let platoSeleccionadoId = null;

// Estados para Teclado Numérico (+)
let keypadItemActual = null;
let keypadValorActual = '0';

// Estados para Eliminación en Cascada (🗑️)
let insumoAEliminar = null;

// Cache de datos para los gráficos
let cacheOrdenesEntregadas = [];
let cacheVentasSalon = [];

// ==========================================
// 1. UTILIDADES VISUALES Y SONIDO
// ==========================================
function playBeepSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.warn('AudioContext bloqueado:', e);
  }
}

function showToast(mensaje) {
  const toast = document.getElementById('cocina-toast');
  if (!toast) return;
  toast.innerText = mensaje;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

function getIngredientEmoji(name = '') {
  const n = (name || '').toLowerCase();
  if (n.includes('tomate')) return '🍅';
  if (n.includes('queso') || n.includes('mozzarella') || n.includes('cheddar')) return '🧀';
  if (n.includes('carne') || n.includes('res') || n.includes('pollo') || n.includes('tocineta')) return '🥩';
  if (n.includes('leche') || n.includes('crema') || n.includes('lacteo')) return '🥛';
  if (n.includes('pan') || n.includes('harina') || n.includes('masa')) return '🥖';
  if (n.includes('papa') || n.includes('papas') || n.includes('frita')) return '🥔';
  if (n.includes('jamon') || n.includes('jamón') || n.includes('embutido')) return '🥓';
  if (n.includes('cebolla')) return '🧅';
  if (n.includes('lechuga') || n.includes('vegetal') || n.includes('cilantro')) return '🥬';
  if (n.includes('salsa') || n.includes('ketchup') || n.includes('mayo')) return '🥫';
  if (n.includes('azucar') || n.includes('azúcar') || n.includes('dulce')) return '🍬';
  if (n.includes('aceite') || n.includes('vinagre')) return '🍾';
  if (n.includes('huevo')) return '🥚';
  if (n.includes('envase') || n.includes('bandeja') || n.includes('caja')) return '📦';
  if (n.includes('cubierto') || n.includes('tenedor') || n.includes('cuchill') || n.includes('servilleta')) return '🍴';
  return '🛒';
}

// ==========================================
// 2. NAVEGACIÓN ENTRE TABS
// ==========================================
window.cambiarTabPrincipal = function(tabName) {
  const secciones = ['comandas', 'compras', 'merma', 'ganancias', 'menu', 'salon'];
  secciones.forEach(s => {
    const el = document.getElementById(`sec-${s}`);
    const btn = document.getElementById(`tab-btn-${s}`);
    if (el) el.style.display = (s === tabName) ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', s === tabName);
  });

  if (tabName === 'ganancias') {
    setTimeout(() => {
      dibujarGraficoInteractivo();
    }, 100);
  }
};

// ==========================================
// 3. SALIDA DE SESIÓN Y ESTADO DEL LOCAL
// ==========================================
window.cerrarSesionCocina = async function() {
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

function actualizarBotonEstadoLocal() {
  const btn = document.getElementById('btn-estado-local');
  if (!btn || !localActivo) return;
  if (localActivo.is_active) {
    btn.className = 'btn-toggle activo';
    btn.innerText = '🟢 Local Abierto';
  } else {
    btn.className = 'btn-toggle pausado';
    btn.innerText = '🔴 Local Pausado';
  }
}

window.toggleEstadoLocal = async function() {
  if (!localActivo) return;
  const nuevo = !localActivo.is_active;
  const { error } = await db.from('businesses').update({ is_active: nuevo }).eq('id', localActivo.id);
  if (!error) {
    localActivo.is_active = nuevo;
    actualizarBotonEstadoLocal();
    showToast(`Local ${nuevo ? 'abierto para pedidos' : 'pausado temporalmente'}`);
  }
};

// ==========================================
// 4. INICIALIZACIÓN
// ==========================================
(async () => {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session || !session.user) {
      window.location.replace('portal.html');
      return;
    }

    await cargarNegocioCocina(session.user);
    if (!localActivo) return;

    await recargarTodoInventarioYMenu();
    await cargarComandasCocina();
    await cargarHistorialMermas();
    await cargarEstadisticasFinancieras();
    suscribirComandasRealtime();
  } catch (err) {
    console.error('Error iniciando cocina:', err);
  }
})();

async function cargarNegocioCocina(user) {
  let { data: neg } = await db
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!neg) {
    const { data: lista } = await db.from('businesses').select('*').order('created_at', { ascending: true });
    if (lista && lista.length > 0) {
      neg = lista.find(b => user.email?.includes('pizza') ? b.name.toLowerCase().includes('burger') : b.name.toLowerCase().includes('gastronom')) || lista[0];
    }
  }

  if (!neg) {
    alert('No se encontró restaurante activo en la base de datos.');
    return;
  }

  localActivo = neg;
  document.getElementById('cocina-titulo').innerText = `${neg.name} - Operaciones`;
  actualizarBotonEstadoLocal();
}

// ==========================================
// 5. INVENTARIO, RECETAS Y DISPONIBILIDAD
// ==========================================
async function recargarTodoInventarioYMenu() {
  if (!localActivo) return;

  // 1. Insumos
  const { data: ins } = await db
    .from('inventory_items')
    .select('*')
    .eq('business_id', localActivo.id)
    .order('name', { ascending: true });
  insumosLocal = ins || [];

  // 2. Productos
  const { data: prods } = await db
    .from('products')
    .select('*')
    .eq('business_id', localActivo.id)
    .order('name', { ascending: true });
  productosLocal = prods || [];

  // 3. Recetas
  const prodIds = productosLocal.map(p => p.id);
  if (prodIds.length > 0) {
    const { data: recs } = await db
      .from('product_recipes')
      .select('*')
      .in('product_id', prodIds);
    recetasLocal = recs || [];
  } else {
    recetasLocal = [];
  }

  // 4. Evaluar disponibilidad por recetas
  await verificarDisponibilidadPorRecetas();

  renderizarListaCompras();
  renderizarMenuCocina();
  actualizarSelectoresVentaYMerma();
}

function evaluarPlatoTieneInsumos(platoId) {
  const recDelPlato = recetasLocal.filter(r => r.product_id === platoId);
  if (recDelPlato.length === 0) return { ok: true, faltantes: [] };

  const faltantes = [];
  for (const r of recDelPlato) {
    const ins = insumosLocal.find(i => i.id === r.inventory_item_id);
    const disponible = ins ? parseFloat(ins.quantity || 0) : 0;
    const requerido = parseFloat(r.quantity_required || 0);
    if (!ins || disponible < requerido) {
      faltantes.push(ins ? ins.name : 'Insumo');
    }
  }
  return { ok: faltantes.length === 0, faltantes };
}

async function verificarDisponibilidadPorRecetas() {
  for (const p of productosLocal) {
    const evalReceta = evaluarPlatoTieneInsumos(p.id);
    p._sinInsumos = !evalReceta.ok;
    p._faltantes = evalReceta.faltantes;

    if ((!evalReceta.ok || (p.stock !== null && p.stock <= 0)) && p.is_available) {
      await db.from('products').update({ is_available: false }).eq('id', p.id);
      p.is_available = false;
    }
  }
}

// ==========================================
// 6. LISTA DE COMPRAS ANIMADA & TECLADO NUMÉRICO (+)
// ==========================================
window.cambiarFiltroCompras = function(modo) {
  filtroComprasActual = modo;
  document.getElementById('filtro-ins-todos')?.classList.toggle('active', modo === 'todos');
  document.getElementById('filtro-ins-criticos')?.classList.toggle('active', modo === 'criticos');
  renderizarListaCompras();
};

window.filtrarListaCompras = function() {
  renderizarListaCompras();
};

window.toggleFormNuevoInsumo = function() {
  const box = document.getElementById('box-nuevo-insumo');
  if (box) {
    box.style.display = (box.style.display === 'none' || box.style.display === '') ? 'grid' : 'none';
  }
};

function renderizarListaCompras() {
  const cont = document.getElementById('grid-lista-compras');
  if (!cont) return;

  const query = (document.getElementById('buscador-insumos')?.value || '').toLowerCase().trim();
  const criticos = insumosLocal.filter(i => parseFloat(i.quantity || 0) <= parseFloat(i.min_threshold || 0));

  // Actualizar contadores
  const cTodos = document.getElementById('count-ins-todos');
  const cCriticos = document.getElementById('count-ins-criticos');
  if (cTodos) cTodos.innerText = insumosLocal.length;
  if (cCriticos) cCriticos.innerText = criticos.length;

  let lista = insumosLocal;
  if (query.length > 0) {
    lista = insumosLocal.filter(i => i.name.toLowerCase().includes(query));
  } else if (filtroComprasActual === 'criticos') {
    lista = criticos;
  }

  if (lista.length === 0) {
    cont.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 32px 16px; background: #1c171d; border-radius: 12px; border: 1px dashed var(--brand-border);">
        <div style="font-size: 2.4rem; margin-bottom: 8px;">🎉</div>
        <strong style="color: #fff; font-size: 1.1rem;">Todo abastecido</strong>
        <p style="color: var(--brand-muted); font-size: 0.88rem; margin: 4px 0 0 0;">
          ${filtroComprasActual === 'criticos' ? 'No hay ningún ingrediente por debajo del umbral mínimo.' : 'No se encontraron ingredientes con ese término.'}
        </p>
      </div>
    `;
    return;
  }

  cont.innerHTML = lista.map((ins, idx) => {
    const cant = parseFloat(ins.quantity || 0);
    const min = parseFloat(ins.min_threshold || 0);
    const agotado = cant <= 0;
    const bajo = cant <= min;

    let badgeClass = 'status-ok';
    let badgeText = '🟢 Abastecido';
    if (agotado) {
      badgeClass = 'status-out';
      badgeText = '🛑 Agotado';
    } else if (bajo) {
      badgeClass = 'status-low';
      badgeText = '⚠️ Stock Bajo';
    }

    // Cantidad de platos que usan este ingrediente
    const platosVinculados = recetasLocal.filter(r => r.inventory_item_id === ins.id);
    const cantPlatos = platosVinculados.length;
    const emoji = getIngredientEmoji(ins.name);

    return `
      <div class="shopping-card-item" style="animation-delay: ${idx * 0.04}s;">
        <div class="shopping-card-header">
          <div class="shopping-emoji-badge">${emoji}</div>
          <div class="shopping-card-info">
            <h3 class="shopping-card-name">${ins.name}</h3>
            <span class="shopping-card-status ${badgeClass}">${badgeText}</span>
          </div>
        </div>

        <div class="shopping-stock-readout">
          <span style="font-size: 0.78rem; color: var(--brand-muted);">Disponible</span>
          <span style="font-size: 1.15rem; font-weight: 800; color: #fff;">
            ${cant.toFixed(1).replace(/\.0$/, '')} <small style="font-size: 0.8rem; color: var(--brand-muted);">${ins.unit}</small>
          </span>
        </div>

        <div style="font-size: 0.76rem; color: var(--brand-muted); display: flex; justify-content: space-between;">
          <span>Mínimo: ${min} ${ins.unit}</span>
          <span>🍔 En ${cantPlatos} plato${cantPlatos === 1 ? '' : 's'}</span>
        </div>

        <div class="shopping-card-actions">
          <button type="button" onclick="abrirTecladoNumerico('${ins.id}')" class="btn-add-stock" title="Añadir stock con teclado numérico">
            <span>+</span> Añadir Stock
          </button>
          <button type="button" onclick="abrirModalEliminarInsumo('${ins.id}')" class="btn-delete-item" title="Eliminar ingrediente en cascada">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// TECLADO NUMÉRICO TÁCTIL (+)
// ----------------------------------------------------
window.abrirTecladoNumerico = function(itemId) {
  const item = insumosLocal.find(i => i.id === itemId);
  if (!item) return;

  keypadItemActual = item;
  keypadValorActual = '0';

  document.getElementById('keypad-titulo-insumo').innerText = `Añadir Stock: ${item.name}`;
  document.getElementById('keypad-unit-display').innerText = item.unit || '';
  document.getElementById('keypad-val-display').innerText = '0';
  document.getElementById('btn-sumar-preview').innerText = '0';
  document.getElementById('modal-keypad').style.display = 'flex';
};

window.cerrarTecladoNumerico = function() {
  keypadItemActual = null;
  keypadValorActual = '0';
  document.getElementById('modal-keypad').style.display = 'none';
};

window.presionarTeclaKeypad = function(val) {
  if (val === 'DEL') {
    if (keypadValorActual.length <= 1) {
      keypadValorActual = '0';
    } else {
      keypadValorActual = keypadValorActual.slice(0, -1);
    }
  } else if (val === '.') {
    if (!keypadValorActual.includes('.')) {
      keypadValorActual += '.';
    }
  } else {
    if (keypadValorActual === '0') {
      keypadValorActual = val;
    } else {
      keypadValorActual += val;
    }
  }
  actualizarDisplayKeypad();
};

window.presionarPresetKeypad = function(delta) {
  const actual = parseFloat(keypadValorActual) || 0;
  keypadValorActual = (actual + delta).toString();
  actualizarDisplayKeypad();
};

window.limpiarKeypad = function() {
  keypadValorActual = '0';
  actualizarDisplayKeypad();
};

function actualizarDisplayKeypad() {
  document.getElementById('keypad-val-display').innerText = keypadValorActual;
  document.getElementById('btn-sumar-preview').innerText = keypadValorActual;
}

window.confirmarSumaStockKeypad = async function() {
  if (!keypadItemActual) return;
  const delta = parseFloat(keypadValorActual);
  if (isNaN(delta) || delta <= 0) {
    alert('Ingresa una cantidad mayor a 0 para añadir al inventario.');
    return;
  }

  const nuevaCant = parseFloat(keypadItemActual.quantity || 0) + delta;
  const { error } = await db.from('inventory_items').update({ quantity: nuevaCant }).eq('id', keypadItemActual.id);

  if (!error) {
    showToast(`✅ Se sumaron +${delta} ${keypadItemActual.unit} a ${keypadItemActual.name}`);
    cerrarTecladoNumerico();
    await recargarTodoInventarioYMenu();
  } else {
    alert('Error al actualizar inventario: ' + error.message);
  }
};

// ----------------------------------------------------
// ELIMINACIÓN DE INGREDIENTE EN CASCADA (🗑️)
// ----------------------------------------------------
window.abrirModalEliminarInsumo = function(itemId) {
  const item = insumosLocal.find(i => i.id === itemId);
  if (!item) return;

  insumoAEliminar = item;
  const recDelItem = recetasLocal.filter(r => r.inventory_item_id === item.id);
  const platosAfectados = productosLocal.filter(p => recDelItem.some(r => r.product_id === p.id));

  document.getElementById('delete-modal-subtitle').innerHTML = `¿Seguro que deseas eliminar <strong>${item.name}</strong>?`;
  
  const listaEl = document.getElementById('delete-modal-platos-list');
  if (platosAfectados.length > 0) {
    listaEl.innerHTML = platosAfectados.map(p => `<li>${p.name}</li>`).join('');
  } else {
    listaEl.innerHTML = `<em>Ningún plato tiene este ingrediente configurado actualmente.</em>`;
  }

  document.getElementById('modal-eliminar-insumo').style.display = 'flex';
};

window.cerrarModalEliminarInsumo = function() {
  insumoAEliminar = null;
  document.getElementById('modal-eliminar-insumo').style.display = 'none';
};

window.ejecutarEliminarInsumoCascada = async function() {
  if (!insumoAEliminar) return;
  const btn = document.getElementById('btn-confirmar-eliminar-cascada');
  btn.innerText = 'Eliminando...';
  btn.disabled = true;

  try {
    // 1. Borrar de product_recipes (remueve el ingrediente de las recetas de los platos)
    await db.from('product_recipes').delete().eq('inventory_item_id', insumoAEliminar.id);

    // 2. Borrar de inventory_items
    const { error } = await db.from('inventory_items').delete().eq('id', insumoAEliminar.id);

    if (!error) {
      showToast(`🗑️ ${insumoAEliminar.name} fue eliminado por completo.`);
      cerrarModalEliminarInsumo();
      await recargarTodoInventarioYMenu();
    } else {
      alert('Error al eliminar insumo: ' + error.message);
    }
  } catch (err) {
    console.error('Error en cascada:', err);
    alert('Ocurrió un error al eliminar: ' + err.message);
  } finally {
    btn.innerText = 'Sí, Eliminar de Todo';
    btn.disabled = false;
  }
};

// Crear nuevo ingrediente
document.getElementById('box-nuevo-insumo')?.addEventListener('submit', async (e) => {
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
    showToast(`✅ Ingrediente "${name}" creado exitosamente.`);
    e.target.reset();
    e.target.style.display = 'none';
    await recargarTodoInventarioYMenu();
  } else {
    alert('Error al registrar ingrediente: ' + error.message);
  }
});

// ==========================================
// 7. CONTROL DE MERMA (DESPERDICIO)
// ==========================================
async function cargarHistorialMermas() {
  if (!localActivo) return;
  const { data: logs } = await db
    .from('kitchen_logs')
    .select('*')
    .eq('business_id', localActivo.id)
    .eq('log_type', 'merma')
    .order('created_at', { ascending: false })
    .limit(15);

  mermasHistorial = logs || [];
  renderizarHistorialMermas();
}

function renderizarHistorialMermas() {
  const cont = document.getElementById('lista-historial-mermas');
  if (!cont) return;

  if (mermasHistorial.length === 0) {
    cont.innerHTML = `<p style="color: #777; margin: 0; padding: 12px; text-align: center;">Sin registros de merma hoy.</p>`;
    return;
  }

  cont.innerHTML = mermasHistorial.map(m => {
    const f = new Date(m.created_at);
    const hora = f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #1f1a21; font-size: 0.82rem;">
        <div>
          <strong style="color: #fca5a5;">-${m.quantity} ${m.item_name}</strong>
          <div style="color: var(--brand-muted); font-size: 0.74rem;">Motivo: ${m.notes || 'No especificado'}</div>
        </div>
        <span style="color: #888; font-size: 0.75rem;">${hora}</span>
      </div>
    `;
  }).join('');
}

document.getElementById('form-merma')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const itemId = document.getElementById('merma-item-id').value;
  const cant = parseFloat(document.getElementById('merma-cantidad').value);
  const motivo = document.getElementById('merma-motivo').value;
  const notasExtra = document.getElementById('merma-notas').value.trim();

  const ins = insumosLocal.find(i => i.id === itemId);
  if (!ins) return;

  const motivoCompleto = notasExtra ? `${motivo} — ${notasExtra}` : motivo;
  const nuevoStock = Math.max(0, parseFloat(ins.quantity || 0) - cant);

  // 1. Descontar de inventory_items
  const { error: errInv } = await db.from('inventory_items').update({ quantity: nuevoStock }).eq('id', ins.id);
  if (errInv) {
    alert('Error al descontar del inventario: ' + errInv.message);
    return;
  }

  // 2. Insertar log en kitchen_logs
  await db.from('kitchen_logs').insert([{
    business_id: localActivo.id,
    log_type: 'merma',
    item_name: `${ins.name} (${ins.unit})`,
    quantity: cant,
    amount_usd: 0,
    notes: motivoCompleto
  }]);

  showToast(`🗑️ Merma registrada: Se descontaron -${cant} ${ins.unit} de ${ins.name}`);
  e.target.reset();
  await recargarTodoInventarioYMenu();
  await cargarHistorialMermas();
});

// ==========================================
// 8. GANANCIAS & REPORTES (DÍA, SEMANA, MES, AÑO)
// ==========================================
window.cambiarPeriodoGrafico = function(periodo) {
  periodoGraficoActual = periodo;
  ['dia', 'semana', 'mes', 'anio'].forEach(p => {
    document.getElementById(`btn-chart-${p}`)?.classList.toggle('active', p === periodo);
  });
  dibujarGraficoInteractivo();
};

async function cargarEstadisticasFinancieras() {
  if (!localActivo) return;

  const { data: ordenes } = await db
    .from('orders')
    .select('total, subtotal_food, created_at, status')
    .eq('business_id', localActivo.id)
    .in('status', ['delivered', 'on_the_way', 'cooking']);

  const { data: logsSalon } = await db
    .from('kitchen_logs')
    .select('amount_usd, created_at')
    .eq('business_id', localActivo.id)
    .eq('log_type', 'venta_salon');

  cacheOrdenesEntregadas = (ordenes || []).filter(o => o.status === 'delivered');
  cacheVentasSalon = logsSalon || [];

  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  
  const primerDiaSemana = new Date(ahora);
  primerDiaSemana.setDate(ahora.getDate() - ahora.getDay());
  primerDiaSemana.setHours(0, 0, 0, 0);

  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1).getTime();

  let totalDia = 0, totalSemana = 0, totalMes = 0, totalAnio = 0, salonHoy = 0;

  const transacciones = [
    ...cacheOrdenesEntregadas.map(o => ({ monto: parseFloat(o.subtotal_food || o.total || 0), fecha: new Date(o.created_at), tipo: 'app' })),
    ...cacheVentasSalon.map(l => ({ monto: parseFloat(l.amount_usd || 0), fecha: new Date(l.created_at), tipo: 'salon' }))
  ];

  transacciones.forEach(t => {
    const tiempo = t.fecha.getTime();
    if (tiempo >= inicioHoy) {
      totalDia += t.monto;
      if (t.tipo === 'salon') salonHoy += t.monto;
    }
    if (tiempo >= primerDiaSemana.getTime()) totalSemana += t.monto;
    if (tiempo >= inicioMes) totalMes += t.monto;
    if (tiempo >= inicioAnio) totalAnio += t.monto;
  });

  const elDia = document.getElementById('stat-dia');
  const elSem = document.getElementById('stat-semana');
  const elMes = document.getElementById('stat-mes');
  const elAnio = document.getElementById('stat-anio');
  const corteSalonEl = document.getElementById('corte-salon');

  if (elDia) elDia.innerText = `$${totalDia.toFixed(2)}`;
  if (elSem) elSem.innerText = `$${totalSemana.toFixed(2)}`;
  if (elMes) elMes.innerText = `$${totalMes.toFixed(2)}`;
  if (elAnio) elAnio.innerText = `$${totalAnio.toFixed(2)}`;
  if (corteSalonEl) corteSalonEl.innerText = `$${salonHoy.toFixed(2)}`;

  dibujarGraficoInteractivo(transacciones);
}

function dibujarGraficoInteractivo(transaccionesPasadas) {
  const transacciones = transaccionesPasadas || [
    ...cacheOrdenesEntregadas.map(o => ({ monto: parseFloat(o.subtotal_food || o.total || 0), fecha: new Date(o.created_at) })),
    ...cacheVentasSalon.map(l => ({ monto: parseFloat(l.amount_usd || 0), fecha: new Date(l.created_at) }))
  ];

  const ahora = new Date();
  let labels = [];
  let valores = [];

  if (periodoGraficoActual === 'dia') {
    const bloques = ['00-03h', '03-06h', '06-09h', '09-12h', '12-15h', '15-18h', '18-21h', '21-24h'];
    const sumas = new Array(8).fill(0);
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();

    transacciones.forEach(t => {
      if (t.fecha.getTime() >= inicioHoy) {
        const idx = Math.min(7, Math.floor(t.fecha.getHours() / 3));
        sumas[idx] += t.monto;
      }
    });
    labels = bloques;
    valores = sumas;

  } else if (periodoGraficoActual === 'semana') {
    const mapaDias = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(ahora.getDate() - i);
      const key = d.toISOString().split('T')[0];
      mapaDias[key] = 0;
    }
    transacciones.forEach(t => {
      const key = t.fecha.toISOString().split('T')[0];
      if (mapaDias[key] !== undefined) mapaDias[key] += t.monto;
    });
    labels = Object.keys(mapaDias).map(f => {
      const p = f.split('-');
      return `${p[2]}/${p[1]}`;
    });
    valores = Object.values(mapaDias);

  } else if (periodoGraficoActual === 'mes') {
    labels = ['Sem 1 (1-7)', 'Sem 2 (8-14)', 'Sem 3 (15-21)', 'Sem 4 (22+)'];
    valores = [0, 0, 0, 0];
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();

    transacciones.forEach(t => {
      if (t.fecha.getTime() >= inicioMes) {
        const dia = t.fecha.getDate();
        const idx = Math.min(3, Math.floor((dia - 1) / 7));
        valores[idx] += t.monto;
      }
    });

  } else if (periodoGraficoActual === 'anio') {
    labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    valores = new Array(12).fill(0);
    const anioActual = ahora.getFullYear();

    transacciones.forEach(t => {
      if (t.fecha.getFullYear() === anioActual) {
        valores[t.fecha.getMonth()] += t.monto;
      }
    });
  }

  const canvas = document.getElementById('chartVentas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (miGraficoVentas) {
    miGraficoVentas.destroy();
  }

  miGraficoVentas = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ventas USD ($)',
        data: valores,
        backgroundColor: '#ef9d24',
        borderColor: '#82133a',
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c171d',
          borderColor: '#ef9d24',
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#ef9d24',
          callbacks: {
            label: function(context) {
              return ` Ingresos: $${parseFloat(context.parsed.y).toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: { color: '#a69da3', callback: v => `$${v}` }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#a69da3' }
        }
      }
    }
  });
}

// Liquidación de corte
window.solicitarCorteCaja = async function() {
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  const entregadasHoy = comandasActivas.filter(o => o.status === 'delivered' && new Date(o.created_at) >= hoyInicio);
  const bruto = entregadasHoy.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);

  if (bruto <= 0) {
    alert('No tienes órdenes de la App entregadas hoy pendientes por liquidar.');
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
    showToast(`✅ Liquidación enviada por $${neto.toFixed(2)}`);
  } else {
    alert('Error al enviar corte: ' + error.message);
  }
};

// ==========================================
// 9. COMANDAS EN VIVO KDS & DESPACHO
// ==========================================
window.cargarComandasCocina = async function() {
  if (!localActivo) return;
  const gridComandas = document.getElementById('grid-comandas');
  if (!gridComandas) return;

  const { data: ordenes, error } = await db
    .from('orders')
    .select('*')
    .eq('business_id', localActivo.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error cargando órdenes:', error);
    return;
  }

  comandasActivas = ordenes || [];

  // Actualizar badge de comandas
  const enCurso = comandasActivas.filter(o => !['delivered', 'cancelled', 'rejected'].includes(o.status));
  const badgeTotal = document.getElementById('badge-total-comandas');
  if (badgeTotal) badgeTotal.innerText = enCurso.length;

  // Corte de turno
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  const entregadasHoy = comandasActivas.filter(o => o.status === 'delivered' && new Date(o.created_at) >= hoyInicio);
  const bruto = entregadasHoy.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);
  
  const cBruto = document.getElementById('corte-bruto');
  const cNeto = document.getElementById('corte-neto');
  if (cBruto) cBruto.innerText = `$${bruto.toFixed(2)}`;
  if (cNeto) cNeto.innerText = `$${(bruto * 0.90).toFixed(2)}`;

  if (enCurso.length === 0) {
    gridComandas.innerHTML = '<p style="color:#888; padding: 20px;">No hay comandas pendientes en cocina en este momento.</p>';
    return;
  }

  gridComandas.innerHTML = enCurso.map(ord => {
    const itemsLista = Array.isArray(ord.items) ? ord.items : [];
    const itemsHtml = itemsLista.map(i => `<div><strong>${i.quantity || 1}x ${i.name}</strong> ($${parseFloat(i.price || 0).toFixed(2)})</div>`).join('');
    
    let btnSiguiente = '';
    if (['pending', 'confirmed', 'paid'].includes(ord.status)) {
      btnSiguiente = `<button type="button" onclick="cambiarEstadoComanda('${ord.id}', 'cooking')" class="btn-primario" style="flex:1; background: var(--brand-accent); color: #000; font-weight: 800;">👨‍🍳 Cocinando (Descontar)</button>`;
    } else if (ord.status === 'cooking') {
      if (ord.delivery_type === 'pickup') {
        btnSiguiente = `<button type="button" onclick="cambiarEstadoComanda('${ord.id}', 'delivered')" class="btn-primario" style="flex:1; background:#10b981; color:#fff; font-weight: 800;">🛍️ Entregar a Cliente (Pickup)</button>`;
      } else {
        btnSiguiente = `<button type="button" onclick="cambiarEstadoComanda('${ord.id}', 'on_the_way')" class="btn-primario" style="flex:1; background:#10b981; color:#fff; font-weight: 800;">📦 Entregar a Motorizado</button>`;
      }
    }

    const btnCancelar = `<button type="button" onclick="cancelarComandaConReversion('${ord.id}')" class="btn-secundario" style="padding: 8px 12px; border-color: var(--brand-red); color: #fca5a5;" title="Cancelar orden y revertir stock">✕</button>`;

    return `
      <div class="card-cocina" style="border-left: 4px solid var(--brand-accent);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: #fff; font-size: 1rem;">#ORD-${ord.id.slice(0, 8)}</strong>
          <span class="shopping-card-status status-low">${ord.status.toUpperCase()}</span>
        </div>
        <div style="font-size: 0.9rem; border-bottom: 1px dashed var(--brand-border); padding-bottom: 8px; margin-bottom: 8px;">
          ${itemsHtml || '<em>Detalle de orden</em>'}
        </div>
        <div style="font-size: 0.82rem; color: #ccc;">
          <div><strong>Cliente:</strong> ${ord.customer_name || 'Cliente'} (${ord.customer_phone || 'S/N'})</div>
          <div><strong>Modalidad:</strong> ${ord.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'} • <strong>Total:</strong> $${parseFloat(ord.total || 0).toFixed(2)}</div>
          ${ord.notes ? `<div style="color:var(--brand-accent);"><strong>Nota:</strong> ${ord.notes}</div>` : ''}
        </div>
        <div style="display: flex; gap: 8px; margin-top: 14px;">
          ${btnSiguiente}
          ${btnCancelar}
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

  const ordenObj = comandasActivas.find(o => o.id === ordenId);

  // Descontar al pasar a cocina
  if (nuevoEstado === 'cooking' && ordenObj && Array.isArray(ordenObj.items)) {
    for (const item of ordenObj.items) {
      const cant = parseInt(item.quantity || 1);
      const prod = productosLocal.find(p => p.id === item.id || p.name.toLowerCase() === (item.name || '').toLowerCase());
      if (prod) {
        const nuevoStock = Math.max(0, (prod.stock ?? 50) - cant);
        await db.from('products').update({ stock: nuevoStock }).eq('id', prod.id);
        await descontarInsumosPorReceta(prod.id, cant);
      }
    }
    await recargarTodoInventarioYMenu();

    // Disparador de WhatsApp automático al pasar a preparación
    if (ordenObj.customer_phone) {
      dispararWhatsAppNotificacion(ordenObj);
    }
  }

  await db.from('orders').update(payload).eq('id', ordenId);
  showToast(`Orden actualizada a: ${nuevoEstado}`);
  await cargarComandasCocina();
  await cargarEstadisticasFinancieras();
};

function dispararWhatsAppNotificacion(orden) {
  try {
    const rawPhone = (orden.customer_phone || '').replace(/[^0-9]/g, '');
    let cleanPhone = rawPhone;
    if (rawPhone.startsWith('0')) cleanPhone = '58' + rawPhone.slice(1);
    else if (!rawPhone.startsWith('58') && rawPhone.length === 10) cleanPhone = '58' + rawPhone;

    const texto = `¡Hola ${orden.customer_name || 'Estimado cliente'}! 🌴 Tu pedido #ORD-${orden.id.slice(0, 8)} de Tropicalia ya está en preparación en cocina. Te avisaremos apenas esté listo. ¡Gracias por tu compra!`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  } catch (e) {
    console.warn('No se pudo abrir WhatsApp:', e);
  }
}

window.cancelarComandaConReversion = async function(ordenId) {
  if (!confirm('¿Deseas cancelar esta comanda y devolver sus ingredientes al inventario?')) return;

  const ordenObj = comandasActivas.find(o => o.id === ordenId);
  if (!ordenObj) return;

  // Revertir ingredientes si ya estaba en cocina
  if (ordenObj.status === 'cooking' && Array.isArray(ordenObj.items)) {
    for (const item of ordenObj.items) {
      const cant = parseInt(item.quantity || 1);
      const prod = productosLocal.find(p => p.id === item.id || p.name.toLowerCase() === (item.name || '').toLowerCase());
      if (prod) {
        await db.from('products').update({ stock: (prod.stock ?? 0) + cant }).eq('id', prod.id);
        await revertirInsumosPorReceta(prod.id, cant);
      }
    }
  }

  await db.from('orders').update({ status: 'cancelled' }).eq('id', ordenId);
  showToast('Orden cancelada y stock devuelto.');
  await recargarTodoInventarioYMenu();
  await cargarComandasCocina();
};

async function descontarInsumosPorReceta(platoId, cantPlato) {
  const recDelPlato = recetasLocal.filter(r => r.product_id === platoId);
  for (const r of recDelPlato) {
    const ins = insumosLocal.find(i => i.id === r.inventory_item_id);
    if (ins) {
      const totalResta = parseFloat(r.quantity_required) * cantPlato;
      const nuevoStock = Math.max(0, parseFloat(ins.quantity || 0) - totalResta);
      await db.from('inventory_items').update({ quantity: nuevoStock }).eq('id', ins.id);
      ins.quantity = nuevoStock;
    }
  }
}

async function revertirInsumosPorReceta(platoId, cantPlato) {
  const recDelPlato = recetasLocal.filter(r => r.product_id === platoId);
  for (const r of recDelPlato) {
    const ins = insumosLocal.find(i => i.id === r.inventory_item_id);
    if (ins) {
      const totalSuma = parseFloat(r.quantity_required) * cantPlato;
      const nuevoStock = parseFloat(ins.quantity || 0) + totalSuma;
      await db.from('inventory_items').update({ quantity: nuevoStock }).eq('id', ins.id);
      ins.quantity = nuevoStock;
    }
  }
}

// ==========================================
// 10. MENÚ, RECETAS Y VENTA EN SALÓN (LIBRO DE CARTA)
// ==========================================
let nuevoPlatoIngredientesMemoria = [];

window.actualizarSelectorIngredientesNuevoPlato = function() {
  const sel = document.getElementById('nuevo-plato-ingrediente-select');
  if (!sel) return;

  if (insumosLocal.length === 0) {
    sel.innerHTML = '<option value="">Sin insumos registrados</option>';
  } else {
    sel.innerHTML = insumosLocal.map(i => `<option value="${i.id}">${i.name} (${i.unit})</option>`).join('');
  }
  actualizarUnidadIngredienteSeleccionado();
};

window.actualizarUnidadIngredienteSeleccionado = function() {
  const sel = document.getElementById('nuevo-plato-ingrediente-select');
  const unitLabel = document.getElementById('nuevo-plato-ingrediente-unit');
  if (!sel || !unitLabel) return;

  const ins = insumosLocal.find(i => i.id === sel.value);
  unitLabel.innerText = ins ? ins.unit : '';
};

window.setPresetFotoNuevoPlato = function(url) {
  const input = document.getElementById('nuevo-plato-foto');
  if (input) {
    input.value = url;
    actualizarPreviewFotoNuevoPlato();
  }
};

window.actualizarPreviewFotoNuevoPlato = function() {
  const input = document.getElementById('nuevo-plato-foto');
  const previewBox = document.getElementById('nuevo-plato-foto-preview');
  const previewImg = document.getElementById('nuevo-plato-foto-img');
  if (!input || !previewBox || !previewImg) return;

  const val = input.value.trim();
  if (val) {
    previewImg.src = val;
    previewBox.style.display = 'block';
  } else {
    previewBox.style.display = 'none';
  }
};

window.agregarIngredienteARecetaNuevoPlato = function() {
  const sel = document.getElementById('nuevo-plato-ingrediente-select');
  const cantInput = document.getElementById('nuevo-plato-ingrediente-cant');
  if (!sel || !cantInput) return;

  const ins = insumosLocal.find(i => i.id === sel.value);
  if (!ins) {
    alert('Selecciona un ingrediente válido de la lista desplegable.');
    return;
  }

  const cant = parseFloat(cantInput.value);
  if (isNaN(cant) || cant <= 0) {
    alert('Ingresa una cantidad mayor a 0 para el ingrediente.');
    return;
  }

  // Filtrar si ya existía para actualizarlo
  nuevoPlatoIngredientesMemoria = nuevoPlatoIngredientesMemoria.filter(item => item.ingredientId !== ins.id);
  nuevoPlatoIngredientesMemoria.push({
    ingredientId: ins.id,
    ingredientName: ins.name,
    quantity: cant,
    unit: ins.unit || 'unidades'
  });

  cantInput.value = '';
  renderizarChipsRecetaNuevoPlato();
};

window.quitarIngredienteDeRecetaNuevoPlato = function(ingId) {
  nuevoPlatoIngredientesMemoria = nuevoPlatoIngredientesMemoria.filter(item => item.ingredientId !== ingId);
  renderizarChipsRecetaNuevoPlato();
};

function renderizarChipsRecetaNuevoPlato() {
  const cont = document.getElementById('nuevo-plato-chips-receta');
  if (!cont) return;

  if (nuevoPlatoIngredientesMemoria.length === 0) {
    cont.innerHTML = `<span style="font-size: 0.74rem; color: #777; font-style: italic;">Aún no has añadido ingredientes a la receta.</span>`;
    return;
  }

  cont.innerHTML = nuevoPlatoIngredientesMemoria.map(ing => `
    <span class="recipe-chip-tag">
      ${ing.ingredientName}: ${ing.quantity} ${ing.unit}
      <button type="button" onclick="quitarIngredienteDeRecetaNuevoPlato('${ing.ingredientId}')" class="recipe-chip-remove" title="Quitar de la receta">✕</button>
    </span>
  `).join('');
}

window.crearPlatoConRecetaCompleto = async function(e) {
  e.preventDefault();
  if (!localActivo) return;

  const name = document.getElementById('nuevo-plato-nombre').value.trim();
  const price = parseFloat(document.getElementById('nuevo-plato-precio').value);
  const foto = (document.getElementById('nuevo-plato-foto')?.value || '').trim();

  if (isNaN(price) || price <= 0) {
    alert('Ingresa un precio válido mayor a 0');
    return;
  }

  const btn = document.getElementById('btn-submit-nuevo-plato');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Guardando en Carta...';
  }

  try {
    // 1. Guardar producto
    const { data: newProd, error: errProd } = await db.from('products').insert([{
      business_id: localActivo.id,
      name,
      price,
      image_url: foto || null,
      stock: 50,
      is_available: true
    }]).select().single();

    if (errProd) throw errProd;

    // 2. Asociar ingredientes de la receta
    if (nuevoPlatoIngredientesMemoria.length > 0 && newProd) {
      const payloadRecetas = nuevoPlatoIngredientesMemoria.map(ing => ({
        product_id: newProd.id,
        inventory_item_id: ing.ingredientId,
        quantity_required: ing.quantity
      }));
      await db.from('product_recipes').insert(payloadRecetas);
    }

    showToast(`📖 Plato "${name}" guardado exitosamente en la carta.`);

    // Resetear formulario
    e.target.reset();
    nuevoPlatoIngredientesMemoria = [];
    renderizarChipsRecetaNuevoPlato();
    actualizarPreviewFotoNuevoPlato();

    await recargarTodoInventarioYMenu();
  } catch (err) {
    console.error('Error creando plato:', err);
    alert('Error al crear plato: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '📖 Guardar Plato en la Carta';
    }
  }
};

function renderizarMenuCocina() {
  const cont = document.getElementById('lista-menu-compacta');
  if (!cont) return;
  const query = (document.getElementById('buscador-menu')?.value || '').toLowerCase().trim();
  const filtrados = productosLocal.filter(p => p.name.toLowerCase().includes(query));

  const contPlatosEl = document.getElementById('contador-platos-carta');
  if (contPlatosEl) {
    contPlatosEl.innerText = `${filtrados.length} plato${filtrados.length === 1 ? '' : 's'}`;
  }

  if (filtrados.length === 0) {
    cont.innerHTML = `<div style="text-align: center; padding: 36px 14px; color: #a8a29e;">
      <div style="font-size: 2rem; margin-bottom: 8px;">🍽️</div>
      <p style="margin: 0; font-size: 0.9rem;">No hay platos que coincidan con la búsqueda.</p>
    </div>`;
    return;
  }

  cont.innerHTML = filtrados.map(p => {
    const recsDelPlato = recetasLocal.filter(r => r.product_id === p.id);
    const ingredientesTexto = recsDelPlato.map(r => {
      const ins = insumosLocal.find(i => i.id === r.inventory_item_id);
      return ins ? `${ins.name} (${r.quantity_required} ${ins.unit})` : null;
    }).filter(Boolean).join(' • ');

    let badgeEstado = '';
    if (p._sinInsumos) {
      badgeEstado = `<span class="shopping-card-status status-out" style="font-size:0.7rem; padding: 2px 7px;">🚫 Falta: ${p._faltantes.slice(0, 2).join(', ')}</span>`;
    } else if (p.is_available) {
      badgeEstado = `<span class="shopping-card-status status-ok" style="font-size:0.7rem; padding: 2px 7px;">Disponible</span>`;
    } else {
      badgeEstado = `<span class="shopping-card-status status-low" style="font-size:0.7rem; padding: 2px 7px;">Pausado</span>`;
    }

    const thumbHtml = p.image_url
      ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'" />`
      : getIngredientEmoji(p.name);

    return `
      <div class="menu-dish-item">
        <div class="menu-dish-thumb">${thumbHtml}</div>
        <div class="menu-dish-details">
          <div class="menu-dish-heading">
            <span class="menu-dish-name">${p.name}</span>
            <span class="menu-dish-leader"></span>
            <span class="menu-dish-price">$${parseFloat(p.price).toFixed(2)}</span>
          </div>
          <div class="menu-dish-recipe">
            ${ingredientesTexto ? `📋 <em>${ingredientesTexto}</em>` : `<span style="color:#777; font-style:italic;">Sin receta de insumos asociada</span>`}
          </div>
          <div class="menu-dish-actions">
            ${badgeEstado}
            <button type="button" onclick="abrirModalReceta('${p.id}', '${p.name.replace(/'/g, "\\'")}')" class="btn-secundario" style="padding: 2px 8px; font-size: 0.72rem; border-color: var(--brand-accent); color: var(--brand-accent);">⚙️ Receta</button>
            <button type="button" onclick="toggleDisponibilidadPlato('${p.id}', ${p.is_available})" class="btn-secundario" style="padding: 2px 8px; font-size: 0.72rem;">${p.is_available ? 'Pausar' : 'Activar'}</button>
            <button type="button" onclick="eliminarPlatoMenu('${p.id}', '${p.name.replace(/'/g, "\\'")}')" class="btn-secundario" style="padding: 2px 8px; font-size: 0.72rem; border-color: var(--brand-red); color: #fca5a5;">🗑️ Eliminar</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.filtrarMenuCocina = function() {
  renderizarMenuCocina();
};

window.toggleDisponibilidadPlato = async function(id, estadoActual) {
  const plato = productosLocal.find(p => p.id === id);
  if (!estadoActual && plato && plato._sinInsumos) {
    alert(`No puedes activar "${plato.name}" porque faltan insumos: ${plato._faltantes.join(', ')}.`);
    return;
  }
  await db.from('products').update({ is_available: !estadoActual }).eq('id', id);
  await recargarTodoInventarioYMenu();
};

window.eliminarPlatoMenu = async function(id, nombre) {
  const displayNombre = nombre || 'este plato';
  if (confirm(`¿Seguro que deseas eliminar "${displayNombre}" de la carta?\nSe borrará de la base de datos junto con su receta.`)) {
    await db.from('product_recipes').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
    showToast(`🗑️ Plato "${displayNombre}" eliminado de la carta.`);
    await recargarTodoInventarioYMenu();
  }
};

// Modal de Configurar Receta
window.abrirModalReceta = function(platoId, platoNombre) {
  platoSeleccionadoId = platoId;
  document.getElementById('modal-receta-titulo').innerText = `Receta: ${platoNombre}`;
  
  const selectInsumo = document.getElementById('select-insumo-receta');
  selectInsumo.innerHTML = insumosLocal.map(i => `<option value="${i.id}">${i.name} (${i.unit})</option>`).join('');
  
  renderizarTablaIngredientesReceta();
  document.getElementById('modal-receta').style.display = 'flex';
};

window.cerrarModalReceta = async function() {
  document.getElementById('modal-receta').style.display = 'none';
  platoSeleccionadoId = null;
  await recargarTodoInventarioYMenu();
};

function renderizarTablaIngredientesReceta() {
  const tbody = document.getElementById('tbody-ingredientes-receta');
  const ingredientes = recetasLocal.filter(r => r.product_id === platoSeleccionadoId);

  if (ingredientes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #888; padding: 14px;">Este plato no tiene insumos configurados aún.</td></tr>`;
    return;
  }

  tbody.innerHTML = ingredientes.map(r => {
    const ins = insumosLocal.find(i => i.id === r.inventory_item_id);
    const nombre = ins ? ins.name : 'Insumo eliminado';
    const unidad = ins ? ins.unit : '';
    const stockActual = ins ? ins.quantity : 0;

    return `
      <tr style="border-bottom: 1px solid var(--brand-border);">
        <td style="padding: 8px; color: #fff;">${nombre}</td>
        <td style="padding: 8px; color: var(--brand-accent); font-weight: 700;">${r.quantity_required} ${unidad}</td>
        <td style="padding: 8px; color: #aaa;">${stockActual} ${unidad}</td>
        <td style="padding: 8px; text-align: right;">
          <button type="button" onclick="quitarIngredienteReceta('${r.id}')" style="background:none; border:none; color:#f87171; cursor:pointer;">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('form-agregar-ingrediente')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!platoSeleccionadoId) return;

  const insumoId = document.getElementById('select-insumo-receta').value;
  const cant = parseFloat(document.getElementById('input-cantidad-ingrediente').value);

  const { error } = await db.from('product_recipes').insert([{
    product_id: platoSeleccionadoId,
    inventory_item_id: insumoId,
    quantity_required: cant
  }]);

  if (!error) {
    document.getElementById('input-cantidad-ingrediente').value = '';
    const { data: recs } = await db.from('product_recipes').select('*').in('product_id', productosLocal.map(p => p.id));
    recetasLocal = recs || [];
    renderizarTablaIngredientesReceta();
  } else {
    alert('Error al asociar ingrediente: ' + error.message);
  }
});

window.quitarIngredienteReceta = async function(recetaId) {
  await db.from('product_recipes').delete().eq('id', recetaId);
  recetasLocal = recetasLocal.filter(r => r.id !== recetaId);
  renderizarTablaIngredientesReceta();
};

function actualizarSelectoresVentaYMerma() {
  const selectPlato = document.getElementById('select-plato-salon');
  if (selectPlato) {
    selectPlato.innerHTML = productosLocal.map(p => {
      const bloqueado = p._sinInsumos || (p.stock !== null && p.stock <= 0);
      return `<option value="${p.id}" ${bloqueado ? 'disabled' : ''}>
        ${p.name} ($${parseFloat(p.price).toFixed(2)}) ${bloqueado ? '— [AGOTADO]' : `— Stock: ${p.stock ?? 99}`}
      </option>`;
    }).join('');
  }

  const selectMerma = document.getElementById('merma-item-id');
  if (selectMerma) {
    selectMerma.innerHTML = insumosLocal.map(i => {
      return `<option value="${i.id}">${i.name} (Disp: ${parseFloat(i.quantity).toFixed(1).replace(/\.0$/, '')} ${i.unit})</option>`;
    }).join('');
  }

  actualizarSelectorIngredientesNuevoPlato();
}

// Venta en mostrador (Salón)
document.getElementById('form-venta-salon')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prodId = document.getElementById('select-plato-salon').value;
  const cant = parseInt(document.getElementById('cant-venta-salon').value);
  const prod = productosLocal.find(p => p.id === prodId);
  if (!prod) return;

  if (prod._sinInsumos) {
    alert(`No hay insumos suficientes para preparar ${prod.name}. Faltan: ${prod._faltantes.join(', ')}`);
    return;
  }

  const nuevoStock = Math.max(0, (prod.stock ?? 50) - cant);
  await db.from('products').update({ stock: nuevoStock }).eq('id', prod.id);
  await descontarInsumosPorReceta(prod.id, cant);

  await db.from('kitchen_logs').insert([{
    business_id: localActivo.id,
    log_type: 'venta_salon',
    item_name: prod.name,
    quantity: cant,
    amount_usd: parseFloat(prod.price) * cant,
    notes: 'Venta presencial mostrador'
  }]);

  showToast(`✅ Venta registrada: ${cant}x ${prod.name}`);
  await recargarTodoInventarioYMenu();
  await cargarEstadisticasFinancieras();
});

// ==========================================
// 11. SUSCRIPCIÓN EN TIEMPO REAL
// ==========================================
function suscribirComandasRealtime() {
  db.channel('cocina-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
      playBeepSound();
      cargarComandasCocina();
      cargarEstadisticasFinancieras();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      cargarComandasCocina();
      cargarEstadisticasFinancieras();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => {
      recargarTodoInventarioYMenu();
    })
    .subscribe();
}
