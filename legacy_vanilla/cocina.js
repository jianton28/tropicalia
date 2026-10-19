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
let miGraficoVentas = null;
let periodoGraficoActual = 'semana';
let filtroInsumosActual = 'criticos';
let platoSeleccionadoId = null;

// Cache de datos para los gráficos
let cacheOrdenesEntregadas = [];
let cacheVentasSalon = [];

// ==========================================
// 1. SALIDA DE SESIÓN A PRUEBA DE FALLOS
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

// ==========================================
// 2. INICIALIZACIÓN
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

  // Respaldo por si el owner_id aún no coincidió en alguna prueba
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
  }
};

// ==========================================
// 3. SINCRONIZACIÓN DE INVENTARIO, RECETAS Y MENÚ
// ==========================================
async function recargarTodoInventarioYMenu() {
  // 1. Cargar insumos del local
  const { data: ins } = await db
    .from('inventory_items')
    .select('*')
    .eq('business_id', localActivo.id)
    .order('name', { ascending: true });
  insumosLocal = ins || [];

  // 2. Cargar productos del local
  const { data: prods } = await db
    .from('products')
    .select('*')
    .eq('business_id', localActivo.id)
    .order('name', { ascending: true });
  productosLocal = prods || [];

  // 3. Cargar todas las recetas asociadas a estos productos
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

  // 4. Evaluar si algún plato tiene insumos agotados y bloquearlo
  await verificarDisponibilidadPorRecetas();

  renderizarInventario();
  verificarAlertasInsumos();
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

    // Si no tiene insumos suficientes o stock 0, aseguramos que en la BD figure no disponible para la tienda
    if ((!evalReceta.ok || (p.stock !== null && p.stock <= 0)) && p.is_available) {
      await db.from('products').update({ is_available: false }).eq('id', p.id);
      p.is_available = false;
    }
  }
}

// ==========================================
// 4. RENDERIZADO COMPACTO DE MENÚ Y BUSCADOR
// ==========================================
function renderizarMenuCocina() {
  const cont = document.getElementById('lista-menu-compacta');
  const query = (document.getElementById('buscador-menu')?.value || '').toLowerCase().trim();
  const filtrados = productosLocal.filter(p => p.name.toLowerCase().includes(query));

  if (filtrados.length === 0) {
    cont.innerHTML = `<p style="padding: 14px; color: #888; text-align: center; margin: 0;">No se encontraron platos.</p>`;
    return;
  }

  cont.innerHTML = filtrados.map(p => {
    const cantIngredientes = recetasLocal.filter(r => r.product_id === p.id).length;
    let badgeEstado = '';
    if (p._sinInsumos) {
      badgeEstado = `<span class="badge" style="background:rgba(239,68,68,0.25); color:#fca5a5;">🚫 Falta: ${p._faltantes.slice(0, 2).join(', ')}</span>`;
    } else if (p.is_available) {
      badgeEstado = `<span class="badge badge-on_the_way">Disponible</span>`;
    } else {
      badgeEstado = `<span class="badge badge-pending">Pausado</span>`;
    }

    return `
      <div class="item-row">
        <div>
          <strong style="color: #fff; font-size: 0.92rem;">${p.name}</strong>
          <div style="font-size: 0.78rem; color: #9ca3af; margin-top: 2px;">
            <span style="color: var(--gold); font-weight: 700;">$${parseFloat(p.price).toFixed(2)}</span> • Stock: ${p.stock ?? 99} • Ingred: ${cantIngredientes}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          ${badgeEstado}
          <button type="button" onclick="abrirModalReceta('${p.id}', '${p.name.replace(/'/g, "\\'")}')" class="btn-secundario" style="padding: 4px 8px; font-size: 0.74rem; border-color: var(--gold); color: var(--gold);">⚙️ Receta</button>
          <button type="button" onclick="toggleDisponibilidadPlato('${p.id}', ${p.is_available})" class="btn-secundario" style="padding: 4px 8px; font-size: 0.74rem;">${p.is_available ? 'Pausar' : 'Activar'}</button>
          <button type="button" onclick="eliminarPlatoMenu('${p.id}')" class="btn-secundario" style="padding: 4px 8px; font-size: 0.74rem; border-color: var(--red); color: #fca5a5;">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

window.filtrarMenuCocina = function() {
  renderizarMenuCocina();
};

document.getElementById('box-nuevo-plato')?.addEventListener('submit', async (e) => {
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
    e.target.reset();
    e.target.style.display = 'none';
    await recargarTodoInventarioYMenu();
  } else {
    alert('Error al agregar plato: ' + error.message);
  }
});

window.toggleDisponibilidadPlato = async function(id, estadoActual) {
  const plato = productosLocal.find(p => p.id === id);
  if (!estadoActual && plato && plato._sinInsumos) {
    alert(`No puedes activar "${plato.name}" porque faltan insumos en inventario: ${plato._faltantes.join(', ')}. Repón el inventario primero.`);
    return;
  }
  await db.from('products').update({ is_available: !estadoActual }).eq('id', id);
  await recargarTodoInventarioYMenu();
};

window.eliminarPlatoMenu = async function(id) {
  if (confirm('¿Seguro que deseas eliminar este plato del menú?')) {
    await db.from('products').delete().eq('id', id);
    await recargarTodoInventarioYMenu();
  }
};

// ==========================================
// 5. RENDERIZADO COMPACTO DE INVENTARIO Y FILTROS
// ==========================================
window.cambiarFiltroInsumos = function(modo) {
  filtroInsumosActual = modo;
  document.getElementById('btn-filtro-criticos').classList.toggle('active', modo === 'criticos');
  document.getElementById('btn-filtro-todos').classList.toggle('active', modo === 'todos');
  renderizarInventario();
};

window.filtrarInsumosCocina = function() {
  renderizarInventario();
};

function renderizarInventario() {
  const cont = document.getElementById('lista-insumos-compacta');
  const query = (document.getElementById('buscador-insumos')?.value || '').toLowerCase().trim();

  let lista = insumosLocal;
  // Si el usuario escribe en el buscador, busca en TODOS los insumos sin importar el tab
  if (query.length > 0) {
    lista = insumosLocal.filter(i => i.name.toLowerCase().includes(query));
  } else if (filtroInsumosActual === 'criticos') {
    lista = insumosLocal.filter(i => parseFloat(i.quantity) <= parseFloat(i.min_threshold));
  }

  if (lista.length === 0) {
    cont.innerHTML = `<p style="padding: 14px; color: #888; text-align: center; margin: 0;">${
      filtroInsumosActual === 'criticos' && query.length === 0
        ? '✅ ¡Excelente! Ningún insumo está en estado crítico. Usa el buscador o pulsa "Todos" para editar.'
        : 'No se encontraron insumos con ese nombre.'
    }</p>`;
    return;
  }

  cont.innerHTML = lista.map(ins => {
    const cant = parseFloat(ins.quantity || 0);
    const min = parseFloat(ins.min_threshold || 0);
    const agotado = cant <= 0;
    const bajo = cant <= min;

    // Incremento inteligente según la unidad (gramos/ml suman de a 100, unidades de a 10)
    const paso = ['g', 'gr', 'ml'].includes((ins.unit || '').toLowerCase()) ? 100 : 10;

    return `
      <div class="item-row">
        <div>
          <strong style="color: ${agotado ? '#ef4444' : bajo ? '#fbbf24' : '#fff'}; font-size: 0.92rem;">
            ${agotado ? '🛑 ' : bajo ? '⚠️ ' : ''}${ins.name}
          </strong>
          <div style="font-size: 0.78rem; color: #9ca3af; margin-top: 2px;">
            Disponible: <strong style="color:#fff;">${cant.toFixed(1).replace(/\.0$/, '')} ${ins.unit}</strong> (Mín: ${min} ${ins.unit})
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <button type="button" onclick="ajustarInsumo('${ins.id}', ${cant}, ${paso})" class="btn-secundario" style="padding: 4px 8px; font-size: 0.74rem; color:#34d399; border-color:#059669;">+${paso}</button>
          <button type="button" onclick="ajustarInsumo('${ins.id}', ${cant}, -${paso / 2})" class="btn-secundario" style="padding: 4px 8px; font-size: 0.74rem; color:#fca5a5; border-color:var(--red);">-${paso / 2}</button>
          <button type="button" onclick="definirStockExactoInsumo('${ins.id}', '${ins.name.replace(/'/g, "\\'")}', ${cant}, '${ins.unit}')" class="btn-secundario" style="padding: 4px 8px; font-size: 0.74rem;">✏️ Fijar</button>
        </div>
      </div>
    `;
  }).join('');
}

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
    e.target.reset();
    e.target.style.display = 'none';
    await recargarTodoInventarioYMenu();
  } else {
    alert('Error al registrar insumo: ' + error.message);
  }
});

window.ajustarInsumo = async function(id, actual, delta) {
  const nuevaCant = Math.max(0, parseFloat(actual) + delta);
  await db.from('inventory_items').update({ quantity: nuevaCant }).eq('id', id);
  await recargarTodoInventarioYMenu();
};

window.definirStockExactoInsumo = async function(id, nombre, actual, unidad) {
  const entrada = prompt(`Ingresa la cantidad exacta disponible de ${nombre} (${unidad}):`, actual);
  if (entrada === null) return;
  const num = parseFloat(entrada);
  if (isNaN(num) || num < 0) return;
  await db.from('inventory_items').update({ quantity: num }).eq('id', id);
  await recargarTodoInventarioYMenu();
};

function verificarAlertasInsumos() {
  const alertaBox = document.getElementById('alerta-insumos-bajos');
  const agotados = insumosLocal.filter(i => parseFloat(i.quantity) <= 0);
  const bajos = insumosLocal.filter(i => parseFloat(i.quantity) > 0 && parseFloat(i.quantity) <= parseFloat(i.min_threshold));

  if (agotados.length > 0 || bajos.length > 0) {
    alertaBox.style.display = 'block';
    let html = '';
    if (agotados.length > 0) {
      html += `<div>🛑 <strong>Agotados (${agotados.length}):</strong> ${agotados.map(b => b.name).join(', ')}</div>`;
    }
    if (bajos.length > 0) {
      html += `<div style="margin-top:4px;">⚠️ <strong>Por agotarse (${bajos.length}):</strong> ${bajos.map(b => `${b.name} (${b.quantity}${b.unit})`).join(', ')}</div>`;
    }
    alertaBox.innerHTML = html;
  } else {
    alertaBox.style.display = 'none';
  }
}

// ==========================================
// 6. MODAL DE RECETAS Y DESCUENTO AUTOMÁTICO
// ==========================================
window.abrirModalReceta = async function(platoId, platoNombre) {
  platoSeleccionadoId = platoId;
  document.getElementById('modal-receta-titulo').innerText = `Receta: ${platoNombre}`;
  document.getElementById('modal-receta').style.display = 'flex';

  const selectInsumo = document.getElementById('select-insumo-receta');
  selectInsumo.innerHTML = insumosLocal.map(i => `<option value="${i.id}">${i.name} (Stock: ${i.quantity} ${i.unit})</option>`).join('');

  await cargarIngredientesReceta(platoId);
};

window.cerrarModalReceta = async function() {
  document.getElementById('modal-receta').style.display = 'none';
  platoSeleccionadoId = null;
  await recargarTodoInventarioYMenu();
};

async function cargarIngredientesReceta(platoId) {
  const tbody = document.getElementById('tbody-ingredientes-receta');
  const { data, error } = await db
    .from('product_recipes')
    .select('*, inventory_items(name, unit, quantity)')
    .eq('product_id', platoId);

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #888; padding: 12px;">Sin ingredientes asociados aún.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(rec => {
    const disp = parseFloat(rec.inventory_items?.quantity || 0);
    const req = parseFloat(rec.quantity_required || 0);
    const alcanza = disp >= req;
    return `
      <tr style="border-bottom: 1px solid #222;">
        <td style="padding: 8px;">${rec.inventory_items?.name || 'Insumo'}</td>
        <td style="padding: 8px; color: var(--gold); font-weight:600;">${req} ${rec.inventory_items?.unit || ''}</td>
        <td style="padding: 8px; color: ${alcanza ? '#34d399' : '#ef4444'};">${disp} ${rec.inventory_items?.unit || ''}</td>
        <td style="padding: 8px; text-align: right;">
          <button type="button" onclick="eliminarIngredienteReceta('${rec.id}', '${platoId}')" class="btn-secundario" style="padding: 2px 7px; font-size: 0.72rem; border-color: var(--red); color: #fca5a5;">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('form-agregar-ingrediente')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!platoSeleccionadoId) return;

  const inventory_item_id = document.getElementById('select-insumo-receta').value;
  const quantity_required = parseFloat(document.getElementById('input-cantidad-ingrediente').value);

  // Evitar duplicar el mismo ingrediente en el mismo plato
  const existente = recetasLocal.find(r => r.product_id === platoSeleccionadoId && r.inventory_item_id === inventory_item_id);
  if (existente) {
    await db.from('product_recipes').update({ quantity_required }).eq('id', existente.id);
  } else {
    await db.from('product_recipes').insert([{
      product_id: platoSeleccionadoId,
      inventory_item_id,
      quantity_required
    }]);
  }

  document.getElementById('input-cantidad-ingrediente').value = '';
  await cargarIngredientesReceta(platoSeleccionadoId);
});

window.eliminarIngredienteReceta = async function(recetaId, platoId) {
  await db.from('product_recipes').delete().eq('id', recetaId);
  await cargarIngredientesReceta(platoId);
};

async function descontarInsumosPorReceta(productoId, cantidadVendida) {
  const { data: receta } = await db
    .from('product_recipes')
    .select('inventory_item_id, quantity_required')
    .eq('product_id', productoId);

  if (!receta || receta.length === 0) return;

  for (const item of receta) {
    const { data: insumo } = await db
      .from('inventory_items')
      .select('quantity')
      .eq('id', item.inventory_item_id)
      .maybeSingle();

    if (insumo) {
      const stockActual = parseFloat(insumo.quantity || 0);
      const consumoTotal = parseFloat(item.quantity_required) * parseFloat(cantidadVendida);
      const nuevoStock = Math.max(0, stockActual - consumoTotal);

      await db.from('inventory_items')
        .update({ quantity: nuevoStock })
        .eq('id', item.inventory_item_id);
    }
  }
}

// ==========================================
// 7. VENTA FÍSICA EN SALÓN Y MERMAS REALES
// ==========================================
function actualizarSelectoresVentaYMerma() {
  const selectSalon = document.getElementById('select-plato-salon');
  if (selectSalon) {
    selectSalon.innerHTML = productosLocal.map(p => {
      const bloqueado = p._sinInsumos || (p.stock !== null && p.stock <= 0);
      return `<option value="${p.id}" ${bloqueado ? 'disabled' : ''}>
        ${p.name} ($${parseFloat(p.price).toFixed(2)}) ${bloqueado ? '— [SIN INSUMOS / AGOTADO]' : `— Stock: ${p.stock ?? 99}`}
      </option>`;
    }).join('');
  }
  actualizarSelectorMerma();
}

window.actualizarSelectorMerma = function() {
  const tipo = document.getElementById('merma-tipo')?.value || 'insumo';
  const selectItem = document.getElementById('merma-item-id');
  if (!selectItem) return;

  if (tipo === 'insumo') {
    selectItem.innerHTML = insumosLocal.map(i => `<option value="${i.id}">${i.name} (Disp: ${i.quantity} ${i.unit})</option>`).join('');
  } else {
    selectItem.innerHTML = productosLocal.map(p => `<option value="${p.id}">${p.name} (Descontará su receta)</option>`).join('');
  }
};

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

  // Descontar ingredientes de la receta en inventario
  await descontarInsumosPorReceta(prod.id, cant);

  await db.from('kitchen_logs').insert([{
    business_id: localActivo.id,
    log_type: 'venta_salon',
    item_name: prod.name,
    quantity: cant,
    amount_usd: parseFloat(prod.price) * cant,
    notes: 'Venta presencial en mostrador'
  }]);

  alert(`✅ Venta registrada: ${cant}x ${prod.name}. Insumos descontados del inventario.`);
  await recargarTodoInventarioYMenu();
  await cargarEstadisticasFinancieras();
});

document.getElementById('form-merma')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = document.getElementById('merma-tipo').value;
  const itemId = document.getElementById('merma-item-id').value;
  const cant = parseFloat(document.getElementById('merma-cantidad').value);
  const motivo = document.getElementById('merma-motivo').value.trim();

  let nombreAfectado = '';

  if (tipo === 'insumo') {
    const ins = insumosLocal.find(i => i.id === itemId);
    if (!ins) return;
    nombreAfectado = `${ins.name} (${ins.unit})`;
    const nuevoStock = Math.max(0, parseFloat(ins.quantity || 0) - cant);
    await db.from('inventory_items').update({ quantity: nuevoStock }).eq('id', ins.id);
  } else {
    const prod = productosLocal.find(p => p.id === itemId);
    if (!prod) return;
    nombreAfectado = `Plato: ${prod.name}`;
    const nuevoStockPlato = Math.max(0, (prod.stock ?? 50) - cant);
    await db.from('products').update({ stock: nuevoStockPlato }).eq('id', prod.id);
    await descontarInsumosPorReceta(prod.id, cant);
  }

  await db.from('kitchen_logs').insert([{
    business_id: localActivo.id,
    log_type: 'merma',
    item_name: nombreAfectado,
    quantity: cant,
    amount_usd: 0,
    notes: motivo
  }]);

  alert(`🗑️ Merma asentada: Se descontó ${cant} de ${nombreAfectado} del inventario.`);
  e.target.reset();
  await recargarTodoInventarioYMenu();
});

// ==========================================
// 8. COMANDAS EN TIEMPO REAL Y DESPACHO
// ==========================================
window.cargarComandasCocina = async function() {
  if (!localActivo) return;
  const gridComandas = document.getElementById('grid-comandas');

  // Consultamos todas las órdenes del local sin restringir estados que puedan ocultar nuevas órdenes
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

  // Calcular montos entregados HOY para corte de turno
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);

  const entregadasHoy = comandasActivas.filter(o => o.status === 'delivered' && new Date(o.created_at) >= hoyInicio);
  const bruto = entregadasHoy.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);
  document.getElementById('corte-bruto').innerText = `$${bruto.toFixed(2)}`;
  document.getElementById('corte-neto').innerText = `$${(bruto * 0.90).toFixed(2)}`;

  // Filtrar comandas activas que están en cocina o esperando entrega
  const enCurso = comandasActivas.filter(o => !['delivered', 'cancelled', 'rejected'].includes(o.status));
  if (enCurso.length === 0) {
    gridComandas.innerHTML = '<p style="color:#888;">No hay comandas pendientes en cocina en este momento.</p>';
    return;
  }

  gridComandas.innerHTML = enCurso.map(ord => {
    const itemsLista = Array.isArray(ord.items) ? ord.items : [];
    const itemsHtml = itemsLista.map(i => `<div><strong>${i.quantity || 1}x ${i.name}</strong> ($${parseFloat(i.price || 0).toFixed(2)})</div>`).join('');
    
    let badgeEtaDelivery = '';
    if (ord.delivery_type === 'delivery') {
      if (!ord.driver_id) {
        badgeEtaDelivery = `<div style="background:#262626; padding:6px 10px; border-radius:6px; font-size:0.8rem; color:#fbbf24; margin-top:8px;">🛵 Buscando repartidor cercano...</div>`;
      } else if (ord.delivery_status === 'accepted') {
        const eta = ord.driver_eta_mins || 8;
        badgeEtaDelivery = `<div style="background:rgba(251,191,36,0.15); border:1px solid var(--gold); padding:6px 10px; border-radius:6px; font-size:0.8rem; color:var(--gold); margin-top:8px;">🛵 <strong>Repartidor en camino al local:</strong> Llega en ~${eta} min</div>`;
      } else if (ord.delivery_status === 'arrived_at_store') {
        badgeEtaDelivery = `<div style="background:rgba(16,185,129,0.2); border:1px solid var(--green); padding:6px 10px; border-radius:6px; font-size:0.8rem; color:#34d399; margin-top:8px;">✅ <strong>¡Repartidor en puerta!</strong> Entrega el paquete sellado.</div>`;
      } else if (ord.delivery_status === 'on_the_way') {
        badgeEtaDelivery = `<div style="background:#1f2937; padding:6px 10px; border-radius:6px; font-size:0.8rem; color:#9ca3af; margin-top:8px;">🚀 En manos del repartidor rumbo al cliente.</div>`;
      }
    }

    let btnSiguiente = '';
    if (['pending', 'confirmed', 'paid'].includes(ord.status)) {
      btnSiguiente = `<button type="button" onclick="cambiarEstadoComanda('${ord.id}', 'cooking')" class="btn-primario" style="flex:1;">👨‍🍳 Pasar a Cocinando (Descontar Receta)</button>`;
    } else if (ord.status === 'cooking') {
      if (ord.delivery_type === 'pickup') {
        btnSiguiente = `<button type="button" onclick="cambiarEstadoComanda('${ord.id}', 'delivered')" class="btn-primario" style="flex:1; background:var(--green);">🛍️ Entregar a Cliente (Pickup)</button>`;
      } else {
        btnSiguiente = `<button type="button" onclick="cambiarEstadoComanda('${ord.id}', 'on_the_way')" class="btn-primario" style="flex:1; background:var(--green);">📦 Entregar a Motorizado / Listo</button>`;
      }
    }

    return `
      <div class="card" style="border-left: 4px solid var(--gold);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong>#ORD-${ord.id.slice(0, 8)}</strong>
          <span class="badge badge-${ord.status}">${ord.status.toUpperCase()}</span>
        </div>
        <div style="font-size: 0.9rem; border-bottom: 1px dashed #333; padding-bottom: 8px; margin-bottom: 8px;">
          ${itemsHtml || '<em>Detalle de orden</em>'}
        </div>
        <div style="font-size: 0.82rem; color: #ccc;">
          <div><strong>Cliente:</strong> ${ord.customer_name || 'Cliente'} (${ord.customer_phone || 'S/N'})</div>
          <div><strong>Modalidad:</strong> ${ord.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'} • <strong>Pago:</strong> ${(ord.payment_method || 'Digital').toUpperCase()}</div>
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

  // Cuando pasa a 'cooking' descontamos los insumos de la receta y el stock del plato
  if (nuevoEstado === 'cooking') {
    const ordenObj = comandasActivas.find(o => o.id === ordenId);
    if (ordenObj && Array.isArray(ordenObj.items)) {
      for (const item of ordenObj.items) {
        const cant = parseInt(item.quantity || 1);
        // Buscar producto por ID o por Nombre exacto
        const prod = productosLocal.find(p => p.id === item.id || p.name.toLowerCase() === (item.name || '').toLowerCase());
        if (prod) {
          const nuevoStock = Math.max(0, (prod.stock ?? 50) - cant);
          await db.from('products').update({ stock: nuevoStock }).eq('id', prod.id);
          await descontarInsumosPorReceta(prod.id, cant);
        }
      }
      await recargarTodoInventarioYMenu();
    }
  }

  await db.from('orders').update(payload).eq('id', ordenId);
  await cargarComandasCocina();
  await cargarEstadisticasFinancieras();
};

// ==========================================
// 9. ESTADÍSTICAS Y GRÁFICO (DÍA, SEMANA, MES, AÑO)
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

  // Unificar ingresos de órdenes entregadas + ventas de salón
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

  document.getElementById('stat-dia').innerText = `$${totalDia.toFixed(2)}`;
  document.getElementById('stat-semana').innerText = `$${totalSemana.toFixed(2)}`;
  document.getElementById('stat-mes').innerText = `$${totalMes.toFixed(2)}`;
  document.getElementById('stat-anio').innerText = `$${totalAnio.toFixed(2)}`;
  const corteSalonEl = document.getElementById('corte-salon');
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
    // Últimas 24 horas agrupadas en bloques de 3 horas del día de hoy
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
    // Últimos 7 días
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
    // Últimos 30 días agrupados por semana del mes
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
    // 12 meses del año actual
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
        backgroundColor: '#fbbf24',
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

// ==========================================
// 10. LIQUIDACIÓN DE TURNO Y REALTIME
// ==========================================
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
    alert(`✅ Solicitud de liquidación enviada por $${neto.toFixed(2)}. Administración procesará tu transferencia.`);
  } else {
    alert('Error al enviar corte: ' + error.message);
  }
};

function suscribirComandasRealtime() {
  db.channel('cocina-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      cargarComandasCocina();
      cargarEstadisticasFinancieras();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => {
      recargarTodoInventarioYMenu();
    })
    .subscribe();
}