import { supabase } from '../lib/supabase.js';

/**
 * Servicio Centralizado de Pagos, Billeteras y Finanzas para Tropicalia CRB
 * Control estricto de deuda en calle por efectivo, recaudación de Pago Móvil,
 * balance de repartidores y conciliación de caja general.
 */

export const TECHO_DEUDA_EFECTIVO = 25.00;
export const COMISION_PLATAFORMA_PCT = 0.10;
export const FLETE_BASE_DEFAULT = 2.50;

function parseOptionalAmount(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const num = parseFloat(val);
  return isNaN(num) ? fallback : num;
}

function isMissingRpcError(err) {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  return err.code === 'PGRST202' || err.code === '42883' || msg.includes('could not find the function') || msg.includes('does not exist');
}

function emitBalanceEvent(detail) {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tropicalia:balance_actualizado', { detail }));
  }
}

/**
 * Calcula la deuda neta de efectivo que debe entregar el repartidor tras retener
 * inmediatamente en físico su comisión/flete ganado (ej. $7.75 total - $1.75 flete = $6.00 neto).
 * Previene el doble cobro o endeudamiento artificial del repartidor.
 * 
 * @param {number|string} montoTotal 
 * @param {number|string} fleteGanado 
 * @returns {number} Monto neto adeudado
 */
export function calcularNetoDeudaEfectivo(montoTotal, fleteGanado) {
  const total = parseOptionalAmount(montoTotal, 0);
  const flete = parseOptionalAmount(fleteGanado, 0);
  return Math.max(0, parseFloat((total - flete).toFixed(2)));
}

/**
 * Valida y calcula de forma robusta el monto total en efectivo de una comanda,
 * asegurando que nunca sea 0 para prevenir fugas de caja en entregas de alto valor.
 * 
 * @param {Object} orden 
 * @returns {number} Monto total validado en dólares ($)
 */
export function calcularMontoTotalEfectivo(orden) {
  if (!orden) return 0;

  let monto = parseFloat(orden.total ?? 0);

  // Si por alguna anomalía el total de la orden vino en 0 o inválido:
  if (isNaN(monto) || monto <= 0) {
    const sumaItems = Array.isArray(orden.items)
      ? orden.items.reduce((acc, it) => {
          const precio = parseOptionalAmount(it.price, 0);
          const cant = parseInt(it.quantity || 1, 10);
          return acc + (precio * cant);
        }, 0)
      : 0;

    const flete = parseOptionalAmount(orden.delivery_fee, orden.delivery_type === 'delivery' ? FLETE_BASE_DEFAULT : 0);
    const propina = parseOptionalAmount(orden.driver_tip, 0);
    const subtotal = parseOptionalAmount(orden.subtotal_food, sumaItems);

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
        motivo: `Límite de efectivo alcanzado. Tienes una deuda de efectivo en calle de $${deudaActual.toFixed(2)} (tope permitido: $${TECHO_DEUDA_EFECTIVO.toFixed(2)}). Debes entregar el efectivo a caja o saldar con tu saldo a favor antes de aceptar más órdenes en efectivo.`
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
export async function procesarBalanceCompletado({ orden, driverId, sb = supabase }) {
  if (!orden) throw new Error('Orden requerida para liquidación de balance.');

  const esEfectivo = ['efectivo', 'efectivo_bs'].includes(orden.payment_method);
  const esPagoMovil = ['pago_movil', 'binance', 'zelle', 'zinli', 'punto', 'kontigo', 'paypal'].includes(orden.payment_method);
  const fleteBase = parseOptionalAmount(
    orden.delivery_fee,
    orden.delivery_type === 'delivery' ? FLETE_BASE_DEFAULT : 0
  );
  const propina = parseOptionalAmount(orden.driver_tip, 0);
  const fleteGanado = parseFloat((fleteBase + propina).toFixed(2));
  const montoEfectivoTotal = esEfectivo ? calcularMontoTotalEfectivo(orden) : 0;
  const montoNetoDeuda = esEfectivo ? calcularNetoDeudaEfectivo(montoEfectivoTotal, fleteGanado) : 0;

  // 0. LIQUIDACIÓN ATÓMICA EN POSTGRESQL VIA RPC SEGURA (SECURITY DEFINER ZERO-TRUST)
  if (driverId) {
    try {
      const { data: rpcRes, error: rpcErr } = await sb.rpc('procesar_balance_completado_seguro', {
        p_order_id: orden.id,
        p_driver_id: driverId
      });
      if (rpcErr && !isMissingRpcError(rpcErr)) {
        throw new Error(rpcErr.message || 'Error en liquidación RPC');
      }
      if (!rpcErr && rpcRes && rpcRes.success) {
        const walletObj = {
          driver_id: driverId,
          cash_debt: parseOptionalAmount(rpcRes.cash_debt, 0),
          prepaid_balance: parseOptionalAmount(rpcRes.prepaid_balance, 0),
          is_blocked: Boolean(rpcRes.is_blocked)
        };
        emitBalanceEvent({ driverId, ordenId: orden.id, esEfectivo, esPagoMovil, fleteGanado });
        return {
          success: true,
          exito: true,
          esEfectivo,
          esPagoMovil,
          fleteGanado,
          montoNetoDeuda,
          wallet: walletObj,
          walletActualizada: walletObj,
          tipo: esEfectivo ? 'efectivo' : 'digital',
          modoSeguro: 'RPC_SECURITY_DEFINER'
        };
      }
    } catch (rpcException) {
      if (!isMissingRpcError(rpcException)) {
        throw rpcException;
      }
      // Fallback suave a liquidación cliente únicamente si la RPC no existe aún en el host
    }
  }

  let walletActualizada = null;

  // -------------------------------------------------------------------------
  // 1. ACTUALIZACIÓN DE BILLETERA DEL REPARTIDOR (FALLBACK SI NO HAY RPC)
  // -------------------------------------------------------------------------
  if (driverId) {
    // Consultar el registro más reciente en Supabase para evitar condiciones de carrera
    let { data: wallet } = await sb
      .from('delivery_wallets')
      .select('*')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (!wallet) {
      const { data: nw } = await sb.from('delivery_wallets').insert([{
        driver_id: driverId,
        prepaid_balance: 0.00,
        cash_debt: 0.00,
        debt_ceiling: TECHO_DEUDA_EFECTIVO,
        is_blocked: false
      }]).select().single();
      wallet = nw;
    }

    const deudaPrevia = parseOptionalAmount(wallet?.cash_debt, 0);
    const saldoPrevio = parseOptionalAmount(wallet?.prepaid_balance, 0);

    let nuevaDeuda = deudaPrevia;
    let nuevoSaldo = saldoPrevio;
    let isBlocked = Boolean(wallet?.is_blocked);

    if (esEfectivo) {
      // DESCUENTO AUTOMÁTICO DE COMISIÓN/FLETE GANADO EN EFECTIVO:
      // El cliente paga el total de la orden en efectivo (ej. $7.75) al motorizado.
      // El repartidor retiene de inmediato en mano su flete ($1.75).
      // Por ende, la deuda a rendir en caja aumenta ÚNICAMENTE por el neto de la comida ($6.00).
      nuevaDeuda = parseFloat((deudaPrevia + montoNetoDeuda).toFixed(2));
      isBlocked = nuevaDeuda >= TECHO_DEUDA_EFECTIVO;

      // El flete ya fue cobrado y retenido físicamente en mano por el repartidor,
      // por lo que NO se abona a prepaid_balance para prevenir duplicidad de pagos digitales.
      nuevoSaldo = saldoPrevio;

      const { data: wUp, error: errW } = await sb
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
        await sb.from('delivery_transactions').insert([
          {
            driver_id: driverId,
            order_id: orden.id,
            amount: montoNetoDeuda,
            type: 'cash_debt',
            notes: `Deuda neta retenida por comanda #ORD-${String(orden.id).slice(0, 8)}: Total $${montoEfectivoTotal.toFixed(2)} - Flete retenido $${fleteGanado.toFixed(2)} = Neto a rendir $${montoNetoDeuda.toFixed(2)}`
          },
          {
            driver_id: driverId,
            order_id: orden.id,
            amount: fleteGanado,
            type: 'delivery_fee_offset',
            notes: `Flete de $${fleteGanado.toFixed(2)} retenido en efectivo por el repartidor (auto-liquidado en bolsillo)`
          }
        ]);
      } catch (e) {
        console.warn('Auditoría transaccional de delivery:', e.message);
      }

    } else {
      // PAGO MÓVIL O MÉTODOS DIGITALES:
      // El motorizado no recibe efectivo físico en calle. Su ganancia de flete se suma de inmediato a su saldo positivo.
      nuevoSaldo = parseFloat((saldoPrevio + fleteGanado).toFixed(2));

      const { data: wUp, error: errW } = await sb
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
        await sb.from('delivery_transactions').insert([{
          driver_id: driverId,
          order_id: orden.id,
          amount: fleteGanado,
          type: 'delivery_fee_credit',
          notes: `Flete acreditado por Pago Móvil #ORD-${String(orden.id).slice(0, 8)} ($${fleteGanado.toFixed(2)})`
        }]);
      } catch (e) {
        console.warn('Auditoría transaccional digital:', e.message);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. ACTUALIZACIÓN DE BALANCE ACUMULADO DEL RESTAURANTE (SIN PRE-CREAR CIERRE)
  // Los cortes en cash_closures son creados explícitamente por Cocina al cerrar turno.
  // -------------------------------------------------------------------------
  if (orden.business_id) {
    const fallbackFood = Math.max(0, parseOptionalAmount(orden.total, 0) - fleteGanado);
    const subtotalComida = parseOptionalAmount(orden.subtotal_food, fallbackFood);
    const comisionPlataforma = parseFloat((subtotalComida * COMISION_PLATAFORMA_PCT).toFixed(2));
    const netoRestaurante = parseFloat((subtotalComida - comisionPlataforma).toFixed(2));

    try {
      const { error: rpcErr } = await sb.rpc('increment_business_balance', {
        b_id: orden.business_id,
        amount: netoRestaurante
      });
      if (rpcErr && isMissingRpcError(rpcErr)) {
        const { data: bz } = await sb
          .from('businesses')
          .select('id, balance, total_sales')
          .eq('id', orden.business_id)
          .maybeSingle();
        if (bz) {
          await sb.from('businesses').update({
            balance: parseFloat((parseOptionalAmount(bz.balance, 0) + netoRestaurante).toFixed(2)),
            total_sales: parseFloat((parseOptionalAmount(bz.total_sales, 0) + subtotalComida).toFixed(2))
          }).eq('id', orden.business_id);
        }
      }
    } catch (cajaErr) {
      console.warn('Actualización de balance de restaurante:', cajaErr.message);
    }
  }

  // Notificar al contexto global de la aplicación para reactividad instantánea
  emitBalanceEvent({ driverId, ordenId: orden.id, esEfectivo, esPagoMovil, fleteGanado });

  return {
    success: true,
    exito: true,
    esEfectivo,
    esPagoMovil,
    fleteGanado,
    montoNetoDeuda,
    tipo: esEfectivo ? 'efectivo' : 'digital',
    wallet: walletActualizada,
    walletActualizada,
    modoSeguro: 'CLIENT_FALLBACK'
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
export async function amortizarDeudaConSaldo({ driverId, montoAbono, sb = supabase }) {
  if (!driverId || montoAbono <= 0) throw new Error('Datos de amortización inválidos.');

  try {
    const { data: rpcRes, error: rpcErr } = await sb.rpc('amortizar_deuda_con_saldo_seguro', {
      p_driver_id: driverId,
      p_monto: parseFloat(Number(montoAbono).toFixed(2))
    });
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw new Error(rpcErr.message || 'Error amortizando deuda');
    }
    if (!rpcErr && rpcRes && rpcRes.success) {
      return {
        success: true,
        abonoReal: rpcRes.abono_real,
        wallet: rpcRes.wallet
      };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) throw err;
  }

  const { data: wallet, error: errGet } = await sb
    .from('delivery_wallets')
    .select('*')
    .eq('driver_id', driverId)
    .single();

  if (errGet || !wallet) throw new Error('No se localizó la billetera del repartidor.');

  const saldoActual = parseOptionalAmount(wallet.prepaid_balance, 0);
  const deudaActual = parseOptionalAmount(wallet.cash_debt, 0);

  if (saldoActual <= 0) throw new Error('No posees saldo a favor para amortizar deuda.');
  if (deudaActual <= 0) throw new Error('No tienes deuda de efectivo pendiente.');

  const abonoReal = Math.min(saldoActual, deudaActual, parseFloat(Number(montoAbono).toFixed(2)));
  const nuevoSaldo = parseFloat((saldoActual - abonoReal).toFixed(2));
  const nuevaDeuda = parseFloat((deudaActual - abonoReal).toFixed(2));
  const sigueBloqueado = nuevaDeuda >= TECHO_DEUDA_EFECTIVO;

  const { data: wActualizada, error: errUp } = await sb
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
    await sb.from('delivery_transactions').insert([{
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
 * Solicita un retiro Pago Móvil del saldo a favor del repartidor vía RPC Zero-Trust
 * (evita fallos de RLS por escritura directa en delivery_wallets).
 */
export async function solicitarRetiroDriver({
  driverId,
  amount,
  bankName,
  idDoc,
  phone,
  sb = supabase
}) {
  const monto = parseFloat(Number(amount || 0).toFixed(2));
  if (!driverId || isNaN(monto) || monto <= 0) {
    throw new Error('Monto de retiro inválido.');
  }
  if (!String(idDoc || '').trim() || !String(phone || '').trim()) {
    throw new Error('Datos de Pago Móvil incompletos.');
  }

  try {
    const { data: rpcRes, error: rpcErr } = await sb.rpc('solicitar_retiro_driver_seguro', {
      p_driver_id: driverId,
      p_amount: monto,
      p_bank_name: String(bankName || ''),
      p_id_doc: String(idDoc).trim(),
      p_phone: String(phone).trim()
    });
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw new Error(rpcErr.message || 'No se pudo procesar el retiro');
    }
    if (!rpcErr && rpcRes && rpcRes.success) {
      return {
        success: true,
        withdrawal: rpcRes.withdrawal,
        wallet: rpcRes.wallet
      };
    }
  } catch (err) {
    if (!isMissingRpcError(err)) throw err;
  }

  const { data: wallet, error: wErr } = await sb
    .from('delivery_wallets')
    .select('*')
    .eq('driver_id', driverId)
    .single();

  if (wErr || !wallet) throw new Error('Billetera de repartidor no encontrada.');

  const saldo = parseOptionalAmount(wallet.prepaid_balance, 0);
  if (monto > saldo) {
    throw new Error(`El monto solicitado ($${monto.toFixed(2)}) supera tu saldo disponible ($${saldo.toFixed(2)}).`);
  }

  const nuevoSaldo = parseFloat((saldo - monto).toFixed(2));
  const { data: wActualizada, error: errUp } = await sb
    .from('delivery_wallets')
    .update({ prepaid_balance: nuevoSaldo })
    .eq('driver_id', driverId)
    .select()
    .single();

  if (errUp) throw errUp;

  const { data: withdrawal, error: insErr } = await sb
    .from('driver_withdrawals')
    .insert([{
      driver_id: driverId,
      amount: monto,
      bank_name: bankName || null,
      id_doc: String(idDoc).trim(),
      phone: String(phone).trim(),
      status: 'pending'
    }])
    .select()
    .single();

  if (insErr) throw insErr;

  return {
    success: true,
    withdrawal,
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
export async function recibirEfectivoEnCajaAdmin({ driverId, montoRecibido, sb = supabase }) {
  if (!driverId || montoRecibido <= 0) throw new Error('Monto de entrega en caja inválido.');

  const { data: wallet, error } = await sb
    .from('delivery_wallets')
    .select('*')
    .eq('driver_id', driverId)
    .single();

  if (error || !wallet) throw new Error('Billetera del repartidor no encontrada.');

  const deudaActual = parseOptionalAmount(wallet.cash_debt, 0);
  const nuevaDeuda = Math.max(0, parseFloat((deudaActual - montoRecibido).toFixed(2)));
  const sigueBloqueado = nuevaDeuda >= TECHO_DEUDA_EFECTIVO;

  const { data: wActualizada, error: errUp } = await sb
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
    await sb.from('delivery_transactions').insert([{
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

