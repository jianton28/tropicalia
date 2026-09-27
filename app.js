// Configuración de Supabase
const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

// Inicializar cliente desde la librería cargada por CDN
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado de la aplicación
let productos = [];
let carrito = [];

// Elementos del DOM
const gridProductos = document.getElementById('grid-productos');
const loading = document.getElementById('loading');
const cartCount = document.getElementById('cart-count');
const carritoItems = document.getElementById('carrito-items');
const carritoVacio = document.getElementById('carrito-vacio');
const carritoTotalPrecio = document.getElementById('carrito-total-precio');
const formPedido = document.getElementById('form-pedido');
const notas = document.getElementById('cliente-notas').value.trim();
const { data: orden, error: ordenError } = await db
  .from('orders')
  .insert([{
    customer_name: nombre,
    customer_phone: telefono,
    customer_address: direccion,
    notes: notas, // Campo guardado en la orden
    total: totalPedido,
    status: 'recibido'
  }])
  .select()
  .single();

// 1. Cargar productos desde Supabase
async function obtenerMenu() {
  try {
    const { data, error } = await db
      .from('products')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    productos = data || [];
    renderizarCatalogo();
  } catch (err) {
    loading.innerText = 'Error al cargar los productos: ' + err.message;
  }
}

// 2. Renderizar platos en pantalla
function renderizarCatalogo() {
  loading.style.display = 'none';

  if (productos.length === 0) {
    gridProductos.innerHTML = '<p class="alerta">No hay productos disponibles.</p>';
    return;
  }

  gridProductos.innerHTML = productos.map(item => `
    <div class="card">
      <div>
        <h3>${item.name}</h3>
        <p>${item.description || ''}</p>
      </div>
      <div class="card-footer">
        <span class="precio">$${parseFloat(item.price).toFixed(2)}</span>
        <button class="btn-primario" style="width: auto;" onclick="agregarAlCarrito(${item.id})">
          + Agregar
        </button>
      </div>
    </div>
  `).join('');
}

// 3. Manejo del Carrito
window.agregarAlCarrito = function(id) {
  const item = productos.find(p => p.id === id);
  if (!item) return;

  const existente = carrito.find(p => p.id === id);
  if (existente) {
    existente.cantidad += 1;
  } else {
    carrito.push({ ...item, cantidad: 1 });
  }

  actualizarCarrito();
};

window.eliminarDelCarrito = function(id) {
  carrito = carrito.filter(p => p.id !== id);
  actualizarCarrito();
};

function actualizarCarrito() {
  const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
  const totalPrecio = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);

  cartCount.innerText = totalItems;
  carritoTotalPrecio.innerText = `$${totalPrecio.toFixed(2)}`;

  if (carrito.length === 0) {
    carritoVacio.style.display = 'block';
    carritoItems.innerHTML = '';
    formPedido.style.display = 'none';
    return;
  }

  carritoVacio.style.display = 'none';
  formPedido.style.display = 'flex';

  carritoItems.innerHTML = carrito.map(item => `
    <div class="item-carrito">
      <div>
        <div><strong>${item.name}</strong></div>
        <small>${item.cantidad} x $${parseFloat(item.price).toFixed(2)}</small>
      </div>
      <button class="btn-secundario" style="padding: 2px 6px;" onclick="eliminarDelCarrito(${item.id})">✕</button>
    </div>
  `).join('');
}

// 4. Enviar Pedido a Supabase y notificar
formPedido.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombre = document.getElementById('cliente-nombre').value.trim();
  const telefono = document.getElementById('cliente-telefono').value.trim();
  const direccion = document.getElementById('cliente-direccion').value.trim();
  const total = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);

  const btnSubmit = formPedido.querySelector('button[type="submit"]');
  btnSubmit.disabled = true;
  btnSubmit.innerText = 'Enviando pedido...';

  try {
    // A) Insertar el pedido en la tabla 'orders'
    const { data: orden, error: ordenError } = await db
      .from('orders')
      .insert([{
        customer_name: nombre,
        customer_phone: telefono,
        customer_address: direccion,
        total: total,
        status: 'recibido'
      }])
      .select()
      .single();

    if (ordenError) throw ordenError;

    // B) Insertar el desglose de productos en 'order_items'
    const itemsParaGuardar = carrito.map(item => ({
      order_id: orden.id,
      product_id: item.id,
      quantity: item.cantidad,
      unit_price: item.price
    }));

    const { error: itemsError } = await db.from('order_items').insert(itemsParaGuardar);
    if (itemsError) throw itemsError;

    // C) Notificación instantánea vía WhatsApp para la cocina/productor
let mensajeWhatsApp = `*¡Nuevo Pedido en Tropicalia!* 🥑%0A`;
mensajeWhatsApp += `*Orden:* %23ORD-${orden.id}%0A`;
mensajeWhatsApp += `*Cliente:* ${nombre}%0A`;
mensajeWhatsApp += `*Teléfono:* ${telefono}%0A`;
mensajeWhatsApp += `*Dirección:* ${direccion}%0A`;

if (notas) {
  mensajeWhatsApp += `*Notas/Alergias:* ⚠️ ${notas}%0A`;
}

mensajeWhatsApp += `%0A*Detalle del pedido:*%0A`;
carrito.forEach(item => {
  mensajeWhatsApp += `• ${item.cantidad}x ${item.name} ($${(item.price * item.cantidad).toFixed(2)})%0A`;
});

mensajeWhatsApp += `%0A*Total a pagar:* $${totalPedido.toFixed(2)}`;

    alert(`¡Pedido #ORD-${orden.id} recibido con éxito! Te contactaremos a la brevedad.`);
    
    // Limpiar carrito
    carrito = [];
    actualizarCarrito();
    formPedido.reset();
    document.getElementById('cliente-notas').value = '';

    // Redirige o abre el chat de WhatsApp con el ticket pre-armado
    // (Reemplaza '58XXXXXXXXXX' por el número del productor/cocina)
    window.open(`https://wa.me/58XXXXXXXXXX?text=${mensaje}`, '_blank');

  } catch (error) {
    alert('Hubo un error al procesar el pedido: ' + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = 'Confirmar y Enviar Pedido';
  }
});

// Inicializar
obtenerMenu();
