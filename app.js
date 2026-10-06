// Configuración de Supabase
const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let productos = [];
let carrito = [];

const gridProductos = document.getElementById('grid-productos');
const loading = document.getElementById('loading');
const cartCount = document.getElementById('cart-count');
const carritoItems = document.getElementById('carrito-items');
const carritoVacio = document.getElementById('carrito-vacio');
const carritoTotalPrecio = document.getElementById('carrito-total-precio');
const formPedido = document.getElementById('form-pedido');

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
    if (loading) loading.innerText = 'Error al cargar los productos: ' + err.message;
  }
}

function renderizarCatalogo() {
  if (loading) loading.style.display = 'none';

  if (!productos || productos.length === 0) {
    gridProductos.innerHTML = '<p class="alerta">No hay productos disponibles en este momento.</p>';
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

  if (cartCount) cartCount.innerText = totalItems;
  if (carritoTotalPrecio) carritoTotalPrecio.innerText = `$${totalPrecio.toFixed(2)}`;

  if (carrito.length === 0) {
    if (carritoVacio) carritoVacio.style.display = 'block';
    if (carritoItems) carritoItems.innerHTML = '';
    if (formPedido) formPedido.style.display = 'none';
    return;
  }

  if (carritoVacio) carritoVacio.style.display = 'none';
  if (formPedido) formPedido.style.display = 'flex';

  if (carritoItems) {
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
}

if (formPedido) {
  formPedido.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = formPedido.querySelector('button[type="submit"]');
    if (btnSubmit.disabled) return;

    const nombre = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    const direccion = document.getElementById('cliente-direccion').value.trim();
    const metodoPago = document.getElementById('cliente-metodo-pago').value;
    const inputNotas = document.getElementById('cliente-notas');
    const notas = inputNotas ? inputNotas.value.trim() : '';

    const totalPedido = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);

    // Bloqueo y estado de carga inmediato
    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Procesando pedido...';

    try {
      // 1. Guardar orden en Supabase (el trigger envía el mensaje a Telegram automáticamente)
      const { data: orden, error: ordenError } = await db
        .from('orders')
        .insert([{
          customer_name: nombre,
          customer_phone: telefono,
          customer_address: direccion,
          notes: notas,
          total: totalPedido,
          status: 'recibido',
          payment_status: 'pendiente',
          payment_method: metodoPago
        }])
        .select()
        .single();

      if (ordenError) throw ordenError;

      // 2. Guardar renglones de la comanda
      const itemsParaGuardar = carrito.map(item => ({
        order_id: orden.id,
        product_id: item.id,
        quantity: item.cantidad,
        unit_price: item.price
      }));

      const { error: itemsError } = await db.from('order_items').insert(itemsParaGuardar);
      if (itemsError) throw itemsError;

      alert(`¡Gracias por tu compra! Tu comanda #ORD-${orden.id} ya entró a cocina. Coordinaremos la entrega al ${telefono}.`);

      carrito = [];
      actualizarCarrito();
      formPedido.reset();

    } catch (error) {
      alert('Hubo un error al procesar el pedido: ' + error.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerText = 'Confirmar y Enviar Pedido';
    }
  });
}

obtenerMenu();
