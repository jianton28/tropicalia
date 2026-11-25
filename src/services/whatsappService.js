/**
 * Servicio Simplificado de Notificaciones por WhatsApp (wa.me) para Tropicalia CRB
 * Consolidado al mínimo indispensable para evitar saturar al cliente con múltiples
 * mensajes consecutivos por una misma orden.
 */

// Teléfono oficial de atención y soporte del negocio Tropicalia CRB
export const NUMERO_ORIGEN_NEGOCIO = '04141352503';
export const NUMERO_ORIGEN_INTERNACIONAL = '584141352503';

// Registro en memoria de notificaciones automáticas ya disparadas en la sesión
// para prevenir envíos duplicados o consecutivos sobre una misma orden/estado.
const notificacionesDisparadas = new Set();

/**
 * Normaliza cualquier número de teléfono venezolano al formato internacional E.164 (58XXXXXXXXXX)
 * @param {string|number} phone 
 * @returns {string} Teléfono normalizado con código de país 58
 */
export function formatearTelefonoVE(phone) {
  if (!phone) return '';
  let clean = phone.toString().replace(/\D/g, '');

  if (clean.startsWith('0')) {
    clean = '58' + clean.slice(1);
  } else if (!clean.startsWith('58') && clean.length === 10) {
    clean = '58' + clean;
  }
  return clean;
}

/**
 * Formatea un monto numérico a string en dólares ($ USD)
 */
function fmtUsd(amount) {
  return `$${parseFloat(amount || 0).toFixed(2)}`;
}

/**
 * Determina si una transición de estado debe disparar notificación automática por WhatsApp.
 * Regla de consolidación (máximo 1 aviso operativo indispensable por orden + cancelación):
 * - Delivery: solo al salir 'on_the_way' (incluye código seguro y rastreo) o 'cancelled'.
 * - Pickup: solo al estar 'ready' en barra (incluye código de retiro) o 'cancelled'.
 * - Estados intermedios ('pending', 'cooking', 'ready' en delivery, 'delivered') se ven en vivo en /tracking.
 *
 * @param {string} nuevoEstado
 * @param {string} [deliveryType='delivery']
 * @returns {boolean}
 */
export function debeNotificarAutomaticamente(nuevoEstado, deliveryType = 'delivery') {
  if (!nuevoEstado) return false;
  if (nuevoEstado === 'cancelled') return true;
  if (deliveryType === 'pickup') {
    return nuevoEstado === 'ready' || nuevoEstado === 'ready_for_pickup';
  }
  return nuevoEstado === 'on_the_way' || nuevoEstado === 'out_for_delivery';
}

/**
 * Genera el cuerpo del mensaje de WhatsApp limpio, directo y sin ruido visual.
 *
 * @param {Object} orden - Objeto de la orden/comanda
 * @param {string} nuevoEstado - 'cooking', 'ready', 'on_the_way', 'delivered', 'cancelled', etc.
 * @param {Object} [negocio] - Objeto con datos del local/restaurante
 * @returns {string} Mensaje redactado de forma clara y directa
 */
export function generarMensajeEstado(orden, nuevoEstado, negocio) {
  if (!orden) return '';

  const nombreCliente = orden.customer_name || 'Cliente';
  const nombreLocal = negocio?.name || orden.businesses?.name || 'Tropicalia CRB';
  const ordenIdCorta = (orden.id || '').slice(0, 8).toUpperCase();
  const esPickup = orden.delivery_type === 'pickup';
  const codigoSeguro = orden.delivery_code || ordenIdCorta.slice(0, 4);

  const itemsList = Array.isArray(orden.items) && orden.items.length > 0
    ? orden.items.map(i => {
        const cant = i.quantity || 1;
        return `- ${cant}x ${i.name}`;
      }).join('\n')
    : '- Pedido del menú Tropicalia';

  const totalUsd = fmtUsd(orden.total);
  const trackingUrl = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/tracking?order_id=${orden.id}`
    : `https://tropicalia-rho.vercel.app/tracking?order_id=${orden.id}`;

  let estadoTitulo = '';
  let detalleEstado = '';

  switch (nuevoEstado) {
    case 'cooking':
    case 'in_kitchen':
      estadoTitulo = 'EN PREPARACIÓN';
      detalleEstado = `Tu pedido en ${nombreLocal} está siendo preparado.`;
      break;

    case 'ready':
    case 'ready_for_pickup':
      if (esPickup) {
        estadoTitulo = 'LISTO PARA RETIRAR EN BARRA';
        detalleEstado = `Tu pedido en ${nombreLocal} está listo.\nCódigo de retiro: *${codigoSeguro}*`;
      } else {
        estadoTitulo = 'EMPACADO Y LISTO PARA DESPACHO';
        detalleEstado = `Tu pedido ya salió de cocina y espera al repartidor.\nCódigo seguro de entrega: *${codigoSeguro}*`;
      }
      break;

    case 'on_the_way':
    case 'out_for_delivery':
      estadoTitulo = 'EN CAMINO A TU DIRECCIÓN';
      detalleEstado = `El repartidor ya salió con tu pedido.\nCódigo seguro de entrega: *${codigoSeguro}*`;
      break;

    case 'delivered':
      estadoTitulo = 'PEDIDO ENTREGADO';
      detalleEstado = 'Confirmamos la entrega de tu pedido. Gracias por preferirnos.';
      break;

    case 'cancelled':
      estadoTitulo = 'PEDIDO CANCELADO';
      detalleEstado = `La orden #ORD-${ordenIdCorta} fue cancelada. Si realizaste pago digital, contáctanos para gestionar el reintegro.`;
      break;

    default:
      estadoTitulo = (nuevoEstado || 'ACTUALIZACIÓN').toUpperCase();
      detalleEstado = 'Tu pedido presenta una actualización en el sistema.';
      break;
  }

  return (
    `*TROPICALIA CRB* | Orden #ORD-${ordenIdCorta}\n` +
    `Hola *${nombreCliente}*, estado: *${estadoTitulo}*\n\n` +
    `${detalleEstado}\n\n` +
    `*Detalle:*\n${itemsList}\n` +
    `*Total:* ${totalUsd}\n\n` +
    `Rastreo en vivo: ${trackingUrl}\n` +
    `Soporte: 0414-1352503`
  );
}

/**
 * Genera el enlace directo wa.me preformateado hacia el teléfono del cliente
 * @param {Object} orden 
 * @param {string} nuevoEstado 
 * @param {Object} [negocio] 
 * @returns {string|null} URL completa https://wa.me/...
 */
export function generarEnlaceWhatsApp(orden, nuevoEstado, negocio) {
  if (!orden || !orden.customer_phone) return null;

  const telefonoCliente = formatearTelefonoVE(orden.customer_phone);
  if (!telefonoCliente) return null;

  const textoMensaje = generarMensajeEstado(orden, nuevoEstado, negocio);
  return `https://wa.me/${telefonoCliente}?text=${encodeURIComponent(textoMensaje)}`;
}

/**
 * Dispara la notificación abriendo el enlace profundo wa.me
 * y emite un evento del DOM para sincronizar la interfaz del operador.
 * 
 * @param {Object} orden 
 * @param {string} nuevoEstado 
 * @param {Object} [negocio] 
 * @param {boolean} [autoOpen=true] - Si true, intenta abrir en pestaña nueva
 * @returns {Object} { url, texto, success }
 */
export function abrirNotificacionWhatsApp(orden, nuevoEstado, negocio, autoOpen = true) {
  const url = generarEnlaceWhatsApp(orden, nuevoEstado, negocio);
  if (!url) {
    console.warn('[WhatsApp] No se pudo generar enlace: falta teléfono del cliente o datos de la orden.');
    return { success: false, url: null };
  }

  const texto = generarMensajeEstado(orden, nuevoEstado, negocio);

  if (autoOpen && typeof window !== 'undefined') {
    try {
      const popup = window.open(url, '_blank');
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        console.warn('[WhatsApp] Popup bloqueado por el navegador. El usuario puede utilizar el botón directo.');
      }
    } catch (e) {
      console.warn('[WhatsApp] Excepción al abrir popup:', e);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tropicalia:whatsapp_notificado', {
      detail: { ordenId: orden.id, url, nuevoEstado, telefonoCliente: orden.customer_phone }
    }));
  }

  return { success: true, url, texto };
}

/**
 * Envía la notificación automática únicamente si corresponde al hito indispensable
 * de la modalidad (1 mensaje clave por orden) y no ha sido enviada previamente.
 *
 * @param {Object} orden
 * @param {string} nuevoEstado
 * @param {Object} [negocio]
 * @returns {Object} { skipped?: boolean, success: boolean, url: string|null }
 */
export function abrirNotificacionWhatsAppSiCorresponde(orden, nuevoEstado, negocio) {
  if (!orden) return { success: false, skipped: true, url: null };
  const deliveryType = orden.delivery_type || 'delivery';

  if (!debeNotificarAutomaticamente(nuevoEstado, deliveryType)) {
    return { success: true, skipped: true, url: null };
  }

  const dedupKey = `${orden.id}:${nuevoEstado}`;
  if (notificacionesDisparadas.has(dedupKey)) {
    return { success: true, skipped: true, url: null };
  }

  notificacionesDisparadas.add(dedupKey);
  return abrirNotificacionWhatsApp(orden, nuevoEstado, negocio, true);
}
