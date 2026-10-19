const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const urlParams = new URLSearchParams(window.location.search);
const orderId = urlParams.get('order_id') || localStorage.getItem('tropicalia_last_order_id');

const labelOrdenId = document.getElementById('label-orden-id');
const trackingTitulo = document.getElementById('tracking-titulo');
const trackingRestaurante = document.getElementById('tracking-restaurante-nombre');
const bannerEstadoDesc = document.getElementById('banner-estado-desc');
const bloqueCodigoEntrega = document.getElementById('bloque-codigo-entrega');
const codigoSeguridadCliente = document.getElementById('codigo-seguridad-cliente');
const mapaSubtitulo = document.getElementById('mapa-subtitulo');
const badgeTrackingTipo = document.getElementById('badge-tracking-tipo');

const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');
const step4 = document.getElementById('step-4');

let mapa = null;
let marcadorRestaurante = null;
let marcadorRepartidor = null;

(async () => {
  if (!orderId) {
    window.location.href = 'index.html';
    return;
  }

  labelOrdenId.innerText = `#ORD-${orderId.slice(0, 8)}`;
  inicializarMapaLeaflet();
  await cargarDatosOrden();
  suscribirCambiosEnVivo();
})();

function inicializarMapaLeaflet() {
  const coordsCaracas = [10.4880, -66.8650];
  mapa = L.map('mapa-tracking').setView(coordsCaracas, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapa);
}

async function cargarDatosOrden() {
  // 1. Consulta desacoplada para evitar fallos cuando driver_id es null
  const { data: orden, error } = await db
    .from('orders')
    .select('*, businesses(name, phone)')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !orden) {
    bannerEstadoDesc.innerText = 'No se encontró información de la comanda. Verifica las políticas RLS en Supabase.';
    return;
  }

  // 2. Si hay repartidor asignado, obtener su nombre por separado
  let nombreDriver = 'Repartidor asignado';
  if (orden.driver_id) {
    const { data: driver } = await db
      .from('driver_profiles')
      .select('full_name')
      .eq('id', orden.driver_id)
      .maybeSingle();
    if (driver?.full_name) nombreDriver = driver.full_name;
  }

  const nombreLocal = orden.businesses?.name || 'Restaurante Aliado';
  trackingRestaurante.innerText = nombreLocal;

  const coordsCocina = [10.4880, -66.8650];
  if (!marcadorRestaurante) {
    marcadorRestaurante = L.marker(coordsCocina).addTo(mapa)
      .bindPopup(`<strong>👨‍🍳 ${nombreLocal}</strong><br>Preparando tu orden`).openPopup();
  }

  // FASE 1 y 2: MIENTRAS ESTÁ EN VERIFICACIÓN O EN COCINA -> MAPA FIJO EN LA COCINA
  if (orden.status === 'pending_payment_verification') {
    actualizarStepper(1);
    trackingTitulo.innerText = 'Verificando Pago Móvil';
    bannerEstadoDesc.innerText = '⏳ Tu comprobante está siendo validado por un operador. En breve la cocina iniciará la preparación.';
    bloqueCodigoEntrega.style.display = 'none';
    mapaSubtitulo.innerText = '📍 Ubicación de la Cocina';
    badgeTrackingTipo.innerText = 'Validando pago';
    mapa.setView(coordsCocina, 15);

  } else if (orden.status === 'pending' || orden.status === 'cooking') {
    actualizarStepper(2);
    trackingTitulo.innerText = 'Tu comida está en Cocina';
    bannerEstadoDesc.innerText = `👨‍🍳 ${nombreLocal} está preparando tus platos. El mapa rastreará al motorizado apenas retire el paquete sellado.`;
    bloqueCodigoEntrega.style.display = 'none';
    mapaSubtitulo.innerText = '📍 Ubicación de la Cocina';
    badgeTrackingTipo.innerText = 'En preparación';
    mapa.setView(coordsCocina, 15);

  // FASE 3: COCINA ENTREGA LA COMIDA AL REPARTIDOR -> SE ACTIVA EL TRACKING DEL CONDUCTOR
  } else if (orden.status === 'on_the_way') {
    actualizarStepper(3);
    trackingTitulo.innerText = '¡El repartidor tiene tu pedido!';
    bannerEstadoDesc.innerText = `🛵 ${nombreDriver} ya retiró tu comida de la cocina y va en camino hacia tu ubicación.`;

    bloqueCodigoEntrega.style.display = 'block';
    codigoSeguridadCliente.innerText = orden.delivery_code || '4821';

    mapaSubtitulo.innerText = '🛵 Rastreo en Vivo del Conductor';
    badgeTrackingTipo.innerText = 'Conductor en ruta';
    badgeTrackingTipo.style.color = '#10b981';

    const coordsDriver = [10.4845, -66.8710];
    if (!marcadorRepartidor) {
      marcadorRepartidor = L.marker(coordsDriver, {
        icon: L.divIcon({
          className: 'driver-live-pin',
          html: '<div style="background:#10b981; border:3px solid #fff; border-radius:50%; width:20px; height:20px; box-shadow:0 0 10px rgba(16,185,129,0.9);"></div>',
          iconSize: [20, 20]
        })
      }).addTo(mapa).bindPopup(`<strong>🛵 ${nombreDriver}</strong><br>Llevando tu pedido`).openPopup();
    } else {
      marcadorRepartidor.setLatLng(coordsDriver);
    }
    mapa.setView(coordsDriver, 15);

  // FASE 4: ENTREGADO
  } else if (orden.status === 'delivered') {
    actualizarStepper(4);
    trackingTitulo.innerText = '¡Pedido Entregado!';
    bannerEstadoDesc.innerText = '🎉 Entrega confirmada con éxito. ¡Que disfrutes tu comida!';
    bloqueCodigoEntrega.style.display = 'none';
    mapaSubtitulo.innerText = '✅ Orden Completada';
    badgeTrackingTipo.innerText = 'Finalizado';
    localStorage.removeItem('tropicalia_last_order_id');
  }
}

function actualizarStepper(pasoActivo) {
  [step1, step2, step3, step4].forEach((p, idx) => {
    const num = idx + 1;
    p.classList.remove('activo', 'completado');
    if (num < pasoActivo) p.classList.add('completado');
    else if (num === pasoActivo) p.classList.add('activo');
  });
}

function suscribirCambiosEnVivo() {
  db.channel(`tracking-${orderId}`)
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