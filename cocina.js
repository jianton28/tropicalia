const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let negocioId = null;
let insumosDisponibles = [];
let listaPlatos = [];
let ventasChartInstance = null;
let periodoSeleccionado = 'dia';
let pedidosHistoricos = [];

// Elementos DOM
const vistaLogin = document.getElementById('vista-login');
const vistaPanel = document.getElementById('vista-panel');
const formLogin = document.getElementById('form-login');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnLogin = document.getElementById('btn-login');
const panelNombreNegocio = document.getElementById('panel-nombre-negocio');

const gridPedidos = document.getElementById('grid-pedidos');
const loading = document.getElementById('loading');
const recetaContenedor = document.getElementById('receta-contenedor');
const formNuevoPlato = document.getElementById('form-nuevo-plato');
const formNuevoInsumo = document.getElementById('form-nuevo-insumo');
const tablaInsumosCuerpo = document.getElementById('tabla-insumos-cuerpo');
const tablaPlatosCuerpo = document.getElementById('tabla-platos-cuerpo');

// --- AUTENTICACIÓN ---
if (formLogin) {
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    btnLogin.disabled = true;
    btnLogin.innerText = 'Verificando...';

    try {
      const { data, error } = await db.auth.signInWithPassword({
        email: loginEmail.value.trim(),
        password: loginPassword.value.trim()
      });

      if (error) throw error;
      await inicializarSesion(data.user);
    } catch (err) {
      loginError.innerText = 'Acceso denegado: ' + err.message;
      loginError.style.display = 'block';
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerText = 'Ingresar al Panel';
    }
  });
}

async function inicializarSesion(user) {
  try {
    const { data: perfil, error: errPerfil } = await db
      .from('kitchen_profiles')
      .select('business_id, businesses(name)')
      .eq('id', user.id)
      .single();

    if (errPerfil || !perfil) {
      throw new Error('Este usuario no tiene un restaurante vinculado.');
    }

    negocioId = perfil.business_id;
    panelNombreNegocio.innerText = `${perfil.businesses.name} - Operaciones`;

    vistaLogin.style.display = 'none';
    vistaPanel.style.display = 'block';

    await cargarTodo();
    suscribirTiempoReal();
  } catch (err) {
    loginError.innerText = err.message;
    loginError.style.display = 'block';
    await db.auth.signOut();
  }
}

window.cerrarSesion = async function() {
  await db.auth.signOut();
  negocioId = null;
  vistaPanel.style.display = 'none';
  vistaLogin.style.display = 'block';
  formLogin.reset();
};

// --- CÁLCULO DE CRONÓMETRO ---
function calcularTiempoEspera(fechaISO) {
  const minutos = Math.floor((new Date() - new Date(fechaISO)) / 60000);

  if (minutos < 15) {
    return { texto: `⏱️ ${minutos} min`, claseCard: 'alerta-optimo', claseTiempo: 'tiempo-optimo' };
  } else if (minutos <= 25) {
    return { texto: `⏳ ${minutos} min`, claseCard: 'alerta-demorado', claseTiempo: 'tiempo-demorado' };
  } else {
    return { texto: `🚨 ${minutos} min (Retrasado)`, claseCard: 'alerta-critico', claseTiempo: 'tiempo-critico' };
  }
}

async function cargarTodo() {
  if (!negocioId) return;
  await Promise.all([
    cargarInsumos(),
    cargarPlatosMenu(),
    cargarPedidos(),
    cargarDashboardFinanciero()
  ]);
}

// --- COMANDAS ---
async function cargarPedidos() {
  if (loading) loading.style.display = 'block';

  const { data: pedidos, error } = await db
    .from('orders')
    .select('*')
    .eq('business_id', negocioId)
    .in('status', ['pending', 'cooking', 'on_the_way'])
    .order('created_at', { ascending: true });

  if (loading) loading.style.display = 'none';

  if (error) {
    gridPedidos.innerHTML = `<p class="alerta">Error: ${error.message}</p>`;
    return;
  }

  if (!pedidos || pedidos.length === 0) {
    gridPedidos.innerHTML = '<p class="alerta">No hay comandas pendientes en este momento.</p>';
    return;
  }

  gridPedidos.innerHTML = pedidos.map(orden => {
    const alertaTiempo = calcularTiempoEspera(orden.created_at);
    const items = Array.isArray(orden.items) ? orden.items : [];

    return `
      <div class="ticket ${alertaTiempo.claseCard}">
        <div>
          <div class="ticket-header">
            <div>
              <strong>#ORD-${orden.id.slice(0, 8)}</strong>
              <span class="tiempo-badge ${alertaTiempo.claseTiempo}">${alertaTiempo.texto}</span>
            </div>
            <span class="badge badge-${orden.status}">${orden.status}</span>
          </div>

          <ul class="ticket-items">
            ${items.map(item => `<li><strong>${item.quantity}x</strong> ${item.name} ($${item.subtotal})</li>`).join('')}
          </ul>

          <div class="ticket-cliente">
            <p><strong>Cliente:</strong> ${orden.customer_name}</p>
            <p><strong>Tlf:</strong> ${orden.customer_phone}</p>
            <p><strong>Dirección:</strong> ${orden.delivery_address || 'No indicada'}</p>
            ${orden.map_url ? `<p><a href="${orden.map_url}" target="_blank" style="color: #fbbf24;">📍 Ver Mapa GPS</a></p>` : ''}
          </div>
        </div>

        <div class="ticket-acciones">
          ${orden.status === 'pending' ? `
            <button class="btn-estado" style="background:#f59e0b; color:#000;" onclick="cambiarEstado('${orden.id}', 'cooking')">
              Comenzar Cocina
            </button>` : ''}

          ${orden.status === 'cooking' ? `
            <button class="btn-estado" style="background:#10b981; color:#000;" onclick="cambiarEstado('${orden.id}', 'on_the_way')">
              Listo / En Camino
            </button>` : ''}

          ${orden.status === 'on_the_way' ? `
            <button class="btn-estado" style="background:#6366f1; color:#fff;" onclick="cambiarEstado('${orden.id}', 'delivered')">
              Despachado
            </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.cambiarEstado = async function(id, nuevoEstado) {
  const { error } = await db.from('orders').update({ status: nuevoEstado }).eq('id', id);
  if (!error) cargarPedidos();
};

// --- CATÁLOGO DE PLATOS ---
async function cargarPlatosMenu() {
  const { data, error } = await db
    .from('products')
    .select('*')
    .eq('business_id', negocioId)
    .order('name');

  if (!error && data) {
    listaPlatos = data;
    renderizarTablaPlatos();
  }
}

function renderizarTablaPlatos() {
  if (!tablaPlatosCuerpo) return;
  tablaPlatosCuerpo.innerHTML = listaPlatos.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small style="color:#888;">${p.description || ''}</small></td>
      <td style="color:#fbbf24; font-weight:bold;">$${parseFloat(p.price).toFixed(2)}</td>
      <td>
        <button class="btn-toggle ${p.is_available ? 'activo' : 'pausado'}" onclick="toggleVisibilidadPlato('${p.id}', ${p.is_available})">
          ${p.is_available ? '● Activo en web' : '○ Pausado (Oculto)'}
        </button>
      </td>
      <td>
        <button class="btn-peligro" onclick="eliminarPlato('${p.id}', '${p.name}')">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

window.toggleVisibilidadPlato = async function(id, estadoActual) {
  const { error } = await db
    .from('products')
    .update({ is_available: !estadoActual })
    .eq('id', id);

  if (error) {
    alert('Error al cambiar visibilidad: ' + error.message);
  } else {
    cargarPlatosMenu();
  }
};

window.eliminarPlato = async function(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}" del menú?`)) return;

  const { error } = await db.from('products').delete().eq('id', id);
  if (error) {
    alert('No se pudo eliminar: ' + error.message);
  } else {
    cargarPlatosMenu();
  }
};

// --- GESTIÓN DE INSUMOS ---
async function cargarInsumos() {
  const { data, error } = await db
    .from('ingredients')
    .select('*')
    .eq('business_id', negocioId)
    .order('name');

  if (!error && data) {
    insumosDisponibles = data;
    renderizarTablaInsumos();
  }
}

function renderizarTablaInsumos() {
  if (!tablaInsumosCuerpo) return;
  tablaInsumosCuerpo.innerHTML = insumosDisponibles.map(insumo => {
    const bajoStock = parseFloat(insumo.current_stock) <= parseFloat(insumo.min_stock);
    return `
      <tr>
        <td><strong>${insumo.name}</strong></td>
        <td style="color: ${bajoStock ? '#ef4444' : '#10b981'}; font-weight:bold; font-size:1rem;">
          ${insumo.current_stock}
        </td>
        <td>${insumo.unit}</td>
        <td>${bajoStock ? '⚠️ Reponer stock' : '✅ Suficiente'}</td>
        <td>
          <button class="btn-secundario" style="padding: 4px 8px; font-size:0.75rem;" onclick="sumarStock('${insumo.id}', '${insumo.name}', '${insumo.unit}')">
            + Añadir Existencias
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.sumarStock = async function(id, nombre, unidad) {
  const cantidadStr = prompt(`¿Cuánta cantidad de "${nombre}" (${unidad}) compraste para sumar?`);
  const cantidad = parseFloat(cantidadStr);
  if (isNaN(cantidad) || cantidad <= 0) return;

  const actual = insumosDisponibles.find(i => i.id === id);
  const nuevoTotal = parseFloat(actual.current_stock) + cantidad;

  const { error } = await db.from('ingredients').update({ current_stock: nuevoTotal }).eq('id', id);
  if (!error) cargarInsumos();
};

// --- CREAR PLATO ---
if (formNuevoPlato) {
  formNuevoPlato.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('plato-nombre').value.trim();
    const precio = parseFloat(document.getElementById('plato-precio').value);
    const descripcion = document.getElementById('plato-desc').value.trim();

    const { error } = await db
      .from('products')
      .insert([{
        business_id: negocioId,
        name: nombre,
        price: precio,
        description: descripcion,
        is_available: true
      }]);

    if (error) {
      alert('Error al crear plato: ' + error.message);
      return;
    }

    alert(`¡Plato "${nombre}" agregado con éxito!`);
    formNuevoPlato.reset();
    cargarPlatosMenu();
  });
}

// --- REGISTRAR INSUMO ---
if (formNuevoInsumo) {
  formNuevoInsumo.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('insumo-nombre').value.trim();
    const unidad = document.getElementById('insumo-unidad').value;
    const stock = parseFloat(document.getElementById('insumo-stock').value);
    const minimo = parseFloat(document.getElementById('insumo-minimo').value);

    const { error } = await db.from('ingredients').insert([{
      business_id: negocioId,
      name: nombre,
      unit: unidad,
      current_stock: stock,
      min_stock: minimo
    }]);

    if (error) {
      alert('Error al registrar insumo: ' + error.message);
      return;
    }

    formNuevoInsumo.reset();
    await cargarInsumos();
  });
}

// --- DASHBOARD FINANCIERO ---
window.filtrarPeriodo = function(periodo, boton) {
  periodoSeleccionado = periodo;
  document.querySelectorAll('.btn-filtro').forEach(btn => btn.classList.remove('activo'));
  boton.classList.add('activo');
  procesarMetricasYGrafica();
};

async function cargarDashboardFinanciero() {
  const { data: ordenes, error } = await db
    .from('orders')
    .select('id, total, status, created_at')
    .eq('business_id', negocioId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true });

  if (!error && ordenes) {
    pedidosHistoricos = ordenes;
    procesarMetricasYGrafica();
  }
}

function procesarMetricasYGrafica() {
  const ahora = new Date();
  let totalFacturado = 0;
  let conteoPedidos = 0;
  const gruposGrafica = {};

  pedidosHistoricos.forEach(orden => {
    const fOrden = new Date(orden.created_at);
    let entraEnPeriodo = false;
    let etiquetaEjeX = '';

    if (periodoSeleccionado === 'dia') {
      entraEnPeriodo = fOrden.toDateString() === ahora.toDateString();
      etiquetaEjeX = `${fOrden.getHours().toString().padStart(2, '0')}:00`;
    } else if (periodoSeleccionado === 'mes') {
      entraEnPeriodo = fOrden.getMonth() === ahora.getMonth() && fOrden.getFullYear() === ahora.getFullYear();
      etiquetaEjeX = `Día ${fOrden.getDate()}`;
    } else if (periodoSeleccionado === 'ano') {
      entraEnPeriodo = fOrden.getFullYear() === ahora.getFullYear();
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      etiquetaEjeX = meses[fOrden.getMonth()];
    }

    if (entraEnPeriodo) {
      const tot = parseFloat(orden.total) || 0;
      totalFacturado += tot;
      conteoPedidos++;
      gruposGrafica[etiquetaEjeX] = (gruposGrafica[etiquetaEjeX] || 0) + tot;
    }
  });

  const kpiTotal = document.getElementById('kpi-total');
  const kpiPedidos = document.getElementById('kpi-pedidos');
  if (kpiTotal) kpiTotal.textContent = `$${totalFacturado.toFixed(2)}`;
  if (kpiPedidos) kpiPedidos.textContent = conteoPedidos;

  renderizarGrafica(Object.keys(gruposGrafica), Object.values(gruposGrafica));
}

function renderizarGrafica(etiquetas, datos) {
  const ctx = document.getElementById('graficaVentas');
  if (!ctx) return;

  if (ventasChartInstance) ventasChartInstance.destroy();

  ventasChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: etiquetas.length ? etiquetas : ['Sin ventas en este período'],
      datasets: [{
        label: 'Ventas ($)',
        data: datos.length ? datos : [0],
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: '#fbbf24'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
        y: { ticks: { color: '#888', callback: v => `$${v}` }, grid: { color: '#2a2a2a' }, beginAtZero: true }
      }
    }
  });
}

function suscribirTiempoReal() {
  db.channel('cocina-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `business_id=eq.${negocioId}`
    }, () => {
      cargarPedidos();
      cargarDashboardFinanciero();
    })
    .subscribe();
}

// Comprobación inicial de sesión
(async () => {
  const { data: { user } } = await db.auth.getUser();
  if (user) {
    await inicializarSesion(user);
  }
})();
let listaInsumosDisponibles = [];

// 1. Al cargar insumos del negocio, guardamos la lista en memoria
async function cargarInsumos() {
  const { data, error } = await db
    .from('ingredients')
    .select('*')
    .eq('business_id', currentBusinessId);

  if (error) return console.error(error);
  listaInsumosDisponibles = data || [];
  renderizarTablaInsumos(listaInsumosDisponibles);
}

// 2. Evento para añadir una fila dinámica de receta
document.getElementById('btn-agregar-insumo-receta').addEventListener('click', () => {
  if (listaInsumosDisponibles.length === 0) {
    alert('Primero debes registrar insumos en el inventario inferior.');
    return;
  }

  const contenedor = document.getElementById('contenedor-receta');
  const fila = document.createElement('div');
  fila.className = 'fila-receta';
  fila.style = 'display: flex; gap: 8px; align-items: center;';

  let opciones = listaInsumosDisponibles.map(i => `<option value="${i.id}">${i.name} (${i.unit})</option>`).join('');

  fila.innerHTML = `
    <select class="receta-insumo-id" style="flex: 2; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;">
      ${opciones}
    </select>
    <input type="number" step="0.01" min="0.01" class="receta-cantidad" placeholder="Cant. por ración" required style="flex: 1; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;" />
    <button type="button" onclick="this.parentElement.remove()" style="background: #991b1b; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer;">✕</button>
  `;
  contenedor.appendChild(fila);
});

// 3. Al guardar el nuevo plato, insertar también en product_ingredients
async function guardarNuevoPlato(e) {
  e.preventDefault();
  const nombre = document.getElementById('plato-nombre').value.trim();
  const precio = parseFloat(document.getElementById('plato-precio').value);
  const descripcion = document.getElementById('plato-desc').value.trim();

  // Guardar plato
  const { data: plato, error: errPlato } = await db
    .from('products')
    .insert([{
      business_id: currentBusinessId,
      name: nombre,
      price: precio,
      description: descripcion,
      is_available: true
    }])
    .select()
    .single();

  if (errPlato) {
    alert('Error al crear plato: ' + errPlato.message);
    return;
  }

  // Guardar relaciones de receta
  const filasReceta = document.querySelectorAll('.fila-receta');
  const asociaciones = [];

  filasReceta.forEach(f => {
    const ingredient_id = f.querySelector('.receta-insumo-id').value;
    const quantity_required = parseFloat(f.querySelector('.receta-cantidad').value);
    if (ingredient_id && quantity_required > 0) {
      asociaciones.push({
        product_id: plato.id,
        ingredient_id: ingredient_id,
        quantity_required: quantity_required
      });
    }
  });

  if (asociaciones.length > 0) {
    const { error: errReceta } = await db.from('product_ingredients').insert(asociaciones);
    if (errReceta) console.error('Error al asociar ingredientes:', errReceta);
  }

  alert('¡Plato y receta guardados con éxito!');
  document.getElementById('contenedor-receta').innerHTML = '';
  cargarMenu();
}