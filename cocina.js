const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const gridPedidos = document.getElementById('grid-pedidos');
const loading = document.getElementById('loading');
const recetaContenedor = document.getElementById('receta-contenedor');
const formNuevoPlato = document.getElementById('form-nuevo-plato');
const tablaInsumosCuerpo = document.getElementById('tabla-insumos-cuerpo');
const tablaPlatosCuerpo = document.getElementById('tabla-platos-cuerpo');

let insumosDisponibles = [];
let listaPlatos = [];

async function cargarTodo() {
  await Promise.all([
    cargarInsumos(),
    cargarPlatosMenu(),
    cargarPedidos()
  ]);
}

// --- SECCIÓN 1: COMANDAS ---
async function cargarPedidos() {
  loading.style.display = 'block';

  const { data: pedidos, error } = await db
    .from('orders')
    .select(`
      id, customer_name, customer_phone, customer_address, status, total, created_at,
      order_items ( quantity, products ( name ) )
    `)
    .in('status', ['recibido', 'en_preparacion', 'listo'])
    .order('created_at', { ascending: true });

  loading.style.display = 'none';

  if (error) {
    gridPedidos.innerHTML = `<p class="alerta">Error: ${error.message}</p>`;
    return;
  }

  if (!pedidos || pedidos.length === 0) {
    gridPedidos.innerHTML = '<p class="alerta">No hay comandas pendientes en este momento.</p>';
    return;
  }

  gridPedidos.innerHTML = pedidos.map(orden => `
    <div class="ticket">
      <div>
        <div class="ticket-header">
          <strong>#ORD-${orden.id}</strong>
          <span class="badge badge-${orden.status}">${orden.status.replace('_', ' ')}</span>
        </div>
        <ul class="ticket-items">
          ${orden.order_items.map(item => `
            <li><strong>${item.quantity}x</strong>${item.products ? item.products.name : 'Plato retirado'}</li>
          `).join('')}
        </ul>
        <div class="ticket-cliente">
          <p><strong>Cliente:</strong> ${orden.customer_name}</p>
          <p><strong>Tlf:</strong> ${orden.customer_phone}</p>
          <p><strong>Ubicación:</strong> ${orden.customer_address}</p>
        </div>
      </div>
      <div class="ticket-acciones">
        ${orden.status === 'recibido' ? `
          <button class="btn-estado" style="background:#f59e0b; color:#000;" onclick="cambiarEstado(${orden.id}, 'en_preparacion')">
            Comenzar Cocina
          </button>` : ''}
        ${orden.status === 'en_preparacion' ? `
          <button class="btn-estado" style="background:#10b981; color:#000;" onclick="cambiarEstado(${orden.id}, 'listo')">
            Marcar Listo
          </button>` : ''}
        ${orden.status === 'listo' ? `
          <button class="btn-estado" style="background:#6366f1; color:#fff;" onclick="cambiarEstado(${orden.id}, 'entregado')">
            Despachado
          </button>` : ''}
      </div>
    </div>
  `).join('');
}

window.cambiarEstado = async function(id, nuevoEstado) {
  const { error } = await db.from('orders').update({ status: nuevoEstado }).eq('id', id);
  if (!error) cargarPedidos();
};

// --- SECCIÓN 2: GESTIÓN DE PLATOS (ACTIVAR / PAUSAR / ELIMINAR) ---
async function cargarPlatosMenu() {
  const { data, error } = await db.from('products').select('*').order('name');
  if (!error && data) {
    listaPlatos = data;
    renderizarTablaPlatos();
  }
}

function renderizarTablaPlatos() {
  tablaPlatosCuerpo.innerHTML = listaPlatos.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small style="color:#888;">${p.description || ''}</small></td>
      <td>${p.category}</td>
      <td style="color:#fbbf24; font-weight:bold;">$${parseFloat(p.price).toFixed(2)}</td>
      <td>
        <button class="btn-toggle ${p.is_active ? 'activo' : 'pausado'}" onclick="toggleVisibilidadPlato(${p.id}, ${p.is_active})">
          ${p.is_active ? '● Activo en web' : '○ Pausado (Oculto)'}
        </button>
      </td>
      <td>
        <button class="btn-peligro" onclick="eliminarPlato(${p.id}, '${p.name}')">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

window.toggleVisibilidadPlato = async function(id, estadoActual) {
  const { error } = await db
    .from('products')
    .update({ is_active: !estadoActual })
    .eq('id', id);

  if (error) {
    alert('Error al cambiar visibilidad: ' + error.message);
  } else {
    cargarPlatosMenu();
  }
};

window.eliminarPlato = async function(id, nombre) {
  const confirmar = confirm(`¿Estás seguro de eliminar "${nombre}" del menú?`);
  if (!confirmar) return;

  const { error } = await db.from('products').delete().eq('id', id);
  if (error) {
    alert('No se pudo eliminar el plato: ' + error.message);
  } else {
    cargarPlatosMenu();
  }
};

// --- SECCIÓN 3: INVENTARIO Y REPOSICIÓN ---
async function cargarInsumos() {
  const { data, error } = await db.from('ingredients').select('*').order('name');
  if (!error && data) {
    insumosDisponibles = data;
    renderizarTablaInsumos();
    if (recetaContenedor.children.length === 0) {
      agregarFilaIngrediente();
    }
  }
}

function renderizarTablaInsumos() {
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
          <button class="btn-secundario" style="padding: 4px 8px; font-size:0.75rem;" onclick="sumarStock(${insumo.id}, '${insumo.name}', '${insumo.unit}')">
            + Añadir Existencias
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.sumarStock = async function(id, nombre, unidad) {
  const cantidadStr = prompt(`¿Cuánta cantidad de "${nombre}" (${unidad}) compraste para sumar al stock?`);
  const cantidad = parseFloat(cantidadStr);
  if (isNaN(cantidad) || cantidad <= 0) return;

  const actual = insumosDisponibles.find(i => i.id === id);
  const nuevoTotal = parseFloat(actual.current_stock) + cantidad;

  const { error } = await db.from('ingredients').update({ current_stock: nuevoTotal }).eq('id', id);
  if (error) {
    alert('Error al reponer stock: ' + error.message);
  } else {
    cargarInsumos();
  }
};

// --- FILAS DINÁMICAS DE RECETAS ---
window.agregarFilaIngrediente = function() {
  const div = document.createElement('div');
  div.className = 'receta-fila';

  const selectOpciones = insumosDisponibles.map(i => 
    `<option value="${i.id}">${i.name} (${i.unit})</option>`
  ).join('');

  div.innerHTML = `
    <select class="ingrediente-select" style="flex: 2; padding: 8px; background: #262626; color: #fff; border: 1px solid #404040; border-radius: 6px;">
      ${selectOpciones}
    </select>
    <input type="number" step="any" placeholder="Cantidad usada" class="ingrediente-cantidad" style="flex: 1;" required />
    <button type="button" class="btn-secundario" onclick="this.parentElement.remove()" style="padding: 6px 10px;">✕</button>
  `;

  recetaContenedor.appendChild(div);
};

// --- CREAR PLATO ---
formNuevoPlato.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombre = document.getElementById('plato-nombre').value.trim();
  const precio = parseFloat(document.getElementById('plato-precio').value);
  const categoria = document.getElementById('plato-categoria').value.trim();
  const descripcion = document.getElementById('plato-desc').value.trim();

  const { data: nuevoProducto, error: prodError } = await db
    .from('products')
    .insert([{
      name: nombre,
      price: precio,
      category: categoria,
      description: descripcion,
      is_active: true
    }])
    .select()
    .single();

  if (prodError) {
    alert('Error al crear plato: ' + prodError.message);
    return;
  }

  const filas = recetaContenedor.querySelectorAll('.receta-fila');
  const ingredientesRelacion = [];

  filas.forEach(fila => {
    const ingredienteId = fila.querySelector('.ingrediente-select').value;
    const cantidad = parseFloat(fila.querySelector('.ingrediente-cantidad').value);

    if (ingredienteId && !isNaN(cantidad)) {
      ingredientesRelacion.push({
        product_id: nuevoProducto.id,
        ingredient_id: ingredienteId,
        quantity_required: cantidad
      });
    }
  });

  if (ingredientesRelacion.length > 0) {
    await db.from('product_ingredients').insert(ingredientesRelacion);
  }

  alert(`¡Plato "${nombre}" agregado al menú con éxito!`);
  formNuevoPlato.reset();
  recetaContenedor.innerHTML = '';
  agregarFilaIngrediente();
  cargarPlatosMenu();
});

// Inicialización
cargarTodo();
// --- REGISTRAR NUEVO INSUMO BASE ---
const formNuevoInsumo = document.getElementById('form-nuevo-insumo');

if (formNuevoInsumo) {
  formNuevoInsumo.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('insumo-nombre').value.trim();
    const unidad = document.getElementById('insumo-unidad').value;
    const stock = parseFloat(document.getElementById('insumo-stock').value);
    const minimo = parseFloat(document.getElementById('insumo-minimo').value);

    const btnSubmit = formNuevoInsumo.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;

    const { error } = await db.from('ingredients').insert([{
      name: nombre,
      unit: unidad,
      current_stock: stock,
      min_stock: minimo
    }]);

    btnSubmit.disabled = false;

    if (error) {
      alert('Error al registrar insumo: ' + error.message);
      return;
    }

    alert(`¡Insumo "${nombre}" agregado al inventario!`);
    formNuevoInsumo.reset();
    await cargarInsumos(); // Actualiza la tabla y los selectores de recetas automáticamente
  });
}
