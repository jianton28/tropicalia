/**
 * Servicio Avanzado de Notificaciones por WhatsApp (wa.me) para Tropicalia CRB
 * Enlaces profundos preformateados directos sin intermediarios pagos ni APIs de terceros.
 */

// Teléfono oficial de atención y soporte del negocio Tropicalia CRB
export const NUMERO_ORIGEN_NEGOCIO = '04141352503';
export const NUMERO_ORIGEN_INTERNACIONAL = '584141352503';

/**
 * Normaliza cualquier número de teléfono venezolano al formato internacional E.164 (58XXXXXXXXXX)
 * @param {string|number} phone 
 * @returns {string} Teléfono normalizado con código de país 58
 */
export function formatearTelefonoVE(phone) {
  if (!phone) return '';
  let clean = phone.toString().replace(/\D/g, '');

  if (clean.startsWith('0')) {
    // 04141234567 -> 584141234567
    clean = '58' + clean.slice(1);
  } else if (!clean.startsWith('58') && clean.length === 10) {
    // 4141234567 -> 584141234567
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
 * Genera el cuerpo del mensaje de WhatsApp codificado según el estado del pedido,
 * incluyendo el número de contacto de Tropicalia y el resumen detallado del pedido.
 * 
 * @param {Object} orden - Objeto de la orden/comanda
 * @param {string} nuevoEstado - 'cooking', 'ready', 'on_the_way', 'delivered', 'cancelled', etc.
 * @param {Object} [negocio] - Objeto con datos del local/restaurante
 * @returns {string} Mensaje redactado con formato para WhatsApp (*negritas*, emojis, saltos)
 */
export function generarMensajeEstado(orden, nuevoEstado, negocio) {
  if (!orden) return '';

  const nombreCliente = orden.customer_name || 'Cliente';
  const nombreLocal = negocio?.name || orden.businesses?.name || 'Tropicalia CRB';
  const ordenIdCorta = (orden.id || '').slice(0, 8).toUpperCase();
  const esPickup = orden.delivery_type === 'pickup';
  const codigoSeguro = orden.delivery_code || ordenIdCorta.slice(0, 4);

  // Lista de productos con formato
  const itemsList = Array.isArray(orden.items) && orden.items.length > 0
    ? orden.items.map(i => {
        const cant = i.quantity || 1;
        const precioUnit = i.price ? ` (${fmtUsd(i.price)})` : '';
        return `  • *${cant}x* ${i.name}${precioUnit}`;
      }).join('\n')
    : '  • Pedido del menú Tropicalia';

  const subtotal = orden.subtotal_food ? fmtUsd(orden.subtotal_food) : null;
  const flete = !esPickup && orden.delivery_fee ? fmtUsd(orden.delivery_fee) : null;
  const propina = orden.driver_tip ? fmtUsd(orden.driver_tip) : null;
  const totalUsd = fmtUsd(orden.total);
  const totalBs = orden.total_bs ? `Bs. ${parseFloat(orden.total_bs).toFixed(2)}` : null;
  const metodoPago = (orden.payment_method || 'Digital').toUpperCase().replace(/_/g, ' ');

  // Encabezado oficial de marca y número de contacto
  const cabecera = 
    `🌴 *TROPICALIA CRB* 🌴\n` +
    `_Cocina Gourmet & Delivery Express_\n` +
    `📞 *Contacto del Negocio:* 0414-1352503 (+58 414 135 2503)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `¡Hola, *${nombreCliente}*! 👋\n` +
    `Tu comanda *#ORD-${ordenIdCorta}* en *${nombreLocal}*:\n\n`;

  // Resumen financiero y de productos
  const desgloseFinanciero = 
    `\n📦 *Resumen del Pedido:*\n` +
    `${itemsList}\n\n` +
    (subtotal ? `💵 Subtotal Comida: *${subtotal}*\n` : '') +
    (flete ? `🛵 Costo Delivery: *${flete}*\n` : '') +
    (propina ? `🎁 Propina Repartidor: *${propina}*\n` : '') +
    `💰 *TOTAL:* *${totalUsd}*` + (totalBs ? ` (~${totalBs})\n` : '\n') +
    `💳 *Método de Pago:* ${metodoPago}\n` +
    `🛵 *Modalidad:* ${esPickup ? '🥡 Retiro en Barra (Pickup)' : '🛵 Delivery a Domicilio'}\n` +
    (!esPickup && orden.delivery_address ? `📍 *Dirección:* ${orden.delivery_address}\n` : '');

  // Pie con enlace de rastreo y soporte directo
  const trackingUrl = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/tracking?order_id=${orden.id}`
    : `https://tropicalia.lat/tracking?order_id=${orden.id}`;

  const pie = 
    `\n━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔎 *Rastrea tu pedido en vivo aquí:*\n` +
    `${trackingUrl}\n\n` +
    `💬 *¿Dudas o requerimientos adicionales?*\n` +
    `Escríbenos directamente a WhatsApp: https://wa.me/${NUMERO_ORIGEN_INTERNACIONAL}\n` +
    `_¡Gracias por preferir Tropicalia CRB!_ 🌺`;

  // Mensaje central dependiente del estado
  let estadoMensaje = '';

  switch (nuevoEstado) {
    case 'cooking':
    case 'in_kitchen':
      estadoMensaje =
        `👨‍🍳🔥 *ESTADO: EN PREPARACIÓN*\n` +
        `¡Tu orden acaba de ingresar a nuestros fogones! Nuestro equipo culinario está preparando tus platos con los más altos estándares de calidad.\n` +
        desgloseFinanciero +
        (esPickup
          ? `📍 *Aviso de Retiro:* Puedes ir acercándote al local; te avisaremos apenas salga de la barra.`
          : `🛵 *Aviso de Delivery:* Te notificaremos en cuanto el repartidor retire la bolsa sellada.`);
      break;

    case 'ready':
    case 'ready_for_pickup':
      if (esPickup) {
        estadoMensaje =
          `🥡🎉 *ESTADO: ¡LISTO EN LA BARRA!*\n` +
          `¡Tu comida está caliente y recién empacada esperándote en *${nombreLocal}*!\n\n` +
          `🔑 *Código de Retiro en Barra:* *${codigoSeguro}*\n` +
          `Presenta tu nombre o este código en el mostrador para entregarte tu pedido de inmediato.\n` +
          desgloseFinanciero;
      } else {
        estadoMensaje =
          `📦🛵 *ESTADO: EMPACADO Y SELLADO*\n` +
          `Tu orden ha salido de la cocina y se encuentra empacada con precinto térmico de seguridad.\n\n` +
          `🔑 *Tu Código Seguro de Entrega es:* *${codigoSeguro}*\n` +
          `_(Díctalo al motorizado únicamente al recibir tu paquete sellado en tus manos)_.\n` +
          desgloseFinanciero;
      }
      break;

    case 'on_the_way':
    case 'out_for_delivery':
      estadoMensaje =
        `🚀🛵 *ESTADO: EN RUTA HACIA TU DIRECCIÓN*\n` +
        `¡El repartidor ya tiene tu comida y va en camino a tu destino!\n\n` +
        `🔑 *Código de Recepción:* *${codigoSeguro}*\n` +
        `Por favor ten a la mano tu código para dictarlo al momento de la entrega.\n` +
        desgloseFinanciero;
      break;

    case 'delivered':
      estadoMensaje =
        `✅🎉 *ESTADO: ¡PEDIDO ENTREGADO!*\n` +
        `Confirmamos que tu pedido ha sido entregado exitosamente.\n\n` +
        `¡Esperamos que disfrutes de tu comida! Si tienes algún comentario sobre la calidad o el servicio, no dudes en escribirnos.\n` +
        `_¡Buen provecho!_ ✨\n` +
        desgloseFinanciero;
      break;

    case 'cancelled':
      estadoMensaje =
        `⚠️❌ *ESTADO: COMANDA CANCELADA*\n` +
        `Te confirmamos que la orden *#ORD-${ordenIdCorta}* ha sido cancelada.\n\n` +
        `Si realizaste un pago digital previo (Pago Móvil, Binance, etc.), nuestro equipo administrativo se encuentra a tu disposición para conciliar la devolución o crédito inmediato.\n` +
        `📞 *Línea Directa de Soporte:* 0414-1352503\n` +
        desgloseFinanciero;
      break;

    default:
      estadoMensaje =
        `ℹ️ *ACTUALIZACIÓN DE ESTADO: ${(nuevoEstado || '').toUpperCase()}*\n` +
        `Tu comanda ha registrado una actualización en el sistema.\n` +
        desgloseFinanciero;
      break;
  }

  return cabecera + estadoMensaje + pie;
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

  // Notificar al contexto de la app para componentes que deseen mostrar toast interactivo
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tropicalia:whatsapp_notificado', {
      detail: { ordenId: orden.id, url, nuevoEstado, telefonoCliente: orden.customer_phone }
    }));
  }

  return { success: true, url, texto };
}
