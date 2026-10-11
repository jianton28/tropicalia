const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. Obtener order_id de los parámetros de la URL
const urlParams = new URLSearchParams(window.location.search);
const orderId = urlParams.get('order_id');

// Elementos DOM
const labelOrdenId = document.getElementById('label-orden-id');
const trackingTitulo = document.getElementById('tracking-titulo');
const trackingRestaurante = document.getElementById('tracking-restaurante-nombre');
const bannerEstadoDesc = document.getElementById('banner-estado-desc');
const bloqueCodigoEntrega = document.getElementById('bloque-codigo-entrega');
const codigoSeguridadCliente = document.getElementById('codigo-seguridad-cliente');
const mapaSubtitulo = document.getElementById('mapa-subtitulo');
const badgeTrackingTipo = document.getElementById('badge-tracking-tipo');

// Stepper DOM
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');
const step4 = document.getElementById('step-4');

// Variables Leaflet
let mapa = null;
let marcadorRestaurante = null;
let marcadorRepartidor = null;
let canalRealtimeOrden = null;

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
(async () => {
  if (!orderId) {
    alert('No se especificó ninguna orden para rastrear.');
    window.location.href = 'index.html';
    return;
  }

  labelOrdenId.innerText = `#ORD-${orderId.slice(0, 8)}`;
  inicializarMapaLeaflet();
  await cargarDatosOrden();
  suscribirCambiosEnVivo();
})();

function inicializarMapaLeaflet() {
  // Centro por defecto: Caracas
  const coordsCaracas = [10.4806, -66.9036];
  mapa = L.map('mapa-tracking').setView(coordsCaracas, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapa);
}

// =========================================================================
// CONSULTA Y RENDERIZADO DE ESTADOS
// =========================================================================
async function cargarDatosOrden() {
  const { data: orden, error } = await db
    .from('orders')
    .select('*, businesses(name, phone), driver_profiles(full_name, phone)')
    .eq('id', orderId)
    .single();

  if (error || !orden) {
    bannerEstadoDesc.innerText = 'No se encontró información de la comanda.';
    return;
  }

  trackingRestaurante.innerText = orden.businesses?.name || 'Local comercial';

  // Coordenadas fijas de la cocina (ej: El Rosal / Chacao)
  const coordsCocina = [10.4880, -66.8650];

  // Si no existe marcador de cocina, crearlo
  if (!marcadorRestaurante) {
    marcadorRestaurante = L.marker(coordsCocina).addTo(mapa)
      .bindPopup(`<strong>${orden.businesses?.name || 'Restaurante'}</strong><br>Punto de preparación`)
      .openPopup();
  }

  // Lógica secuencial según el estado de la comanda
  if (orden.status === 'pending_payment_verification') {
    actualizarStepper(1);
    trackingTitulo.innerText = 'Verificando Comprobante';
    bannerEstadoDesc.innerText = 'Tu pago móvil está en cola de conciliación. Tan pronto el operador confirme la referencia, la cocina comenzará a cocinar.';
    bloqueCodigoEntrega.style.display = 'none';

    mapaSubtitulo.innerText = '📍 Ubicación del Restaurante';
    badgeTrackingTipo.innerText = 'En validación bancaria';
    badgeTrackingTipo.style.color = '#6366f1';
    mapa.setView(coordsCocina, 15);

  } else if (orden.status === 'pending' || orden.status === 'cooking') {
    actualizarStepper(2);
    trackingTitulo.innerText = 'Comanda en Preparación';
    bannerEstadoDesc.innerText = '👨‍🍳 El local está elaborando tus platillos con precinto de seguridad garantizado.';
    bloqueCodigoEntrega.style.display = 'none';

    mapaSubtitulo.innerText = '📍 Cocina en Preparación';
    badgeTrackingTipo.innerText = 'Preparando comida';
    badgeTrackingTipo.style.color = '#f59e0b';
    mapa.setView(coordsCocina, 15);

  } else if (orden.status === 'on_the_way') {
    actualizarStepper(3);
    trackingTitulo.innerText = '¡Tu Pedido va en Camino!';
    bannerEstadoDesc.innerText = `🛵 El repartidor (${orden.driver_profiles?.full_name || 'Motorizado'}) recogió tu comida y se dirige a tu dirección.`;

    // Mostrar código de entrega seguro
    bloqueCodigoEntrega.style.display = 'block';
    codigoSeguridadCliente.innerText = orden.delivery_code || '----';

    mapaSubtitulo.innerText = '🛵 Seguimiento del Repartidor';
    badgeTrackingTipo.innerText = 'Despacho en ruta';
    badgeTrackingTipo.style.color = '#10b981';

    // Coordenadas dinámicas de inicio de ruta
    const coordsDriver = [10.4850, -66.8720];

    if (!marcadorRepartidor) {
      marcadorRepartidor = L.marker(coordsDriver, {
        icon: L.divIcon({
          className: 'icono-driver-cliente',
          html: '<div style="background:#10b981; border:2px solid #fff; border-radius:50%; width:18px; height:18px; box-shadow: 0 0 8px rgba(0,0,0,0.6);"></div>',
          iconSize: [18, 18]
        })
      }).addTo(mapa).bindPopup('Tu motorizado').openPopup();
    } else {
      marcadorRepartidor.setLatLng(coordsDriver);
    }

    mapa.setView(coordsDriver, 15);

  } else if (orden.status === 'delivered') {
    actualizarStepper(4);
    trackingTitulo.innerText = '¡Pedido Entregado!';
    bannerEstadoDesc.innerText = '🎉 Tu comida ha sido entregada. ¡Buen provecho!';
    bloqueCodigoEntrega.style.display = 'none';

    mapaSubtitulo.innerText = '📍 Entrega Concretada';
    badgeTrackingTipo.innerText = 'Finalizado';
    badgeTrackingTipo.style.color = '#3b82f6';
  }
}

function actualizarStepper(pasoActivo) {
  const pasos = [step1, step2, step3, step4];

  pasos.forEach((p, idx) => {
    const num = idx + 1;
    p.classList.remove('activo', 'completado');

    if (num < pasoActivo) {
      p.classList.add('completado');
    } else if (num === pasoActivo) {
      p.classList.add('activo');
    }
  });
}

// =========================================================================
// SUSCRIPCIÓN EN TIEMPO REAL
// =========================================================================
function suscribirCambiosEnVivo() {
  canalRealtimeOrden = db.channel(`cliente-tracking-${orderId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: `id=eq.${orderId}`
    }, () => {
      cargarDatosOrden();
    })
    .subscribe();
}