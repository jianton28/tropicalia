/**
 * Servicio de notificaciones directas por WhatsApp (wa.me) para Tropicalia CRB
 * Sin dependencias de servicios pagos o APIs de terceros.
 */

export function formatearTelefonoVE(phone) {
  if (!phone) return '';
  let clean = phone.toString().replace(/\D/g, '');

  // Manejar formatos venezolanos comunes (0412, 0414, 0424, 0416, 0426)
  if (clean.startsWith('0')) {
    clean = '58' + clean.slice(1);
  } else if (!clean.startsWith('58') && clean.length === 10) {
    clean = '58' + clean;
  }
  return clean;
}

export function generarMensajeEstado(orden, nuevoEstado, negocio) {
  if (!orden) return '';

  const nombreCliente = orden.customer_name || 'Cliente';
  const nombreLocal = negocio?.name || orden.businesses?.name || 'Tropicalia CRB';
  const ordenIdCorta = (orden.id || '').slice(0, 8).toUpperCase();
  const esPickup = orden.delivery_type === 'pickup';
  const codigoSeguro = orden.delivery_code || ordenIdCorta.slice(0, 4);

  const itemsList = Array.isArray(orden.items)
    ? orden.items.map(i => `  • ${i.quantity || 1}x ${i.name}`).join('\n')
    : '';

  switch (nuevoEstado) {
    case 'cooking':
      return (
        `*¡Hola, ${nombreCliente}!* 👨‍🍳🔥\n\n` +
        `Te informamos que tu comanda *#ORD-${ordenIdCorta}* en *${nombreLocal}* acaba de ingresar a nuestros fogones y está *EN PREPARACIÓN*.\n\n` +
        `📋 *Detalle del Pedido:*\n${itemsList}\n\n` +
        `Modalidad: *${esPickup ? '🥡 Retiro en Mostrador (Pickup)' : '🛵 Delivery a Domicilio'}*\n\n` +
        (esPickup
          ? `📍 Puedes ir acercándote al local para retirar tu comida recién salida de la cocina.`
          : `🛵 Te notificaremos en cuanto el repartidor retire tu orden sellada.`) +
        `\n\n_¡Gracias por preferir Tropicalia CRB!_ 🌴`
      );

    case 'ready':
      if (esPickup) {
        return (
          `*¡Hola, ${nombreCliente}!* 🥡🎉\n\n` +
          `¡Tu pedido *#ORD-${ordenIdCorta}* ya está *LISTO EN LA BARRA* de *${nombreLocal}*!\n\n` +
          `🔑 *Código de Retiro:* *${codigoSeguro}*\n` +
          `📍 Acércate al mostrador de retiro e indica tu nombre o este código para recibir tu comida caliente y empacada.\n\n` +
          `_¡Buen provecho!_ ✨`
        );
      } else {
        return (
          `*¡Hola, ${nombreCliente}!* 📦🛵\n\n` +
          `Tu pedido *#ORD-${ordenIdCorta}* en *${nombreLocal}* ya está *EMPACADO Y SELLADO* con sello térmico.\n\n` +
          `El repartidor asignado ya se encuentra listo para iniciar el traslado hacia tu dirección.\n\n` +
          `🔑 *Tu Código Seguro de Entrega es:* *${codigoSeguro}*\n` +
          `(Díctalo al motorizado únicamente al recibir la bolsa sellada en tus manos).\n\n` +
          `_¡Tropicalia Express en camino!_ 🚀`
        );
      }

    case 'cancelled':
      return (
        `*Hola, ${nombreCliente}.*\n\n` +
        `Te confirmamos que tu orden *#ORD-${ordenIdCorta}* en *${nombreLocal}* ha sido *CANCELADA* exitosamente.\n\n` +
        `Los artículos han sido reintegrados al inventario disponible. Si realizaste un pago previo, nuestro equipo de soporte se comunicará contigo para la conciliación inmediata.\n\n` +
        `_Atención al Cliente Tropicalia CRB_ 🌴`
      );

    default:
      return (
        `*Hola, ${nombreCliente}!* Tu pedido #ORD-${ordenIdCorta} en ${nombreLocal} se encuentra actualmente en estado: *${nuevoEstado}*.`
      );
  }
}

/**
 * Genera el enlace wa.me preformateado y lo abre en una nueva pestaña
 */
export function abrirNotificacionWhatsApp(orden, nuevoEstado, negocio) {
  if (!orden || !orden.customer_phone) {
    console.warn('Orden sin número de teléfono del cliente para WhatsApp');
    return null;
  }

  const telefonoVE = formatearTelefonoVE(orden.customer_phone);
  if (!telefonoVE) return null;

  const textoMensaje = generarMensajeEstado(orden, nuevoEstado, negocio);
  const url = `https://wa.me/${telefonoVE}?text=${encodeURIComponent(textoMensaje)}`;

  try {
    window.open(url, '_blank');
  } catch (e) {
    console.warn('Popup bloqueado al abrir WhatsApp:', e);
  }

  return url;
}

