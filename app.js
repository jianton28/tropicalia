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

// Constantes de tarifas
const TARIFA_SERVICIO_BASE = 0.30;
const TARIFA_DELIVERY_BASE = 1.50;

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
const carritoTotalBs = document.getElementById('carrito-total-bs');
const formPedido = document.getElementById('form-pedido');

// Desglose del DOM
const desgloseSubtotal = document.getElementById('desglose-subtotal');
const desgloseServicio = document.getElementById('desglose-servicio');
const desgloseDelivery = document.getElementById('desglose-delivery');
const desglosePropina = document.getElementById('desglose-propina');
const filaCostoDelivery = document.getElementById('fila-costo-delivery');
const filaPropina = document.getElementById('fila-propina');

// Controles de entrega y pago
const selectTipoEntrega = document.getElementById('tipo-entrega');
const selectMetodoPago = document.getElementById('cliente-metodo-pago');
const selectPropina = document.getElementById('propina-delivery');
const bloquePagoDigital = document.getElementById('bloque-datos-pago-digital');
const alertaLicores = document.getElementById('alerta-licores');
const checkMayorEdad = document.getElementById('check-mayor-edad');
const checkTerminosCliente = document.getElementById('check-terminos-cliente');
const optEfectivoUsd = document.getElementById('opt-efectivo-usd');
const optEfectivoBs = document.getElementById('opt-efectivo-bs');

// Diccionario de equivalencias para filtros por chips
const MAPA_CATEGORIAS = {
  hamburguesas: ['hamburguesa', 'burger'],
  pizza: ['pizza', 'pizzer'],
  postres: ['postre', 'dulce', 'cheesecake', 'chocofresa', 'gastronomia', 'gastronomía'],
  sushi: ['sushi', 'roll'],
  pollo: ['pollo', 'chicken', 'crispy'],
  italiana: ['italiana', 'pasta', 'pastiche', 'pasticho', 'pizza', 'pizzer'],
  licores: ['cerveza', 'ron', 'vino', 'licor', 'coctel', 'vodka', 'whisky']
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
// 1. OBTENER Y RENDERIZAR RESTAURANTES
// =========================================================================
async function obtenerRestaurantes() {
  try {
    const { data, error } = await db
      .from('businesses')
      .select('*')
      .order('is_active', { ascending: false })
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

  // Actualizar datos bancarios en el bloque de pago
  const instrucciones = document.getElementById('instrucciones-bancarias');
  if (instrucciones) {
    instrucciones.innerHTML = `
      <strong>Pago Móvil a Central Tropicalia:</strong><br>
      Banco: Banesco (0134) | CI: V-24.123.456<br>
      Tlf: 0412-1234567<br>
      <small style="color: #9ca3af;">Orden asignada a: ${negocioActivo.name}</small>
    `;
  }

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
    const imagenHtml = item.image_url 
      ? `<img src="${item.image_url}" alt="${item.name}" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" />` 
      : '';

    return `
      <div class="card">
        ${imagenHtml}
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
// 3. CARRITO DE COMPRAS Y DESGLOSE DINÁMICO
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

function contieneLicores() {
  return carrito.some(item => {
    const cat = (item.category || '').toLowerCase();
    const nombre = (item.name || '').toLowerCase();
    return MAPA_CATEGORIAS.licores.some(p => cat.includes(p) || nombre.includes(p));
  });
}

function sincronizarMetodosEntregaYPago() {
  const esPickup = selectTipoEntrega ? selectTipoEntrega.value === 'pickup' : false;

  // En pick-up se apagan las opciones de efectivo
  if (optEfectivoUsd && optEfectivoBs) {
    if (esPickup) {
      optEfectivoUsd.disabled = true;
      optEfectivoBs.disabled = true;
      if (selectMetodoPago.value.startsWith('efectivo')) {
        selectMetodoPago.value = 'pago_movil';
      }
    } else {
      optEfectivoUsd.disabled = false;
      optEfectivoBs.disabled = false;
    }
  }

  // Alternar vista del bloque de datos bancarios
  if (bloquePagoDigital) {
    const esDigital = ['pago_movil', 'zelle', 'binance'].includes(selectMetodoPago.value);
    bloquePagoDigital.style.display = esDigital ? 'block' : 'none';
  }

  // Visibilidad de controles de delivery y propina
  if (filaCostoDelivery) filaCostoDelivery.style.display = esPickup ? 'none' : 'flex';
  if (filaPropina) filaPropina.style.display = esPickup ? 'none' : 'flex';

  const campoDireccion = document.getElementById('cliente-direccion');
  if (campoDireccion) {
    if (esPickup) {
      campoDireccion.value = 'Retiro en mostrador del local';
      campoDireccion.disabled = true;
    } else {
      if (campoDireccion.value === 'Retiro en mostrador del local') campoDireccion.value = '';
      campoDireccion.disabled = false;
    }
  }
}

function actualizarCarrito() {
  const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
  const subtotalComida = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);
  const esPickup = selectTipoEntrega ? selectTipoEntrega.value === 'pickup' : false;
  
  const costoServicio = subtotalComida > 0 ? TARIFA_SERVICIO_BASE : 0;
  const costoDelivery = (!esPickup && subtotalComida > 0) ? TARIFA_DELIVERY_BASE : 0;
  const propina = (!esPickup && selectPropina) ? parseFloat(selectPropina.value || 0) : 0;

  const totalFinal = subtotalComida + costoServicio + costoDelivery + propina;
  const totalBs = tasaActualBCV > 0 ? (totalFinal * tasaActualBCV).toFixed(2) : '0.00';

  if (cartCount) cartCount.innerText = totalItems;
  if (desgloseSubtotal) desgloseSubtotal.innerText = `$${subtotalComida.toFixed(2)}`;
  if (desgloseServicio) desgloseServicio.innerText = `$${costoServicio.toFixed(2)}`;
  if (desgloseDelivery) desgloseDelivery.innerText = `$${costoDelivery.toFixed(2)}`;
  if (desglosePropina) desglosePropina.innerText = `$${propina.toFixed(2)}`;
  if (carritoTotalPrecio) carritoTotalPrecio.innerText = `$${totalFinal.toFixed(2)}`;
  if (carritoTotalBs) carritoTotalBs.innerText = `Bs. ${totalBs}`;

  // Validación de bebidas alcohólicas
  if (alertaLicores) {
    alertaLicores.style.display = contieneLicores() ? 'block' : 'none';
  }

  sincronizarMetodosEntregaYPago();

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
// 4. SUBIDA DE COMPROBANTE Y ENVÍO DE PEDIDO
// =========================================================================
async function subirComprobante(file) {
  if (!file) return null;
  const fileExt = file.name.split('.').pop();
  const fileName = `recibo_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
  const filePath = `comprobantes/${fileName}`;

  const { error: uploadError } = await db.storage
    .from('receipts')
    .upload(filePath, file);

  if (uploadError) throw new Error('Error al subir comprobante: ' + uploadError.message);

  const { data } = db.storage.from('receipts').getPublicUrl(filePath);
  return data.publicUrl;
}

if (formPedido) {
  // Escuchadores de eventos para cambios en entrega y pago
  if (selectTipoEntrega) selectTipoEntrega.addEventListener('change', actualizarCarrito);
  if (selectPropina) selectPropina.addEventListener('change', actualizarCarrito);
  if (selectMetodoPago) selectMetodoPago.addEventListener('change', sincronizarMetodosEntregaYPago);

  formPedido.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = formPedido.querySelector('button[type="submit"]');
    if (btnSubmit.disabled) return;

    if (!negocioActivo) {
      alert('Error: No hay ningún restaurante seleccionado.');
      return;
    }

    if (!checkTerminosCliente.checked) {
      alert('Debes aceptar los Términos del Servicio para continuar.');
      return;
    }

    if (contieneLicores() && (!checkMayorEdad || !checkMayorEdad.checked)) {
      alert('Debes confirmar que eres mayor de 18 años para comprar bebidas alcohólicas.');
      return;
    }

    const tipoEntrega = selectTipoEntrega.value;
    const metodoPago = selectMetodoPago.value;
    const nombre = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    const direccion = document.getElementById('cliente-direccion').value.trim();
    const inputNotas = document.getElementById('cliente-notas');
    const notas = inputNotas ? inputNotas.value.trim() : '';

    const subtotalComida = carrito.reduce((sum, item) => sum + (item.price * item.cantidad), 0);
    const esPickup = tipoEntrega === 'pickup';
    const tarifaServicio = TARIFA_SERVICIO_BASE;
    const tarifaDelivery = esPickup ? 0 : TARIFA_DELIVERY_BASE;
    const propina = esPickup ? 0 : parseFloat(selectPropina ? selectPropina.value || 0 : 0);
    const totalFinal = subtotalComida + tarifaServicio + tarifaDelivery + propina;

    // Validación de comprobante en pagos digitales
    const fileInput = document.getElementById('pago-comprobante');
    const referenciaInput = document.getElementById('pago-referencia');
    const esPagoDigital = ['pago_movil', 'zelle', 'binance'].includes(metodoPago);

    if (esPagoDigital && (!referenciaInput.value.trim())) {
      alert('Por favor, indica los dígitos de referencia de tu transferencia o pago móvil.');
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Procesando comanda...';

    try {
      let comprobanteUrl = null;
      if (esPagoDigital && fileInput && fileInput.files.length > 0) {
        btnSubmit.innerText = 'Subiendo comprobante...';
        comprobanteUrl = await subirComprobante(fileInput.files[0]);
      }

      const itemsPedido = carrito.map(item => ({
        product_id: item.id,
        name: item.name,
        quantity: item.cantidad,
        price: item.price,
        subtotal: item.price * item.cantidad
      }));

      const payloadOrden = {
        business_id: negocioActivo.id,
        customer_name: nombre,
        customer_phone: telefono,
        delivery_address: direccion,
        delivery_type: tipoEntrega,
        payment_method: metodoPago,
        payment_reference: referenciaInput ? referenciaInput.value.trim() : null,
        receipt_url: comprobanteUrl,
        map_url: esPickup ? null : ubicacionMapsUrl,
        items: itemsPedido,
        subtotal_food: subtotalComida,
        service_fee: tarifaServicio,
        delivery_fee: tarifaDelivery,
        driver_tip: propina,
        total: totalFinal,
        exchange_rate_bcv: tasaActualBCV,
        notes: notas,
        status: esPagoDigital ? 'pending_payment_verification' : 'pending'
      };

      const { data: orden, error: ordenError } = await db
        .from('orders')
        .insert([payloadOrden])
        .select()
        .single();

      if (ordenError) throw ordenError;

      alert(`¡Pedido #${orden.id.slice(0, 6)} registrado con éxito! Tu orden para ${negocioActivo.name} está en proceso.`);

      carrito = [];
      actualizarCarrito();
      formPedido.reset();
      sincronizarMetodosEntregaYPago();

    } catch (error) {
      alert('Hubo un error al procesar el pedido: ' + error.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerText = 'Confirmar y Procesar Pedido';
    }
  });
}

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  inicializarTasa();
  configurarEventosFiltro();
  obtenerRestaurantes();
  suscribirNegociosRealtime();
});