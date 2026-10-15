const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let tasaBCV = 875.65;
let negocios = [];
let negocioActivo = null;
let carrito = JSON.parse(localStorage.getItem('tropicalia_cart') || '[]');

const tasaBcvTexto = document.getElementById('tasa-bcv-texto');
const listaRestaurantes = document.getElementById('lista-restaurantes');
const seccionMenu = document.getElementById('seccion-menu');
const menuTituloLocal = document.getElementById('menu-titulo-local');
const gridProductos = document.getElementById('grid-productos');
const navCartCount = document.getElementById('nav-cart-count');
const barraFlotante = document.getElementById('barra-carrito-flotante');
const floatingCount = document.getElementById('floating-count');
const floatingTotal = document.getElementById('floating-total');
const floatingBs = document.getElementById('floating-bs');

(async () => {
  await actualizarBotonAcceso();
  await obtenerTasaBCV();
  await cargarRestaurantes();
  verificarOrdenReciente();
  actualizarUIResumenCarrito();
})();

async function actualizarBotonAcceso() {
  const btnAuth = document.getElementById('btn-nav-auth');
  if (!btnAuth) return;

  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    btnAuth.innerText = 'Iniciar Sesión';
    btnAuth.href = 'portal.html';
    return;
  }

  const user = session.user;
  let rol = user.user_metadata?.role;

  // Respaldo: si el usuario no tenía 'role' en metadata, inferirlo de las tablas o correo
  if (!rol) {
    if (user.email.includes('admin')) {
      rol = 'admin';
    } else {
      const { data: neg } = await db.from('businesses').select('id').eq('owner_id', user.id).maybeSingle();
      if (neg) rol = 'restaurant';
      else {
        const { data: drv } = await db.from('driver_profiles').select('id').eq('id', user.id).maybeSingle();
        if (drv) rol = 'delivery';
      }
    }
  }

  if (rol === 'restaurant') {
    btnAuth.innerText = '👨‍🍳 Panel Cocina';
    btnAuth.href = 'cocina.html';
  } else if (rol === 'delivery') {
    btnAuth.innerText = '🛵 Panel Delivery';
    btnAuth.href = 'delivery.html';
  } else if (rol === 'admin') {
    btnAuth.innerText = '🛡️ Panel Admin';
    btnAuth.href = 'admin.html';
  } else {
    const nombre = user.user_metadata?.full_name?.split(' ')[0] || 'Mi Cuenta';
    btnAuth.innerText = `👤 ${nombre}`;
    btnAuth.href = 'portal.html';
  }
}

async function obtenerTasaBCV() {
  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    const data = await res.json();
    if (data && data.promedio) {
      tasaBCV = parseFloat(data.promedio);
      localStorage.setItem('tropicalia_bcv', tasaBCV.toString());
    }
  } catch (e) {
    const guardada = localStorage.getItem('tropicalia_bcv');
    if (guardada) tasaBCV = parseFloat(guardada);
  }
  tasaBcvTexto.innerText = `💵 BCV: Bs. ${tasaBCV.toFixed(2)}`;
}

async function cargarRestaurantes() {
  const { data, error } = await db
    .from('businesses')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error || !data || data.length === 0) {
    listaRestaurantes.innerHTML = '<p style="color:#888;">No hay restaurantes abiertos en este momento.</p>';
    return;
  }

  negocios = data;
  const guardadoId = localStorage.getItem('tropicalia_business_id');
  const preseleccionado = negocios.find(n => n.id === guardadoId) || negocios[0];

  renderizarRestaurantes();
  seleccionarRestaurante(preseleccionado.id);
}

function renderizarRestaurantes() {
  listaRestaurantes.innerHTML = negocios.map(n => {
    const esActivo = negocioActivo && negocioActivo.id === n.id;
    return `
      <div class="card" style="cursor: pointer; border-color: ${esActivo ? 'var(--gold)' : 'var(--border-color)'};" onclick="seleccionarRestaurante('${n.id}')">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 1.05rem; color: ${esActivo ? 'var(--gold)' : '#fff'};">${n.name}</strong>
          <span class="badge badge-on_the_way">Abierto</span>
        </div>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin: 6px 0 0 0;">${n.category || 'Gastronomía'} • Delivery y Pickup</p>
      </div>
    `;
  }).join('');
}

window.seleccionarRestaurante = async function(businessId) {
  const nuevo = negocios.find(n => n.id === businessId);
  if (!nuevo) return;

  // Si cambia de restaurante y hay ítems de otro local, confirmar limpieza
  const localAnterior = localStorage.getItem('tropicalia_business_id');
  if (carrito.length > 0 && localAnterior && localAnterior !== businessId) {
    if (!confirm('Tu carrito tiene platos de otro restaurante. ¿Deseas vaciarlo para pedir en ' + nuevo.name + '?')) {
      return;
    }
    carrito = [];
    guardarCarrito();
  }

  negocioActivo = nuevo;
  localStorage.setItem('tropicalia_business_id', nuevo.id);
  localStorage.setItem('tropicalia_business_name', nuevo.name);

  renderizarRestaurantes();
  seccionMenu.style.display = 'block';
  menuTituloLocal.innerText = `Menú de ${nuevo.name}`;
  await cargarProductosMenu(nuevo.id);
};

async function cargarProductosMenu(businessId) {
  gridProductos.innerHTML = '<p style="color:#888;">Cargando platos...</p>';

  const { data: productos, error } = await db
    .from('products')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_available', true)
    .order('name', { ascending: true });

  if (error || !productos || productos.length === 0) {
    gridProductos.innerHTML = '<p style="color:#888;">Este local aún no tiene platos disponibles hoy.</p>';
    return;
  }

  gridProductos.innerHTML = productos.map(p => {
    const precioUsd = parseFloat(p.price || 0);
    const precioBs = (precioUsd * tasaBCV).toFixed(2);
    const stock = p.stock !== null && p.stock !== undefined ? parseInt(p.stock) : 99;

    return `
      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <strong style="font-size: 1rem;">${p.name}</strong>
            <span style="color: var(--gold); font-weight: 800;">$${precioUsd.toFixed(2)}</span>
          </div>
          <small style="color: var(--text-muted); display: block; margin-top: 2px;">Bs. ${precioBs}</small>
          <p style="font-size: 0.82rem; color: #aaa; margin: 8px 0;">${p.description || 'Preparado al momento con sello de seguridad.'}</p>
        </div>
        <button class="btn-primario" style="width: 100%; margin-top: 10px;" 
          onclick="agregarAlCarrito('${p.id}', '${p.name.replace(/'/g, "\\'")}', ${precioUsd})"
          ${stock <= 0 ? 'disabled' : ''}>
          ${stock <= 0 ? 'Agotado' : '+ Agregar al pedido'}
        </button>
      </div>
    `;
  }).join('');
}

window.agregarAlCarrito = function(id, name, price) {
  const existente = carrito.find(item => item.id === id);
  if (existente) {
    existente.quantity += 1;
  } else {
    carrito.push({ id, name, price, quantity: 1 });
  }
  guardarCarrito();
};

function guardarCarrito() {
  localStorage.setItem('tropicalia_cart', JSON.stringify(carrito));
  actualizarUIResumenCarrito();
}

function actualizarUIResumenCarrito() {
  const totalItems = carrito.reduce((acc, el) => acc + el.quantity, 0);
  const subtotalUsd = carrito.reduce((acc, el) => acc + (el.price * el.quantity), 0);

  navCartCount.innerText = totalItems;

  if (totalItems > 0) {
    barraFlotante.style.display = 'flex';
    floatingCount.innerText = `${totalItems} ${totalItems === 1 ? 'plato' : 'platos'}`;
    floatingTotal.innerText = `$${subtotalUsd.toFixed(2)}`;
    floatingBs.innerText = `Equivalente: Bs. ${(subtotalUsd * tasaBCV).toFixed(2)}`;
  } else {
    barraFlotante.style.display = 'none';
  }
}

function verificarOrdenReciente() {
  const ultimaOrdenId = localStorage.getItem('tropicalia_last_order_id');
  if (ultimaOrdenId) {
    const banner = document.getElementById('banner-orden-activa');
    const link = document.getElementById('link-orden-activa');
    banner.style.display = 'block';
    link.href = `tracking.html?order_id=${ultimaOrdenId}`;
  }
}