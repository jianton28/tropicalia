// Configuración de Supabase
const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Variables de estado
let negocios = [];
let productos = [];
let carrito = [];
let negocioActivo = null;
let ubicacionMapsUrl = null;
let tasaActualBCV = 0;

// Elementos del DOM
const vistaRestaurantes = document.getElementById('vista-restaurantes');
const vistaMenu = document.getElementById('vista-menu');
const panelCarrito = document.getElementById('panel-carrito');
const gridRestaurantes = document.getElementById('grid-restaurantes');
const loadingRestaurantes = document.getElementById('loading-restaurantes');
const tituloRestaurante = document.getElementById('titulo-restaurante');
const gridProductos = document.getElementById('grid-productos');
const loadingMenu = document.getElementById('loading-menu');
const cartCount = document.getElementById('cart-count');
const carritoItems = document.getElementById('carrito-items');
const carritoVacio = document.getElementById('carrito-vacio');
const carritoTotalPrecio = document.getElementById('carrito-total-precio');
const formPedido = document.getElementById('form-pedido');

// Diccionario de equivalencias para filtros por chips
const MAPA_CATEGORIAS = {
  hamburguesas: ['hamburguesa', 'burger'],
  pizza: ['pizza', 'pizzer'],
  postres: ['postre', 'dulce', 'cheesecake', 'chocofresa', 'gastronomia', 'gastronomía'],
  sushi: ['sushi', 'roll'],
  pollo: ['pollo', 'chicken', 'crispy'],
  italiana: ['italiana', 'pasta', 'pastiche', 'pasticho', 'pizza', 'pizzer']
};

// Geolocalización
window.obtenerUbicacionGPS = function() {
  const textoBtn = document.getElementById('texto-ubicacion');
  
  if (!navigator.geolocation) {
    alert('Tu dispositivo no soporta geolocalización.');
    return;
  }

  textoBtn.innerText = 'Obteniendo GPS...';

  navigator.geolocation.getCurrentPosition(
    (posicion) => {
      const lat = posicion.coords.latitude;
      const lng = posicion.coords.longitude;
      ubicacionMapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
      textoBtn.innerText = '📍 Ubicación fijada ✓';
    },
    (error) => {
      console.warn('Error al obtener ubicación:', error.message);
      textoBtn.innerText = 'Entregar en...';
      alert('No se pudo obtener la ubicación exacta. Escribe tu dirección en el formulario.');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
};

// =========================================================================
// MOTOR DE TASA BCV
// =========================================================================
async function inicializarTasa() {
  const CACHE_KEY = 'tropicalia_tasa_bcv';
  const TIEMPO_CACHE = 6 * 60 * 60 * 1000;
  const textoTasa = document.getElementById('texto-tasa');

  const cache = localStorage.getItem(CACHE_KEY);
  if (cache) {
    const { tasa, timestamp } = JSON.parse(cache);
    if (Date.now() - timestamp < TIEMPO_CACHE) {
      tasaActualBCV = tasa;
      if (textoTasa) textoTasa.textContent = `BCV: Bs. ${tasa.toFixed(2)}`;
      actualizarCarrito();
      return;
    }
  }

  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    if (!res.ok) throw new Error('Error API');
    const data = await res.json();
    tasaActualBCV = data.promedio;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ tasa: tasaActualBCV, timestamp: Date.now() }));
    if (textoTasa) textoTasa.textContent = `BCV: Bs. ${tasaActualBCV.toFixed(2)}`;
    actualizarCarrito();
  } catch {
    if (textoTasa) textoTasa.textContent = `BCV: No disponible`;
  }
}

// =========================================================================
// 1. OBTENER Y RENDERIZAR RESTAURANTES (CON SOPORTE ABIERTO / CERRADO)
// =========================================================================
async function obtenerRestaurantes() {
  try {
    const { data, error } = await db
      .from('businesses')
      .select('*')
      .order('is_active', { ascending: false }) // Prioriza abiertos arriba
      .order('name');

    if (error) throw error;

    negocios = data || [];
    ejecutarFiltroRestaurantes();
  } catch (err) {
    if (loadingRestaurantes) loadingRestaurantes.innerText = 'Error al cargar locales: ' + err.message;
  }
}

function generarCardHTML(b) {
  const abierto = b.is_active;

  return `
    <div class="card" style="${!abierto ? 'opacity: 0.6; filter: grayscale(40%);' : ''}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div>
          <h3 style="margin: 0 0 4px 0;">${b.name}</h3>
          <p style="margin: 0; font-size: 0.85rem; color: #a3a3a3;">Contacto: ${b.phone || 'Disponible'}</p>
        </div>
        <span class="badge ${abierto ? 'badge-on_the_way' : 'badge-critico'}" style="font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; ${!abierto ? 'background: #dc2626; color: #fff;' : 'background: #10b981; color: #000;'}">
          ${abierto ? 'Abierto' : 'Cerrado'}
        </span>
      </div>
      <div class="card-footer" style="margin-top: 14px;">
        ${abierto ? `
          <button class="btn-primario" onclick="seleccionarRestaurante('${b.id}')">
            Ver Menú →
          </button>
        ` : `
          <button class="btn-secundario" disabled style="width: 100%; cursor: not-allowed; opacity: 0.7;">
            No recibe pedidos
          </button>
        `}
      </div>
    </div>
  `;
}

function ejecutarFiltroRestaurantes() {
  if (loadingRestaurantes) loadingRestaurantes.style.display = 'none';

  if (!negocios || negocios.length === 0) {
    gridRestaurantes.innerHTML = '<p class="alerta">No hay restaurantes registrados en este momento.</p>';
    return;
  }

  const inputBusqueda = document.getElementById('input-busqueda');
  const chipActivo = document.querySelector('.chip-categoria.active')?.dataset.categoria || 'todos';

  const normalizar = (txt) => (txt || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const query = normalizar(inputBusqueda ? inputBusqueda.value : '');
  const categoria = normalizar(chipActivo);

  const filtrados = negocios.filter(b => {
    const nombre = normalizar(b.name);
    const desc = normalizar(b.description || '');
    const catLocal = normalizar(b.category || '');
    const textoCompleto = `${nombre} ${desc} ${catLocal}`;

    const coincideTexto = !query || textoCompleto.includes(query);

    let coincideCat = (categoria === 'todos');
    if (!coincideCat) {
      const palabrasClave = MAPA_CATEGORIAS[categoria] || [categoria];
      coincideCat = palabrasClave.some(p => textoCompleto.includes(normalizar(p)));
    }

    return coincideTexto && coincideCat;
  });

  if (filtrados.length === 0) {
    gridRestaurantes.innerHTML = '<p class="alerta">No se encontraron restaurantes que coincidan con la búsqueda.</p>';
  } else {
    gridRestaurantes.innerHTML = filtrados.map(generarCardHTML).join('');
  }
}

function configurarEventosFiltro() {
  const inputBusqueda = document.getElementById('input-busqueda');
  const chips = document.querySelectorAll('.chip-categoria');

  if (inputBusqueda) {
    inputBusqueda.addEventListener('input', ejecutarFiltroRestaurantes);
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ejecutarFiltroRestaurantes();
    });
  });
}

function suscribirNegociosRealtime() {
  db.channel('public:businesses')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'businesses' }, () => {
      obtenerRestaurantes();
    })
    .subscribe();
}

// =========================================================================
// 2. SELECCIONAR RESTAURANTE Y CARGAR SU MENÚ
// =========================================================================
window.seleccionarRestaurante = async function(businessId) {
  negocioActivo = negocios.find(b => b.id === businessId);
  if (!negocioActivo || !negocioActivo.is_active) return;

  vistaRestaurantes.style.display = 'none';
  vistaMenu.style.display = 'block';
  panelCarrito.style.display = 'block';
  tituloRestaurante.innerText = negocioActivo.name;
  if (loadingMenu) loadingMenu.style.display = 'block';
  gridProductos.innerHTML = '';

  try {
    const { data, error } = await db
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_available', true);

    if (error) throw error;

    productos = data || [];
    renderizarMenu();
  } catch (err) {
    if (loadingMenu) loadingMenu.innerText = 'Error al cargar productos: ' + err.message;
  }
};

function renderizarMenu() {
  if (loadingMenu) loadingMenu.style.display = 'none';

  if (!productos || productos.length === 0) {
    gridProductos.innerHTML = '<p class="alerta">Este restaurante aún no tiene platos disponibles.</p>';
    return;
  }

  gridProductos.innerHTML = productos.map(item => {
    const precioUsd = parseFloat(item.price);
    const precioBs = tasaActualBCV > 0 ? (precioUsd * tasaActualBCV).toFixed(2) : null;

    return `
      <div class="card">
        <div>
          <h3>${item.name}</h3>
          <p>${item.description || ''}</p>
        </div>
        <div class="card-footer">
          <div>
            <span class="precio">$${precioUsd.toFixed(2)}</span>
            ${precioBs ? `<br><small style="color: #888;">Bs. ${precioBs}</small>` : ''}
          </div>
          <button class="btn-primario" style="width: auto;" onclick="agregarAlCarrito('${item.id}')">
            + Agregar
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.volverARestaurantes = function() {
  if (carrito.length > 0) {
    const confirmar = confirm('Si cambias de restaurante, se vaciará el carrito actual. ¿Deseas continuar?');
    if (!confirmar) return;
    carrito = [];
    actualizarCarrito();
  }

  negocioActivo = null;
  vistaMenu.style.display = 'none';
  panelCarrito.style.display = 'none';
  vistaRestaurantes.style.display = 'block';
};

// =========================================================================
// 3. CARRITO DE COMPRAS
// =========================================================================
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
  const totalBs = tasaActualBCV > 0 ? (totalPrecio * tasaActualBCV).toFixed(2) : '0.00';

  if (cartCount) cartCount.innerText = totalItems;
  if (carritoTotalPrecio) carritoTotalPrecio.innerText = `$${totalPrecio.toFixed(2)}`;

  const totalBsElement = document.getElementById('carrito-total-bs');
  if (totalBsElement) totalBsElement.innerText = `Bs. ${totalBs}`;

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
        <button class="btn-secundario" style="padding: 2px 6px;" onclick="eliminarDelCarrito('${item.id}')">✕</button>
      </div>
    `).join('');
  }
}

// =========================================================================
// 4. ENVÍO DE PEDIDO MULTINEGOCIO
// =========================================================================
if (formPedido) {
  formPedido.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = formPedido.querySelector('button[type="submit"]');
    if (btnSubmit.disabled) return;

    if (!negocioActivo) {
      alert('Error: No hay ningún restaurante seleccionado.');
      return;
    }

    const nombre = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    const direccion = document.getElementById('cliente-direccion').value.trim();
    const metodoPago = document.getElementById('cliente-metodo-pago').value;
    const inputNotas = document.getElementById('cliente-notas');
    const notas = inputNotas ? inputNotas.value.trim() : '';

    const totalPedido = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);

    const itemsPedido = carrito.map(item => ({
      product_id: item.id,
      name: item.name,
      quantity: item.cantidad,
      price: item.price,
      subtotal: item.price * item.cantidad
    }));

    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Procesando pedido...';

    try {
      const { data: orden, error: ordenError } = await db
        .from('orders')
        .insert([{
          business_id: negocioActivo.id,
          customer_name: nombre,
          customer_phone: telefono,
          delivery_address: direccion,
          map_url: ubicacionMapsUrl,
          items: itemsPedido,
          total: totalPedido,
          status: 'pending'
        }])
        .select()
        .single();

      if (ordenError) throw ordenError;

      alert(`¡Gracias por tu compra! Tu pedido para ${negocioActivo.name} fue registrado con éxito.`);

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
window.toggleEstadoNegocio = async function() {
  const btn = document.getElementById('btn-toggle-negocio');
  if (btn) btn.disabled = true;

  const nuevoEstado = !estadoNegocioActivo;

  try {
    const { data, error } = await db
      .from('businesses')
      .update({ is_active: nuevoEstado })
      .eq('id', negocioId)
      .select();

    if (error) throw error;

    // Solo actualiza visualmente si la base de datos realmente guardó el cambio
    estadoNegocioActivo = nuevoEstado;
    actualizarBotonEstadoNegocio();
    console.log('Estado actualizado en BD a:', nuevoEstado);
  } catch (err) {
    alert('No se pudo actualizar el estado del local: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};
// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  inicializarTasa();
  configurarEventosFiltro();
  obtenerRestaurantes();
  suscribirNegociosRealtime();
});