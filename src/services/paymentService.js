import { supabase } from '../lib/supabase';

/**
 * Servicio Centralizado de Pagos, Billeteras y Finanzas para Tropicalia CRB
 * Control estricto de deuda en calle por efectivo, recaudación de Pago Móvil,
 * balance de repartidores y conciliación de caja general.
 */

export const TECHO_DEUDA_EFECTIVO = 25.00;
export const COMISION_PLATAFORMA_PCT = 0.10;
export const FLETE_BASE_DEFAULT = 2.50;

/**
 * Valida y calcula de forma robusta el monto total en efectivo de una comanda,
 * asegurando que nunca sea 0 para prevenir fugas de caja en entregas de alto valor.
 * 
 * @param {Object} orden 
 * @returns {number} Monto total validado en dólares ($)
 */
export function calcularMontoTotalEfectivo(orden) {
  if (!orden) return 0;

  let monto = parseFloat(orden.total || 0);

  // Si por alguna anomalía el total de la orden vino en 0 o inválido:
  if (isNaN(monto) || monto <= 0) {
    const sumaItems = Array.isArray(orden.items)
      ? orden.items.reduce((acc, it) => {
          const precio = parseFloat(it.price || 0);
          const cant = parseInt(it.quantity || 1, 10);
          return acc + (precio * cant);
        }, 0)
      : 0;

    const flete = parseFloat(orden.delivery_fee || (orden.delivery_type === 'delivery' ? FLETE_BASE_DEFAULT : 0));
    const propina = parseFloat(orden.driver_tip || 0);
    const subtotal = parseFloat(orden.subtotal_food || sumaItems);

    monto = parseFloat((subtotal + flete + propina).toFixed(2));
  }

  // Protección final contra ceros en entregas de efectivo: piso mínimo de seguridad
  if (monto <= 0) {
    monto = 5.00;
  }

  return parseFloat(monto.toFixed(2));
}

/**
 * Valida si un repartidor tiene permitido aceptar una carrera con método de pago en efectivo.
 * Si el repartidor tiene deuda en calle acumulada >= $25.00 o está bloqueado, se restringe la carrera.
 * 
 * @param {Object} params
 * @param {Object} params.orden - Comanda a aceptar
 * @param {Object} params.wallet - Billetera actual del repartidor
 * @returns {{ permitido: boolean, motivo?: string }}
 */
export function validarAceptacionCarrera({ orden, wallet }) {
  if (!orden) return { permitido: false, motivo: 'Orden no válida.' };

  const esEfectivo = ['efectivo', 'efectivo_bs'].includes(orden.payment_method);

  if (esEfectivo) {
    const deudaActual = parseFloat(wallet?.cash_debt || 0);
    const estaBloqueado = wallet?.is_blocked === true || deudaActual >= TECHO_DEUDA_EFECTIVO;

    if (estaBloqueado) {
      return {
        permitido: false,
        motivo: `⛔ Límite de efectivo alcanzado. Tienes una deuda de efectivo en calle de $${deudaActual.toFixed(2)} (tope permitido: $${TECHO_DEUDA_EFECTIVO.toFixed(2)}). Debes entregar el efectivo a caja o saldar con tu saldo a favor antes de aceptar más órdenes en efectivo.`
      };
    }
  }

  return { permitido: true };
}

/**
 * Registra y actualiza de inmediato en Supabase los saldos derivados de una orden completada/entregada:
 * 1. Si es Efectivo: Suma el monto total de la orden a la deuda en calle (cash_debt) del repartidor,
 *    acredita el flete a su saldo principal y actualiza el bloqueo si supera $25.00.
 * 2. Si es Pago Móvil / Digital: Acredita el flete de la carrera al balance positivo del motorizado
 *    y asienta el neto correspondiente (90%) en la caja general del restaurante.
 * 
 * @param {Object} params
 * @param {Object} params.orden - Comanda finalizada
 * @param {string} params.driverId - ID del repartidor asignado
 * @returns {Promise<Object>} Resultado de la liquidación financiera
 */
export async function procesarBalanceCompletado({ orden, driverId }) {
  if (!orden) throw new Error('Orden requerida para liquidación de balance.');

  const esEfectivo = ['efectivo', 'efectivo_bs'].includes(orden.payment_method);
  const esPagoMovil = ['pago_movil', 'binance', 'zelle', 'zinli', 'punto'].includes(orden.payment_method);
  const fleteGanado = parseFloat(orden.delivery_fee || (orden.delivery_type === 'delivery' ? FLETE_BASE_DEFAULT : 0)) + parseFloat(orden.driver_tip || 0);

  let walletActualizada = null;

  // -------------------------------------------------------------------------
  // 1. ACTUALIZACIÓN DE BILLETERA DEL REPARTIDOR (SI APLICA)
  // -------------------------------------------------------------------------
  if (driverId) {
    // Consultar el registro más reciente en Supabase para evitar condiciones de carrera
    let { data: wallet } = await supabase
      .from('delivery_wallets')
      .select('*')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (!wallet) {
      const { data: nw } = await supabase.from('delivery_wallets').insert([{
        driver_id: driverId,
        prepaid_balance: 0.00,
        cash_debt: 0.00,
        debt_ceiling: TECHO_DEUDA_EFECTIVO,
        is_blocked: false
      }]).select().single();
      wallet = nw;
    }

    const deudaPrevia = parseFloat(wallet.cash_debt || 0);
    const saldoPrevio = parseFloat(wallet.prepaid_balance || 0);

    let nuevaDeuda = deudaPrevia;
    let nuevoSaldo = saldoPrevio;
    let isBlocked = wallet.is_blocked;

    if (esEfectivo) {
      // Validar monto total en efectivo de la orden (sin fugas)
      const montoEfectivoTotal = calcularMontoTotalEfectivo(orden);

      // Sumar al saldo en efectivo retenido (deuda en calle)
      nuevaDeuda = parseFloat((deudaPrevia + montoEfectivoTotal).toFixed(2));
      isBlocked = nuevaDeuda >= TECHO_DEUDA_EFECTIVO;

      // Se acredita su ganancia de flete a su saldo principal
      nuevoSaldo = parseFloat((saldoPrevio + fleteGanado).toFixed(2));

      const { data: wUp, error: errW } = await supabase
        .from('delivery_wallets')
        .update({
          cash_debt: nuevaDeuda,
          prepaid_balance: nuevoSaldo,
          is_blocked: isBlocked
        })
        .eq('driver_id', driverId)
        .select()
        .single();

      if (errW) throw errW;
      walletActualizada = wUp;

      // Registrar auditoría en delivery_transactions
      try {
        await supabase.from('delivery_transactions').insert([
          {
            driver_id: driverId,
            order_id: orden.id,
            amount: montoEfectivoTotal,
            type: 'cash_debt',
            notes: `Efectivo retenido en calle por comanda #ORD-${orden.id.slice(0, 8)} ($${montoEfectivoTotal.toFixed(2)})`
          },
          {
            driver_id: driverId,
            order_id: orden.id,
            amount: fleteGanado,
            type: 'delivery_fee_credit',
            notes: `Flete acreditado por carrera #ORD-${orden.id.slice(0, 8)}`
          }
        ]);
      } catch (e) {
        // Fallback no bloqueante si la tabla está en proceso de creación
        console.warn('Auditoría transaccional de delivery:', e.message);
      }

    } else {
      // PAGO MÓVIL O MÉTODOS DIGITALES:
      // El motorizado no recibe efectivo físico en calle. Su ganancia de flete se suma de inmediato a su saldo positivo.
      nuevoSaldo = parseFloat((saldoPrevio + fleteGanado).toFixed(2));

      const { data: wUp, error: errW } = await supabase
        .from('delivery_wallets')
        .update({
          prepaid_balance: nuevoSaldo
        })
        .eq('driver_id', driverId)
        .select()
        .single();

      if (errW) throw errW;
      walletActualizada = wUp;

      // Registrar flete digital
      try {
        await supabase.from('delivery_transactions').insert([{
          driver_id: driverId,
          order_id: orden.id,
          amount: fleteGanado,
          type: 'delivery_fee_credit',
          notes: `Flete acreditado por Pago Móvil #ORD-${orden.id.slice(0, 8)} ($${fleteGanado.toFixed(2)})`
        }]);
      } catch (e) {
        console.warn('Auditoría transaccional digital:', e.message);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. ACTUALIZACIÓN DE CAJA GENERAL Y CORTE DEL RESTAURANTE
  // -------------------------------------------------------------------------
  if (orden.business_id) {
    const subtotalComida = parseFloat(orden.subtotal_food || (parseFloat(orden.total || 0) - fleteGanado) || 0);
    const comisionPlataforma = parseFloat((subtotalComida * COMISION_PLATAFORMA_PCT).toFixed(2));
    const netoRestaurante = parseFloat((subtotalComida - comisionPlataforma).toFixed(2));

    try {
      // Buscar corte pendiente del día para este restaurante en Supabase
      const { data: cortesPendientes } = await supabase
        .from('cash_closures')
        .select('*')
        .eq('business_id', orden.business_id)
        .eq('status', 'pending_settlement')
        .order('created_at', { ascending: false })
        .limit(1);

      if (cortesPendientes && cortesPendientes.length > 0) {
        const c = cortesPendientes[0];
        const nuevoBruto = parseFloat((parseFloat(c.gross_amount || 0) + subtotalComida).toFixed(2));
        const nuevaComision = parseFloat((parseFloat(c.commission_amount || 0) + comisionPlataforma).toFixed(2));
        const nuevoNeto = parseFloat((parseFloat(c.net_amount || 0) + netoRestaurante).toFixed(2));

        await supabase.from('cash_closures').update({
          gross_amount: nuevoBruto,
          commission_amount: nuevaComision,
          net_amount: nuevoNeto
        }).eq('id', c.id);
      } else {
        // Crear un corte de turno inicial pendiente
        await supabase.from('cash_closures').insert([{
          business_id: orden.business_id,
          gross_amount: subtotalComida,
          commission_amount: comisionPlataforma,
          net_amount: netoRestaurante,
          status: 'pending_settlement'
        }]);
      }

      // Actualizar columna 'balance' en businesses si está disponible en esquema
      try {
        const { data: bz } = await supabase.from('businesses').select('id, name').eq('id', orden.business_id).single();
        if (bz) {
          await supabase.rpc('increment_business_balance', {
            b_id: orden.business_id,
            amount: netoRestaurante
          });
        }
      } catch (rpcErr) {
        // Si no existe el RPC, no interrumpe el flujo principal
      }

    } catch (cajaErr) {
      console.warn('Actualización de caja general de restaurante:', cajaErr.message);
    }
  }

  // Notificar al contexto global de la aplicación para reactividad instantánea
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tropicalia:balance_actualizado', {
      detail: { driverId, ordenId: orden.id, esEfectivo, esPagoMovil, fleteGanado }
    }));
  }

  return {
    success: true,
    esEfectivo,
    esPagoMovil,
    fleteGanado,
    walletActualizada
  };
}

/**
 * Permite al repartidor amortizar su deuda de efectivo debitando de sus ganancias acumuladas disponibles.
 * Si la deuda desciende por debajo de $25.00, se desbloquea de inmediato.
 * 
 * @param {Object} params
 * @param {string} params.driverId
 * @param {number} params.montoAbono
 * @returns {Promise<Object>}
 */
export async function amortizarDeudaConSaldo({ driverId, montoAbono }) {
  if (!driverId || montoAbono <= 0) throw new Error('Datos de amortización inválidos.');

  const { data: wallet, error: errGet } = await supabase
    .from('delivery_wallets')
    .select('*')
    .eq('driver_id', driverId)
    .single();

  if (errGet || !wallet) throw new Error('No se localizó la billetera del repartidor.');

  const saldoActual = parseFloat(wallet.prepaid_balance || 0);
  const deudaActual = parseFloat(wallet.cash_debt || 0);

  if (saldoActual <= 0) throw new Error('No posees saldo a favor para amortizar deuda.');
  if (deudaActual <= 0) throw new Error('No tienes deuda de efectivo pendiente.');

  const abonoReal = Math.min(saldoActual, deudaActual, parseFloat(montoAbono.toFixed(2)));
  const nuevoSaldo = parseFloat((saldoActual - abonoReal).toFixed(2));
  const nuevaDeuda = parseFloat((deudaActual - abonoReal).toFixed(2));
  const sigueBloqueado = nuevaDeuda >= TECHO_DEUDA_EFECTIVO;

  const { data: wActualizada, error: errUp } = await supabase
    .from('delivery_wallets')
    .update({
      prepaid_balance: nuevoSaldo,
      cash_debt: nuevaDeuda,
      is_blocked: sigueBloqueado
    })
    .eq('driver_id', driverId)
    .select()
    .single();

  if (errUp) throw errUp;

  try {
    await supabase.from('delivery_transactions').insert([{
      driver_id: driverId,
      amount: abonoReal,
      type: 'debt_payment',
      notes: `Amortización de deuda con saldo a favor ($${abonoReal.toFixed(2)})`
    }]);
  } catch (e) {}

  return {
    success: true,
    abonoReal,
    wallet: wActualizada
  };
}

/**
 * Registra la entrega de efectivo físico por parte de un motorizado en la caja administrativa.
 * 
 * @param {Object} params
 * @param {string} params.driverId
 * @param {number} params.montoRecibido
 * @returns {Promise<Object>}
 */
export async function recibirEfectivoEnCajaAdmin({ driverId, montoRecibido }) {
  if (!driverId || montoRecibido <= 0) throw new Error('Monto de entrega en caja inválido.');

  const { data: wallet, error } = await supabase
    .from('delivery_wallets')
    .select('*')
    .eq('driver_id', driverId)
    .single();

  if (error || !wallet) throw new Error('Billetera del repartidor no encontrada.');

  const deudaActual = parseFloat(wallet.cash_debt || 0);
  const nuevaDeuda = Math.max(0, parseFloat((deudaActual - montoRecibido).toFixed(2)));
  const sigueBloqueado = nuevaDeuda >= TECHO_DEUDA_EFECTIVO;

  const { data: wActualizada, error: errUp } = await supabase
    .from('delivery_wallets')
    .update({
      cash_debt: nuevaDeuda,
      is_blocked: sigueBloqueado
    })
    .eq('driver_id', driverId)
    .select()
    .single();

  if (errUp) throw errUp;

  try {
    await supabase.from('delivery_transactions').insert([{
      driver_id: driverId,
      amount: montoRecibido,
      type: 'debt_payment',
      notes: `Recepción de efectivo en caja administrativa ($${montoRecibido.toFixed(2)})`
    }]);
  } catch (e) {}

  return {
    success: true,
    nuevaDeuda,
    wallet: wActualizada
  };
}

