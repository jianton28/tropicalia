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
    if (loading) loading.innerText = 'Error al cargar los productos: ' + err.message;
  }
}

// 2. Renderizar platos en pantalla
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

// 4. Enviar Pedido a Supabase y notificar exclusivamente por Telegram
if (formPedido) {
  formPedido.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    const direccion = document.getElementById('cliente-direccion').value.trim();
    const inputNotas = document.getElementById('cliente-notas');
    const notas = inputNotas ? inputNotas.value.trim() : '';

    const totalPedido = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);

    const btnSubmit = formPedido.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Procesando pedido...';

    try {
      // A) Registrar la orden en Supabase
      const { data: orden, error: ordenError } = await db
        .from('orders')
        .insert([{
          customer_name: nombre,
          customer_phone: telefono,
          customer_address: direccion,
          notes: notas,
          total: totalPedido,
          status: 'recibido',
          payment_status: 'pendiente'
        }])
        .select()
        .single();

      if (ordenError) throw ordenError;

      // B) Registrar el desglose de productos
      const itemsParaGuardar = carrito.map(item => ({
        order_id: orden.id,
        product_id: item.id,
        quantity: item.cantidad,
        unit_price: item.price
      }));

      const { error: itemsError } = await db.from('order_items').insert(itemsParaGuardar);
      if (itemsError) throw itemsError;

      // C) Disparar alertas por Telegram (comanda de cocina y control de existencias)
      const resumenPlatos = carrito.map(i => `• ${i.cantidad}x ${i.name}`).join('\n');
      const mensajeTelegram = `🚨 *¡NUEVO PEDIDO RECIBIDO!* 🚨\n\n` +
        `📦 *Orden:* #ORD-${orden.id}\n` +
        `👤 *Cliente:* ${nombre}\n` +
        `📞 *Teléfono:* ${telefono}\n` +
        `📍 *Dirección:* ${direccion}\n` +
        (notas ? `⚠️ *Notas/Alergias:* ${notas}\n` : '') +
        `\n🛒 *Platos:*\n${resumenPlatos}\n\n` +
        `💰 *Total:* $${totalPedido.toFixed(2)}`;

      await enviarAlertaTelegram(mensajeTelegram);
      await verificarAlertasStock(carrito);

      // D) Confirmación visual en pantalla y limpieza
      alert(`¡Gracias por tu compra! Tu comanda #ORD-${orden.id} ya entró a cocina. Nos comunicaremos al ${telefono} para coordinar la entrega.`);

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

// Iniciar carga del catálogo
obtenerMenu();

// Configuración de Notificaciones Telegram
const TELEGRAM_BOT_TOKEN = '8981870317:AAF9-cgDiAlmh5bMxmI40bT3CZObaIcy-wg';
const TELEGRAM_CHAT_ID = '589760626';

async function enviarAlertaTelegram(mensaje) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: mensaje,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error('Error al notificar por Telegram:', error);
  }
}
async function verificarAlertasStock(itemsComprados) {
  try {
    // Obtener los IDs de los productos pedidos
    const productIds = itemsComprados.map(item => item.id);

    // Consultar qué insumos y empaques usan estos platos
    const { data: recetas, error: errorRecetas } = await db
      .from('product_ingredients')
      .select('ingredient_id, ingredients(id, name, current_stock, min_stock, unit)')
      .in('product_id', productIds);

    if (errorRecetas || !recetas) return;

    // Filtrar insumos únicos que hayan caído al mínimo o menos
    const insumosCriticos = [];
    const idsProcesados = new Set();

    recetas.forEach(r => {
      const ing = r.ingredients;
      if (ing && !idsProcesados.has(ing.id)) {
        idsProcesados.add(ing.id);
        if (parseFloat(ing.current_stock) <= parseFloat(ing.min_stock)) {
          insumosCriticos.push(ing);
        }
      }
    });

    // Si hay insumos o empaques agotándose, enviar alerta por Telegram
    if (insumosCriticos.length > 0) {
      let listaAvisos = insumosCriticos.map(i => 
        `⚠️ *${i.name}*: Quedan *${i.current_stock} ${i.unit}* (Mínimo: ${i.min_stock})`
      ).join('\n');

      let avisoTelegram = `🚨 *¡ALERTA DE INVENTARIO / STOCK BAJO!* 🚨\n\n` +
        `Los siguientes insumos o empaques necesitan reposición urgente:\n\n` +
        listaAvisos + `\n\n` +
        `_Favor revisar el panel de reposición en cocina._`;

      await enviarAlertaTelegram(avisoTelegram);
    }
  } catch (error) {
    console.error('Error al evaluar alertas de stock:', error);
  }
}
