import { supabase } from '../lib/supabase.js';

/**
 * Servicio de gestión y reversión de inventario / stock para Tropicalia CRB
 */

/**
 * Revierte los insumos y stock de un pedido cancelado, devolviéndolos al inventario disponible.
 * @param {Object} order - Objeto de comanda con sus items
 */
export async function revertirStockDeOrden(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const items = order.items;
    const businessId = order.business_id;

    // 1. Obtener IDs y nombres de los platos de la orden
    const productIds = items
      .map(i => i.product_id || i.id)
      .filter(Boolean);

    // 2. Consultar recetas vinculadas a estos productos
    let recetas = [];
    if (productIds.length > 0) {
      const { data: recData } = await supabase
        .from('product_recipes')
        .select('*')
        .in('product_id', productIds);
      recetas = recData || [];
    }

    // 3. Consultar todos los insumos actuales del restaurante
    const { data: insumos } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('business_id', businessId);

    const insumosMap = new Map((insumos || []).map(i => [i.id, i]));
    const insumosPorNombre = new Map((insumos || []).map(i => [i.name.toLowerCase().trim(), i]));

    let revertedCount = 0;

    // 4. Procesar cada plato de la orden
    for (const item of items) {
      const prodId = item.product_id || item.id;
      const cantOrdenada = parseInt(item.quantity || 1, 10);
      const recsDelPlato = recetas.filter(r => r.product_id === prodId);

      if (recsDelPlato.length > 0) {
        // Tiene receta: devolver cada ingrediente
        for (const r of recsDelPlato) {
          const ins = insumosMap.get(r.inventory_item_id);
          if (ins) {
            const devuelto = parseFloat(r.quantity_required || 0) * cantOrdenada;
            const nuevaCantidad = parseFloat(ins.quantity || 0) + devuelto;

            await supabase
              .from('inventory_items')
              .update({ quantity: nuevaCantidad })
              .eq('id', ins.id);

            ins.quantity = nuevaCantidad; // actualizar cache local
            revertedCount++;
          }
        }
      } else {
        // No tiene receta directa: verificar si el plato existe directamente como insumo/producto terminado
        const nombreItem = (item.name || '').toLowerCase().trim();
        const insDirecto = insumosPorNombre.get(nombreItem);
        if (insDirecto) {
          const nuevaCantidad = parseFloat(insDirecto.quantity || 0) + cantOrdenada;
          await supabase
            .from('inventory_items')
            .update({ quantity: nuevaCantidad })
            .eq('id', insDirecto.id);

          insDirecto.quantity = nuevaCantidad;
          revertedCount++;
        }
      }
    }

    // 5. Registrar en la bitácora de cocina (kitchen_logs)
    await supabase.from('kitchen_logs').insert([{
      business_id: businessId,
      log_type: 'reversion_cancelacion',
      item_name: `Orden #${order.id.slice(0, 8)}`,
      quantity: items.length,
      amount_usd: parseFloat(order.total || 0),
      notes: `Reversión automática de insumos devueltos al stock (${revertedCount} items/ingredientes restaurados)`
    }]);

    return { success: true, count: revertedCount };
  } catch (error) {
    console.error('Error al revertir stock de la orden:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Descuenta los insumos de una comanda al entrar a cocina / preparación
 * @param {Object} order - Objeto de comanda
 */
export async function descontarStockDeOrden(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const items = order.items;
    const businessId = order.business_id;

    const productIds = items.map(i => i.product_id || i.id).filter(Boolean);
    let recetas = [];
    if (productIds.length > 0) {
      const { data: recData } = await supabase
        .from('product_recipes')
        .select('*')
        .in('product_id', productIds);
      recetas = recData || [];
    }

    const { data: insumos } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('business_id', businessId);

    const insumosMap = new Map((insumos || []).map(i => [i.id, i]));
    const insumosPorNombre = new Map((insumos || []).map(i => [i.name.toLowerCase().trim(), i]));

    for (const item of items) {
      const prodId = item.product_id || item.id;
      const cant = parseInt(item.quantity || 1, 10);
      const recs = recetas.filter(r => r.product_id === prodId);

      if (recs.length > 0) {
        for (const r of recs) {
          const ins = insumosMap.get(r.inventory_item_id);
          if (ins) {
            const gasto = parseFloat(r.quantity_required || 0) * cant;
            const nuevaCant = Math.max(0, parseFloat(ins.quantity || 0) - gasto);
            await supabase
              .from('inventory_items')
              .update({ quantity: nuevaCant })
              .eq('id', ins.id);
            ins.quantity = nuevaCant;
          }
        }
      } else {
        const nombre = (item.name || '').toLowerCase().trim();
        const ins = insumosPorNombre.get(nombre);
        if (ins) {
          const nuevaCant = Math.max(0, parseFloat(ins.quantity || 0) - cant);
          await supabase
            .from('inventory_items')
            .update({ quantity: nuevaCant })
            .eq('id', ins.id);
          ins.quantity = nuevaCant;
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error al descontar stock:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancela una orden activa y revierte automáticamente los artículos al inventario.
 * @param {string} orderId - ID de la comanda
 * @param {string} motivo - Motivo de la cancelación
 * @param {string} canceladoPor - 'cliente' | 'cocina' | 'admin'
 */
export async function cancelarOrdenConReversion(orderId, motivo = 'Cancelado por el usuario', canceladoPor = 'cliente') {
  if (!orderId) throw new Error('ID de orden no especificado');

  // 1. Obtener la orden actual
  const { data: orden, error: ordError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (ordError || !orden) {
    throw new Error('No se encontró el pedido a cancelar');
  }

  // 2. Validar que no esté ya entregado o cancelado
  if (orden.status === 'delivered') {
    throw new Error('No es posible cancelar un pedido que ya fue entregado');
  }

  if (orden.status === 'cancelled') {
    return { success: true, alreadyCancelled: true };
  }

  // 3. Ejecutar reversión de stock si la orden estaba en preparación o activa
  const resReversion = await revertirStockDeOrden(orden);

  // 4. Actualizar el estado de la orden a 'cancelled'
  const fechaHora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  const notaCancelacion = `[Cancelado por ${canceladoPor} a las ${fechaHora}: ${motivo}]`;
  const notasFinales = orden.notes ? `${orden.notes} • ${notaCancelacion}` : notaCancelacion;

  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      delivery_status: 'cancelled',
      notes: notasFinales
    })
    .eq('id', orderId);

  if (updateError) {
    throw new Error('Error al actualizar estado en base de datos: ' + updateError.message);
  }

  // 5. Si fue cancelado por el cliente, limpiar orden activa en localStorage
  if (canceladoPor === 'cliente' && typeof localStorage !== 'undefined') {
    const lastId = localStorage.getItem('tropicalia_last_order_id');
    if (lastId === orderId) {
      localStorage.removeItem('tropicalia_last_order_id');
    }
  }

  return {
    success: true,
    reversionCount: resReversion.count || 0
  };
}
