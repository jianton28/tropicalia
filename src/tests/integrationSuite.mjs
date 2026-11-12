/**
 * Suite de Pruebas de Integración y Simulación Multi-Rol End-to-End (crossCheck Integration)
 * Plataforma: Tropicalia CRB
 *
 * Valida la interacción coordinada, cálculos financieros, bloqueos contables y políticas RLS Zero-Trust
 * entre los cuatro roles del sistema usando los servicios reales del proyecto:
 *  1. Usuario / Cliente (Carrito, Turnstile anti-bot, Checkout, Idempotencia, Bot/Rate checks)
 *  2. Cocina / Restaurante (Aislamiento estricto por negocio, KDS, Inventario/Recetas, Cierre de caja sin duplicados)
 *  3. Delivery / Repartidor (Toma de carreras, Retención de flete en efectivo $7.75 - $1.75 = $6.00, Digitales, Retiros Pago Móvil)
 *  4. Administración (Aprobación de pagos digitales, Liquidación de restaurantes y "Liquidación de Repartidores", Matriz RLS Zero-Trust)
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TECHO_DEUDA_EFECTIVO,
  calcularNetoDeudaEfectivo,
  calcularMontoTotalEfectivo,
  validarAceptacionCarrera,
  procesarBalanceCompletado,
  amortizarDeudaConSaldo,
  solicitarRetiroDriver,
  recibirEfectivoEnCajaAdmin
} from '../services/paymentService.js';
import {
  descontarStockDeOrden,
  revertirStockDeOrden,
  cancelarOrdenConReversion
} from '../services/inventoryService.js';
import { securityService } from '../services/securityService.js';
import { toBs } from '../services/bcvService.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAILED: ${message}`);
    failed++;
  }
}

function approxEqual(a, b, eps = 0.005) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

/**
 * Simulador transaccional de Supabase + PostgreSQL RLS + Constraints + RPCs SECURITY DEFINER
 * Espejo fiel de supabase_schema.sql y supabase_rls_policies.sql
 */
function createSupabaseRlsSimulator(options = { rpcEnabled: true }) {
  const db = {
    app_admins: [],
    businesses: [],
    kitchen_profiles: [],
    restaurant_verifications: [],
    products: [],
    inventory_items: [],
    product_recipes: [],
    orders: [],
    kitchen_logs: [],
    driver_profiles: [],
    delivery_wallets: [],
    driver_withdrawals: [],
    delivery_transactions: [],
    cash_closures: [],
    security_audit_logs: []
  };

  let currentUser = null;
  let seqCounter = 0;
  let simulateMissingRpc = !options.rpcEnabled;

  function genId() {
    seqCounter += 1;
    return crypto.randomUUID();
  }

  function clone(obj) {
    return obj === null || obj === undefined ? obj : JSON.parse(JSON.stringify(obj));
  }

  // Espejo exacto de public.is_admin() en supabase_rls_policies.sql
  function isAdmin(user) {
    if (!user) return false;
    const email = (user.email || '').toLowerCase();
    return (
      db.app_admins.some(a => a.user_id === user.id) ||
      user.app_metadata?.role === 'admin' ||
      email.endsWith('@tropicalia.lat')
    );
  }

  // Espejo exacto de public.is_kitchen_owner(p_business_id)
  function isKitchenOwner(user, businessId) {
    if (!user || !businessId) return false;
    if (isAdmin(user)) return true;
    const ownsBusiness = db.businesses.some(b => b.id === businessId && b.owner_id === user.id);
    const inKitchenProfiles = db.kitchen_profiles.some(k => k.id === user.id && k.business_id === businessId);
    return ownsBusiness || inKitchenProfiles;
  }

  // Espejo exacto de public.is_driver()
  function isDriverRole(user) {
    if (!user) return false;
    return db.driver_profiles.some(d => d.id === user.id);
  }

  function checkRls(table, op, row, newRow = null) {
    const uid = currentUser?.id || null;
    if (isAdmin(currentUser)) return true;

    switch (table) {
      case 'businesses':
        if (op === 'SELECT') return row.is_active === true || row.owner_id === uid;
        if (op === 'INSERT') return uid !== null && (newRow.owner_id === uid || newRow.owner_id == null);
        if (op === 'UPDATE') return row.owner_id === uid;
        return false;

      case 'restaurant_verifications':
        if (op === 'SELECT') return isKitchenOwner(currentUser, row.business_id);
        if (op === 'INSERT') return isKitchenOwner(currentUser, newRow.business_id);
        return false;

      case 'products':
        if (op === 'SELECT') return row.is_available !== false || isKitchenOwner(currentUser, row.business_id);
        return isKitchenOwner(currentUser, (newRow || row).business_id);

      case 'inventory_items':
      case 'kitchen_logs':
        return isKitchenOwner(currentUser, (newRow || row).business_id);

      case 'product_recipes': {
        const prod = db.products.find(p => p.id === (newRow || row).product_id);
        return prod ? isKitchenOwner(currentUser, prod.business_id) : false;
      }

      case 'orders':
        if (op === 'SELECT') {
          if (!uid) return false;
          const isClient = row.customer_id === uid || row.client_id === uid;
          const isKitchen = isKitchenOwner(currentUser, row.business_id);
          const isDriver =
            isDriverRole(currentUser) &&
            row.delivery_type === 'delivery' &&
            (row.driver_id === uid ||
              (row.driver_id == null && ['pending', 'cooking', 'ready', 'on_the_way'].includes(row.status)));
          return isClient || isKitchen || isDriver;
        }
        if (op === 'INSERT') {
          if (!uid) return false;
          return (
            (newRow.customer_id === uid || newRow.client_id === uid) &&
            Number(newRow.total) > 0 &&
            Array.isArray(newRow.items) &&
            newRow.items.length > 0 &&
            String(newRow.customer_phone || '').trim().length > 0
          );
        }
        if (op === 'UPDATE') {
          if (!uid) return false;
          if (isKitchenOwner(currentUser, row.business_id)) {
            return isKitchenOwner(currentUser, newRow.business_id);
          }
          if (
            (row.customer_id === uid || row.client_id === uid) &&
            ['pending', 'pending_payment_verification'].includes(row.status)
          ) {
            return (
              (newRow.customer_id === uid || newRow.client_id === uid) &&
              ['pending', 'pending_payment_verification', 'cancelled'].includes(newRow.status)
            );
          }
          const driverUsing =
            isDriverRole(currentUser) &&
            row.delivery_type === 'delivery' &&
            (row.driver_id === uid ||
              (row.driver_id == null && ['pending', 'cooking', 'ready', 'on_the_way'].includes(row.status)));
          const driverWithCheck =
            isDriverRole(currentUser) &&
            newRow.delivery_type === 'delivery' &&
            (newRow.driver_id === uid ||
              (newRow.driver_id == null &&
                newRow.delivery_status === 'pending' &&
                ['pending', 'cooking', 'ready'].includes(newRow.status)));
          return driverUsing && driverWithCheck;
        }
        return false;

      case 'delivery_wallets':
        if (!uid) return false;
        if (op === 'SELECT') return row.driver_id === uid;
        if (op === 'INSERT') return newRow.driver_id === uid;
        return false; // Zero-Trust: driver nunca puede hacer UPDATE directo sobre delivery_wallets

      case 'driver_withdrawals':
        if (!uid) return false;
        if (op === 'SELECT') return row.driver_id === uid;
        if (op === 'INSERT') return newRow.driver_id === uid;
        return false;

      case 'delivery_transactions':
        if (!uid) return false;
        if (op === 'SELECT') return row.driver_id === uid;
        return false;

      case 'cash_closures':
        if (!uid) return false;
        if (op === 'SELECT') return isKitchenOwner(currentUser, row.business_id);
        if (op === 'INSERT') return isKitchenOwner(currentUser, newRow.business_id);
        return false;

      case 'security_audit_logs':
        if (op === 'INSERT') return true;
        return false;

      default:
        return false;
    }
  }

  function applyDefaults(table, payload) {
    const now = new Date().toISOString();
    const record = { id: payload.id || genId(), created_at: payload.created_at || now, ...clone(payload) };
    if (table === 'cash_closures' && !record.status) record.status = 'pending_settlement';
    if (table === 'driver_withdrawals' && !record.status) record.status = 'pending';
    if (table === 'orders' && !record.delivery_status) record.delivery_status = 'pending';
    return record;
  }

  function validateConstraints(table, record, isInsert = true) {
    if (table === 'cash_closures') {
      const activeStatuses = ['pending', 'pending_settlement'];
      if (activeStatuses.includes(record.status)) {
        const dup = db.cash_closures.find(
          c => c.id !== record.id && c.business_id === record.business_id && activeStatuses.includes(c.status)
        );
        if (dup) {
          return {
            code: '23505',
            message: 'duplicate key value violates unique constraint "idx_one_pending_closure_per_business"'
          };
        }
      }
    }
    if (table === 'orders' && record.idempotency_key) {
      const dup = db.orders.find(o => o.id !== record.id && o.idempotency_key === record.idempotency_key);
      if (dup) {
        return {
          code: '23505',
          message: 'duplicate key value violates unique constraint "orders_idempotency_key_key"'
        };
      }
    }
    if (table === 'delivery_wallets' && isInsert) {
      const dup = db.delivery_wallets.find(w => w.id !== record.id && w.driver_id === record.driver_id);
      if (dup) {
        return {
          code: '23505',
          message: 'duplicate key value violates unique constraint "delivery_wallets_driver_id_key"'
        };
      }
    }
    return null;
  }

  function makeQuery(table) {
    let op = 'SELECT';
    let payload = null;
    let filters = [];
    let orderBy = null;
    let limitCount = null;
    let returnSingle = null; // 'single' | 'maybeSingle'
    let wantSelectAfterWrite = false;

    const execute = async () => {
      if (!db[table]) {
        return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
      }

      if (op === 'INSERT') {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = [];
        for (const item of rows) {
          const rec = applyDefaults(table, item);
          if (!checkRls(table, 'INSERT', null, rec)) {
            return { data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${table}"` } };
          }
          const cErr = validateConstraints(table, rec, true);
          if (cErr) return { data: null, error: cErr };
          db[table].push(rec);
          inserted.push(clone(rec));
        }
        if (wantSelectAfterWrite) {
          if (returnSingle === 'single') return { data: inserted[0] || null, error: null };
          if (returnSingle === 'maybeSingle') return { data: inserted[0] || null, error: null };
          return { data: inserted, error: null };
        }
        return { data: null, error: null };
      }

      const matches = db[table].filter(row =>
        filters.every(f => {
          if (f.type === 'eq') return row[f.col] === f.val;
          if (f.type === 'in') return f.vals.includes(row[f.col]);
          return true;
        })
      );

      if (op === 'SELECT') {
        let visible = matches.filter(r => checkRls(table, 'SELECT', r)).map(clone);
        if (orderBy) {
          visible.sort((a, b) => {
            const av = a[orderBy.col];
            const bv = b[orderBy.col];
            if (av === bv) return 0;
            const cmp = av < bv ? -1 : 1;
            return orderBy.ascending ? cmp : -cmp;
          });
        }
        if (typeof limitCount === 'number') visible = visible.slice(0, limitCount);
        if (returnSingle === 'single') {
          if (visible.length !== 1) {
            return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
          }
          return { data: visible[0], error: null };
        }
        if (returnSingle === 'maybeSingle') {
          return { data: visible[0] || null, error: null };
        }
        return { data: visible, error: null };
      }

      if (op === 'UPDATE') {
        const updated = [];
        for (let i = 0; i < db[table].length; i++) {
          const row = db[table][i];
          const isMatch = filters.every(f => (f.type === 'eq' ? row[f.col] === f.val : f.vals.includes(row[f.col])));
          if (!isMatch) continue;
          const nextRow = { ...clone(row), ...clone(payload) };
          if (!checkRls(table, 'UPDATE', row, nextRow)) {
            return { data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${table}"` } };
          }
          const cErr = validateConstraints(table, nextRow, false);
          if (cErr) return { data: null, error: cErr };
          db[table][i] = nextRow;
          updated.push(clone(nextRow));
        }
        if (wantSelectAfterWrite) {
          if (returnSingle === 'single') return { data: updated[0] || null, error: updated[0] ? null : { code: 'PGRST116', message: 'No row updated' } };
          if (returnSingle === 'maybeSingle') return { data: updated[0] || null, error: null };
          return { data: updated, error: null };
        }
        return { data: updated, error: null };
      }

      return { data: null, error: null };
    };

    const builder = {
      select() {
        if (op === 'INSERT' || op === 'UPDATE') wantSelectAfterWrite = true;
        return builder;
      },
      insert(rows) {
        op = 'INSERT';
        payload = rows;
        return builder;
      },
      update(patch) {
        op = 'UPDATE';
        payload = patch;
        return builder;
      },
      eq(col, val) {
        filters.push({ type: 'eq', col, val });
        return builder;
      },
      in(col, vals) {
        filters.push({ type: 'in', col, vals });
        return builder;
      },
      order(col, opts = { ascending: true }) {
        orderBy = { col, ascending: opts.ascending !== false };
        return builder;
      },
      limit(n) {
        limitCount = n;
        return builder;
      },
      single() {
        returnSingle = 'single';
        return builder;
      },
      maybeSingle() {
        returnSingle = 'maybeSingle';
        return builder;
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      }
    };
    return builder;
  }

  async function rpc(fnName, params = {}) {
    if (simulateMissingRpc) {
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fnName} in the schema cache` } };
    }

    const uid = currentUser?.id || null;

    if (fnName === 'crear_pedido_seguro') {
      const p = params.p_order_payload || {};
      const key = params.p_idempotency_key;
      if (!uid) return { data: null, error: { message: 'UNAUTHORIZED' } };

      if (key) {
        const existing = db.orders.find(o => o.idempotency_key === key);
        if (existing) {
          db.security_audit_logs.push({
            id: genId(),
            event_type: 'ORDER_IDEMPOTENT_HIT',
            severity: 'info',
            details: { order_id: existing.id, idempotency_key: key },
            created_at: new Date().toISOString()
          });
          return { data: clone(existing), error: null };
        }
      }

      if (Number(p.total || 0) <= 0) {
        return { data: null, error: { message: 'INVALID_ORDER_TOTAL: El total debe ser mayor a 0.' } };
      }
      if (!p.customer_phone || String(p.customer_phone).trim().length < 7) {
        return { data: null, error: { message: 'INVALID_PHONE: Teléfono obligatorio.' } };
      }
      if (!Array.isArray(p.items) || p.items.length === 0) {
        return { data: null, error: { message: 'EMPTY_CART: Pedido vacío.' } };
      }
      if (p.bot_verified !== true) {
        return { data: null, error: { message: 'BOT_VERIFICATION_REQUIRED: Debes completar la verificación anti-bot.' } };
      }

      const newOrder = applyDefaults('orders', {
        business_id: p.business_id,
        customer_id: uid,
        customer_name: p.customer_name,
        customer_phone: p.customer_phone,
        delivery_type: p.delivery_type || 'delivery',
        delivery_address: p.delivery_address,
        map_url: p.map_url || null,
        notes: p.notes || null,
        payment_method: p.payment_method,
        payment_reference: p.payment_reference || null,
        payment_receipt_url: p.payment_receipt_url || null,
        items: p.items,
        subtotal_food: Number(p.subtotal_food ?? 0),
        delivery_fee: Number(p.delivery_fee ?? 0),
        driver_tip: Number(p.driver_tip ?? 0),
        total: Number(p.total),
        total_bs: Number(p.total_bs ?? 0),
        status: p.status || 'pending',
        idempotency_key: key || null,
        bot_verified: true
      });
      db.orders.push(newOrder);
      db.security_audit_logs.push({
        id: genId(),
        event_type: 'ORDER_CREATED_SECURE',
        severity: 'info',
        details: { order_id: newOrder.id, total: newOrder.total, idempotency_key: key },
        created_at: new Date().toISOString()
      });
      return { data: clone(newOrder), error: null };
    }

    if (fnName === 'procesar_balance_completado_seguro') {
      const { p_order_id, p_driver_id } = params;
      if (uid !== p_driver_id && !isAdmin(currentUser)) {
        return { data: null, error: { message: 'UNAUTHORIZED: No autorizado para liquidar la billetera de otro repartidor.' } };
      }
      const order = db.orders.find(o => o.id === p_order_id);
      if (!order) return { data: null, error: { message: 'ORDER_NOT_FOUND' } };
      if (order.driver_id && order.driver_id !== p_driver_id && !isAdmin(currentUser)) {
        return { data: null, error: { message: 'DRIVER_MISMATCH' } };
      }

      let wallet = db.delivery_wallets.find(w => w.driver_id === p_driver_id);
      if (!wallet) {
        wallet = applyDefaults('delivery_wallets', {
          driver_id: p_driver_id,
          prepaid_balance: 0,
          cash_debt: 0,
          debt_ceiling: 25,
          is_blocked: false
        });
        db.delivery_wallets.push(wallet);
      }

      const esEfectivo = ['efectivo', 'efectivo_bs'].includes(order.payment_method);
      const montoTotal = Number(order.total ?? 0);
      const fleteGanado = Number(order.delivery_fee ?? 0) + Number(order.driver_tip ?? 0);
      const subtotalFood = order.subtotal_food != null
        ? Number(order.subtotal_food)
        : Math.max(0, montoTotal - fleteGanado);

      if (esEfectivo) {
        const neto = Math.max(0, Number((montoTotal - fleteGanado).toFixed(2)));
        wallet.cash_debt = Number((Number(wallet.cash_debt) + neto).toFixed(2));
        wallet.is_blocked = wallet.cash_debt >= 25.00;

        db.delivery_transactions.push(
          applyDefaults('delivery_transactions', {
            driver_id: p_driver_id,
            order_id: p_order_id,
            amount: neto,
            type: 'cash_debt',
            notes: 'Cobro neto de comida a entregar en caja'
          }),
          applyDefaults('delivery_transactions', {
            driver_id: p_driver_id,
            order_id: p_order_id,
            amount: fleteGanado,
            type: 'delivery_fee_offset',
            notes: 'Flete retenido en efectivo por el repartidor'
          })
        );
      } else {
        wallet.prepaid_balance = Number((Number(wallet.prepaid_balance) + fleteGanado).toFixed(2));
        db.delivery_transactions.push(
          applyDefaults('delivery_transactions', {
            driver_id: p_driver_id,
            order_id: p_order_id,
            amount: fleteGanado,
            type: 'delivery_fee_credit',
            notes: 'Flete acreditado por pedido digital'
          })
        );
      }

      if (order.business_id && subtotalFood > 0) {
        const biz = db.businesses.find(b => b.id === order.business_id);
        if (biz) {
          biz.balance = Number((Number(biz.balance || 0) + subtotalFood * 0.90).toFixed(2));
          biz.total_sales = Number((Number(biz.total_sales || 0) + subtotalFood).toFixed(2));
        }
      }

      order.status = 'delivered';
      order.delivery_status = 'delivered';
      order.delivered_at = order.delivered_at || new Date().toISOString();

      db.security_audit_logs.push({
        id: genId(),
        event_type: 'FINANCIAL_SETTLEMENT_SUCCESS',
        severity: 'info',
        details: { order_id: p_order_id, driver_id: p_driver_id, cash_debt: wallet.cash_debt, prepaid_balance: wallet.prepaid_balance },
        created_at: new Date().toISOString()
      });

      return {
        data: {
          success: true,
          cash_debt: wallet.cash_debt,
          prepaid_balance: wallet.prepaid_balance,
          is_blocked: wallet.is_blocked
        },
        error: null
      };
    }

    if (fnName === 'increment_business_balance') {
      if (!uid) return { data: null, error: { message: 'UNAUTHORIZED' } };
      const biz = db.businesses.find(b => b.id === params.b_id);
      if (biz) {
        biz.balance = Number((Number(biz.balance || 0) + Number(params.amount || 0)).toFixed(2));
      }
      return { data: null, error: null };
    }

    if (fnName === 'amortizar_deuda_con_saldo_seguro') {
      const { p_driver_id, p_monto } = params;
      if (uid !== p_driver_id && !isAdmin(currentUser)) return { data: null, error: { message: 'UNAUTHORIZED' } };
      const wallet = db.delivery_wallets.find(w => w.driver_id === p_driver_id);
      if (!wallet) return { data: null, error: { message: 'WALLET_NOT_FOUND' } };
      const abono = Number(Math.min(wallet.prepaid_balance, wallet.cash_debt, p_monto).toFixed(2));
      if (abono <= 0) return { data: null, error: { message: 'INVALID_AMORTIZATION' } };
      wallet.prepaid_balance = Number((wallet.prepaid_balance - abono).toFixed(2));
      wallet.cash_debt = Number((wallet.cash_debt - abono).toFixed(2));
      wallet.is_blocked = wallet.cash_debt >= 25.00;
      db.delivery_transactions.push(
        applyDefaults('delivery_transactions', {
          driver_id: p_driver_id,
          amount: abono,
          type: 'debt_payment',
          notes: 'Amortización segura con saldo a favor'
        })
      );
      return { data: { success: true, abono_real: abono, wallet: clone(wallet) }, error: null };
    }

    if (fnName === 'solicitar_retiro_driver_seguro') {
      const { p_driver_id, p_amount, p_bank_name, p_id_doc, p_phone } = params;
      if (uid !== p_driver_id && !isAdmin(currentUser)) return { data: null, error: { message: 'UNAUTHORIZED' } };
      const monto = Number(Number(p_amount).toFixed(2));
      if (monto <= 0) return { data: null, error: { message: 'INVALID_AMOUNT' } };
      const wallet = db.delivery_wallets.find(w => w.driver_id === p_driver_id);
      if (!wallet) return { data: null, error: { message: 'WALLET_NOT_FOUND' } };
      if (monto > wallet.prepaid_balance) return { data: null, error: { message: 'INSUFFICIENT_BALANCE' } };

      wallet.prepaid_balance = Number((wallet.prepaid_balance - monto).toFixed(2));
      const withdrawal = applyDefaults('driver_withdrawals', {
        driver_id: p_driver_id,
        amount: monto,
        bank_name: p_bank_name,
        id_doc: p_id_doc,
        phone: p_phone,
        status: 'pending'
      });
      db.driver_withdrawals.push(withdrawal);
      db.delivery_transactions.push(
        applyDefaults('delivery_transactions', {
          driver_id: p_driver_id,
          amount: monto,
          type: 'withdrawal',
          notes: 'Solicitud de retiro Pago Móvil'
        })
      );
      return { data: { success: true, withdrawal: clone(withdrawal), wallet: clone(wallet) }, error: null };
    }

    return { data: null, error: { code: 'PGRST202', message: `Unknown RPC ${fnName}` } };
  }

  return {
    db,
    asUser(user) {
      currentUser = user;
      return this;
    },
    setRpcEnabled(flag) {
      simulateMissingRpc = !flag;
    },
    isAdminUser(user) {
      return isAdmin(user);
    },
    from(table) {
      return makeQuery(table);
    },
    rpc
  };
}

console.log('==================================================================');
console.log('TROPICALIA SUITE DE INTEGRACIÓN MULTI-ROL Y AUDITORÍA ZERO-TRUST');
console.log('==================================================================\n');

const sb = createSupabaseRlsSimulator({ rpcEnabled: true });

// Actores de prueba con UUIDs válidos
const USERS = {
  client1: { id: crypto.randomUUID(), email: 'maria.cliente@gmail.com', app_metadata: {}, user_metadata: { role: 'client' } },
  client2: { id: crypto.randomUUID(), email: 'pedro.cliente@gmail.com', app_metadata: {}, user_metadata: { role: 'client' } },
  ownerA: { id: crypto.randomUUID(), email: 'chef.burger@restaurantes.com', app_metadata: {}, user_metadata: { role: 'restaurant' } },
  ownerB: { id: crypto.randomUUID(), email: 'chef.sushi@restaurantes.com', app_metadata: {}, user_metadata: { role: 'restaurant' } },
  driver1: { id: crypto.randomUUID(), email: 'carlos.moto@delivery.com', app_metadata: {}, user_metadata: { role: 'delivery' } },
  driver2: { id: crypto.randomUUID(), email: 'luis.moto@delivery.com', app_metadata: {}, user_metadata: { role: 'delivery' } },
  admin: { id: crypto.randomUUID(), email: 'operaciones@tropicalia.lat', app_metadata: { role: 'admin' }, user_metadata: {} },
  attacker: { id: crypto.randomUUID(), email: 'testadmin@gmail.com', app_metadata: {}, user_metadata: { role: 'admin' } }
};

const BIZ_BURGER = crypto.randomUUID();
const BIZ_SUSHI = crypto.randomUUID();
const PROD_BURGER = crypto.randomUUID();
const PROD_PIZZA = crypto.randomUUID();
const ING_PAN = crypto.randomUUID();
const ING_CARNE = crypto.randomUUID();
const ING_QUESO = crypto.randomUUID();

// Sembrado administrativo inicial en Supabase
sb.asUser(USERS.admin);
sb.db.app_admins.push({ user_id: USERS.admin.id, role: 'superadmin' });
sb.db.businesses.push(
  { id: BIZ_BURGER, name: 'Burger & Grill Tropicalia', category: 'Hamburguesas', owner_id: USERS.ownerA.id, is_active: true, balance: 0, total_sales: 0 },
  { id: BIZ_SUSHI, name: 'Tokyo Sushi House', category: 'Sushi', owner_id: USERS.ownerB.id, is_active: true, balance: 0, total_sales: 0 }
);
sb.db.kitchen_profiles.push(
  { id: USERS.ownerA.id, user_id: USERS.ownerA.id, business_id: BIZ_BURGER, kitchen_name: 'Burger & Grill KDS' },
  { id: USERS.ownerB.id, user_id: USERS.ownerB.id, business_id: BIZ_SUSHI, kitchen_name: 'Tokyo Sushi KDS' }
);
sb.db.products.push(
  { id: PROD_BURGER, business_id: BIZ_BURGER, name: 'Hamburguesa Clásica', price: 6.00, category: 'Hamburguesas', is_available: true },
  { id: PROD_PIZZA, business_id: BIZ_BURGER, name: 'Pizza Margarita', price: 10.00, category: 'Pizzas', is_available: true }
);
sb.db.inventory_items.push(
  { id: ING_PAN, business_id: BIZ_BURGER, name: 'Pan Brioche', quantity: 10, unit: 'u' },
  { id: ING_CARNE, business_id: BIZ_BURGER, name: 'Carne Smash 150g', quantity: 10, unit: 'u' },
  { id: ING_QUESO, business_id: BIZ_BURGER, name: 'Queso Cheddar', quantity: 10, unit: 'lonjas' }
);
sb.db.product_recipes.push(
  { id: crypto.randomUUID(), product_id: PROD_BURGER, inventory_item_id: ING_PAN, quantity_required: 2 },
  { id: crypto.randomUUID(), product_id: PROD_BURGER, inventory_item_id: ING_CARNE, quantity_required: 1 },
  { id: crypto.randomUUID(), product_id: PROD_BURGER, inventory_item_id: ING_QUESO, quantity_required: 1 }
);
sb.db.driver_profiles.push(
  { id: USERS.driver1.id, full_name: 'Carlos Mendoza', phone: '04141112233', vehicle_type: 'moto', is_online: true },
  { id: USERS.driver2.id, full_name: 'Luis Pérez', phone: '04124445566', vehicle_type: 'moto', is_online: true }
);
sb.db.delivery_wallets.push(
  { id: crypto.randomUUID(), driver_id: USERS.driver1.id, prepaid_balance: 0, cash_debt: 0, debt_ceiling: TECHO_DEUDA_EFECTIVO, is_blocked: false },
  { id: crypto.randomUUID(), driver_id: USERS.driver2.id, prepaid_balance: 0, cash_debt: 0, debt_ceiling: TECHO_DEUDA_EFECTIVO, is_blocked: false }
);

// ==============================================================================
// FASE 1: ROL CLIENTE / USUARIO (CARRITO, TURNSTILE ANTI-BOT, CHECKOUT E IDEMPOTENCIA)
// ==============================================================================
console.log('=== FASE 1: ROL USUARIO / CLIENTE (CHECKOUT ZERO-TRUST) ===');
sb.asUser(USERS.client1);

const idempotencyCash = securityService.generateIdempotencyKey();
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyCash), 'Cliente genera idempotency_key UUID v4 válida para la sesión de compra');

// 1.1 Intentar crear pedido sin validación Turnstile (bot_verified = false) debe fallar en servidor
const { error: errBotBlocked } = await sb.rpc('crear_pedido_seguro', {
  p_idempotency_key: securityService.generateIdempotencyKey(),
  p_order_payload: {
    business_id: BIZ_BURGER,
    customer_name: 'Bot Malicioso',
    customer_phone: '04149998877',
    delivery_type: 'delivery',
    delivery_address: 'Calle Falsa 123',
    payment_method: 'efectivo',
    items: [{ id: PROD_BURGER, product_id: PROD_BURGER, name: 'Hamburguesa Clásica', price: 6.00, quantity: 1 }],
    subtotal_food: 6.00,
    delivery_fee: 1.75,
    driver_tip: 0,
    total: 7.75,
    bot_verified: false
  }
});
assert(errBotBlocked && errBotBlocked.message.includes('BOT_VERIFICATION_REQUIRED'), 'RPC crear_pedido_seguro bloquea órdenes sin bot_verified = true');

// 1.2 Registro legítimo de orden Delivery en Efectivo ($6.00 comida + $1.75 flete = $7.75 total)
const payloadOrdenEfectivo = {
  business_id: BIZ_BURGER,
  customer_name: securityService.sanitizeInput('María Rodríguez'),
  customer_phone: '04141352503',
  delivery_type: 'delivery',
  delivery_address: 'Av. Bolívar Norte, Res. Palma Real (~2.4 km)',
  map_url: 'https://www.google.com/maps?q=10.48,-66.90',
  notes: '[Pago con: Billete $10]',
  payment_method: 'efectivo',
  payment_reference: 'EFECTIVO (Billete $10)',
  items: [{ id: PROD_BURGER, product_id: PROD_BURGER, name: 'Hamburguesa Clásica', price: 6.00, quantity: 1 }],
  subtotal_food: 6.00,
  delivery_fee: 1.75,
  driver_tip: 0.00,
  total: 7.75,
  total_bs: toBs(7.75, 800),
  status: 'pending',
  idempotency_key: idempotencyCash,
  bot_verified: true
};

const { data: ordenEfectivo, error: errOrdCash } = await sb.rpc('crear_pedido_seguro', {
  p_idempotency_key: idempotencyCash,
  p_order_payload: payloadOrdenEfectivo
});
assert(!errOrdCash && ordenEfectivo?.id, 'Orden delivery efectivo ($7.75) registrada vía RPC crear_pedido_seguro');
assert(ordenEfectivo.bot_verified === true, 'Campo bot_verified guardado como true en tabla orders');
assert(ordenEfectivo.idempotency_key === idempotencyCash, 'Campo idempotency_key guardado exactamente en tabla orders');
assert(ordenEfectivo.customer_id === USERS.client1.id, 'customer_id fijado al auth.uid() real del cliente');

// 1.3 Reintento idempotente con la misma clave no duplica la orden
const countAntesReintento = sb.db.orders.length;
const { data: ordenReintento } = await sb.rpc('crear_pedido_seguro', {
  p_idempotency_key: idempotencyCash,
  p_order_payload: payloadOrdenEfectivo
});
assert(sb.db.orders.length === countAntesReintento, 'Reintento con idempotency_key repetida NO duplica la orden');
assert(ordenReintento.id === ordenEfectivo.id, 'Reintento idempotente retorna el mismo ID de orden existente');

// 1.4 Cliente emite una segunda orden por Pago Móvil ($10.00 comida + $2.50 flete = $12.50) -> inicia en pending_payment_verification
const { data: ordenDigital } = await sb.rpc('crear_pedido_seguro', {
  p_idempotency_key: securityService.generateIdempotencyKey(),
  p_order_payload: {
    business_id: BIZ_BURGER,
    customer_name: 'María Rodríguez',
    customer_phone: '04141352503',
    delivery_type: 'delivery',
    delivery_address: 'Av. Bolívar Norte (~3.1 km)',
    payment_method: 'pago_movil',
    payment_reference: '998122 (Banesco - 04141352503)',
    items: [{ id: PROD_PIZZA, product_id: PROD_PIZZA, name: 'Pizza Margarita', price: 10.00, quantity: 1 }],
    subtotal_food: 10.00,
    delivery_fee: 2.50,
    driver_tip: 0,
    total: 12.50,
    total_bs: toBs(12.50, 800),
    status: 'pending_payment_verification',
    bot_verified: true
  }
});
assert(ordenDigital?.status === 'pending_payment_verification', 'Orden Pago Móvil inicia en pending_payment_verification hasta validación Admin');

// 1.5 Cliente emite orden Pickup de $0 flete para probar no-coerción y reversión/cancelación posterior
const { data: ordenPickupCancelar } = await sb.rpc('crear_pedido_seguro', {
  p_idempotency_key: securityService.generateIdempotencyKey(),
  p_order_payload: {
    business_id: BIZ_BURGER,
    customer_name: 'María Rodríguez',
    customer_phone: '04141352503',
    delivery_type: 'pickup',
    delivery_address: 'Retiro en local (Pickup)',
    payment_method: 'efectivo',
    items: [{ id: PROD_BURGER, product_id: PROD_BURGER, name: 'Hamburguesa Clásica', price: 6.00, quantity: 1 }],
    subtotal_food: 6.00,
    delivery_fee: 0,
    driver_tip: 0,
    total: 6.00,
    status: 'pending',
    bot_verified: true
  }
});
assert(ordenPickupCancelar?.delivery_type === 'pickup', 'Orden Pickup registrada con delivery_fee = 0');

// ==============================================================================
// FASE 2: ROL COCINA / KDS (AISLAMIENTO POR NEGOCIO, INVENTARIO Y ESTADOS)
// ==============================================================================
console.log('\n=== FASE 2: ROL COCINA / RESTAURANTE (KDS, STOCK E AISLAMIENTO) ===');

// 2.1 Aislamiento estricto: Otra cocina (Tokyo Sushi / ownerB) y otro cliente (client2) NO ven órdenes activas de Burger & Grill
sb.asUser(USERS.ownerB);
const { data: pedidosAjenos } = await sb.from('orders').select('*').eq('business_id', BIZ_BURGER);
assert(Array.isArray(pedidosAjenos) && pedidosAjenos.length === 0, 'RLS Aislamiento KDS: Cocina Sushi recibe 0 órdenes de Cocina Burger (incluso deliveries sin asignar)');

sb.asUser(USERS.client2);
const { data: pedidosActivosPorOtroCliente } = await sb.from('orders').select('*').eq('customer_id', USERS.client1.id);
assert(Array.isArray(pedidosActivosPorOtroCliente) && pedidosActivosPorOtroCliente.length === 0, 'RLS Aislamiento Clientes: Cliente 2 recibe 0 órdenes activas sin asignar de Cliente 1');

sb.asUser(USERS.ownerB);

const { data: inventarioAjeno } = await sb.from('inventory_items').select('*').eq('business_id', BIZ_BURGER);
assert(Array.isArray(inventarioAjeno) && inventarioAjeno.length === 0, 'RLS Aislamiento KDS: Cocina Sushi NO puede leer insumos de Cocina Burger');

const { error: errSabotajeCocina } = await sb.from('orders').update({ status: 'cancelled' }).eq('id', ordenEfectivo.id);
assert(Boolean(errSabotajeCocina), 'RLS Aislamiento KDS: Cocina Sushi tiene BLOQUEADO modificar órdenes de Burger');

// 2.2 Cocina dueña (ownerA) sí opera su propio panel KDS
sb.asUser(USERS.ownerA);
const { data: comandasPropias } = await sb.from('orders').select('*').eq('business_id', BIZ_BURGER);
assert(comandasPropias.length === 3, 'Cocina Burger visualiza sus 3 órdenes propias exclusivamente');

// Verificar que Cocina NO inicia orden Pago Móvil sin aprobación administrativa previa
const { data: checkDigitalStatus } = await sb.from('orders').select('status').eq('id', ordenDigital.id).single();
assert(checkDigitalStatus.status === 'pending_payment_verification', 'Orden Pago Móvil permanece retenida en pending_payment_verification antes del visto bueno Admin');

// Transición pending -> cooking con descuento de insumos según receta
await descontarStockDeOrden(ordenEfectivo, sb);
const { error: errCooking } = await sb.from('orders').update({ status: 'cooking' }).eq('id', ordenEfectivo.id);
assert(!errCooking, 'Cocina avanza orden efectivo de pending a cooking');

const { data: stockTrasCocinar } = await sb.from('inventory_items').select('*').eq('business_id', BIZ_BURGER);
const panStock = stockTrasCocinar.find(i => i.id === ING_PAN).quantity;
const carneStock = stockTrasCocinar.find(i => i.id === ING_CARNE).quantity;
const quesoStock = stockTrasCocinar.find(i => i.id === ING_QUESO).quantity;
assert(panStock === 8 && carneStock === 9 && quesoStock === 9, `Receta descontada correctamente (Pan=8, Carne=9, Queso=9; obtenido ${panStock}/${carneStock}/${quesoStock})`);

// Probar cancelación con reversión automática de insumos sobre ordenPickupCancelar tras descontar
await descontarStockDeOrden(ordenPickupCancelar, sb);
await sb.from('orders').update({ status: 'cooking' }).eq('id', ordenPickupCancelar.id);
const resCancel = await cancelarOrdenConReversion(ordenPickupCancelar.id, 'Cliente solicitó cancelar', 'cocina', sb);
const { data: stockTrasRevertir } = await sb.from('inventory_items').select('*').eq('business_id', BIZ_BURGER);
assert(
  resCancel.success === true && stockTrasRevertir.find(i => i.id === ING_PAN).quantity === 8,
  'cancelarOrdenConReversion restaura exactamente los ingredientes descontados y marca cancelled'
);

// Transición cooking -> ready
const { error: errReady } = await sb.from('orders').update({ status: 'ready' }).eq('id', ordenEfectivo.id);
const { data: ordLista } = await sb.from('orders').select('*').eq('id', ordenEfectivo.id).single();
assert(!errReady && ordLista.status === 'ready', 'Cocina avanza orden efectivo de cooking a ready');

// ==============================================================================
// FASE 3: ROL DELIVERY / REPARTIDOR (TOMA, FLETE $7.75 - $1.75 = $6.00, FALLBACK Y RLS)
// ==============================================================================
console.log('\n=== FASE 3: ROL DELIVERY / REPARTIDOR (FINANZAS Y CARRERAS) ===');
sb.asUser(USERS.driver1);

// 3.1 Repartidor NO ve órdenes pickup canceladas/no-delivery bajo RLS
const { data: carrerasVisibles } = await sb.from('orders').select('*');
assert(
  carrerasVisibles.some(o => o.id === ordenEfectivo.id) && !carrerasVisibles.some(o => o.delivery_type === 'pickup'),
  'RLS Delivery: Repartidor ve delivery ready sin asignar y NO ve órdenes pickup'
);

// 3.2 Toma de carrera por driver1 + prueba de liberación antes de retirar comida + retoma
const { error: errAccept } = await sb.from('orders').update({
  driver_id: USERS.driver1.id,
  delivery_status: 'accepted',
  delivery_code: '4821'
}).eq('id', ordenEfectivo.id);
assert(!errAccept, 'Repartidor acepta carrera ready asignándose driver_id');

// Aislamiento entre repartidores: driver2 NO puede ver ni secuestrar la carrera tomada por driver1
sb.asUser(USERS.driver2);
const { data: carreraAjenaDriver2 } = await sb.from('orders').select('*').eq('id', ordenEfectivo.id);
assert(carreraAjenaDriver2.length === 0, 'RLS Delivery: Repartidor 2 NO puede ver carrera ya asignada al Repartidor 1');
const { error: errHijack } = await sb.from('orders').update({ driver_id: USERS.driver2.id }).eq('id', ordenEfectivo.id);
assert(errHijack || sb.db.orders.find(o => o.id === ordenEfectivo.id).driver_id === USERS.driver1.id, 'RLS Delivery: Repartidor 2 NO puede robar orden asignada a Repartidor 1');

// Verificar fix de orders_driver_update: driver1 puede liberar orden ready antes de retirarla y volver a tomarla
sb.asUser(USERS.driver1);
const { error: errRelease } = await sb.from('orders').update({
  driver_id: null,
  delivery_status: 'pending'
}).eq('id', ordenEfectivo.id);
assert(!errRelease, 'RLS orders_driver_update corregida permite liberar carrera (driver_id = null) antes de retirar comida');

await sb.from('orders').update({
  driver_id: USERS.driver1.id,
  delivery_status: 'accepted',
  delivery_code: '4821'
}).eq('id', ordenEfectivo.id);

// 3.3 Avance en ruta: at_restaurant -> on_the_way -> entrega y liquidación financiera ($7.75 efectivo / $1.75 flete)
await sb.from('orders').update({ delivery_status: 'at_restaurant' }).eq('id', ordenEfectivo.id);
await sb.from('orders').update({ delivery_status: 'on_the_way', status: 'on_the_way' }).eq('id', ordenEfectivo.id);

const { data: walletAntesCash } = await sb.from('delivery_wallets').select('*').eq('driver_id', USERS.driver1.id).single();
const validacionCash = validarAceptacionCarrera({ orden: ordLista, wallet: walletAntesCash });
assert(validacionCash.permitido === true, 'Repartidor con $0 de deuda está habilitado para entregar orden en efectivo');

// Simular flujo exacto de Delivery.jsx: update delivered + procesarBalanceCompletado (vía RPC SECURITY DEFINER)
await sb.from('orders').update({
  delivery_status: 'delivered',
  status: 'delivered',
  delivered_at: new Date().toISOString()
}).eq('id', ordenEfectivo.id);

const resEfectivoRpc = await procesarBalanceCompletado({
  orden: { ...ordLista, total: 7.75, subtotal_food: 6.00, delivery_fee: 1.75, driver_tip: 0, payment_method: 'efectivo' },
  driverId: USERS.driver1.id,
  sb
});

assert(
  resEfectivoRpc.success === true &&
  resEfectivoRpc.exito === true &&
  resEfectivoRpc.esEfectivo === true &&
  approxEqual(resEfectivoRpc.fleteGanado, 1.75),
  'procesarBalanceCompletado retorna contrato unificado (success, exito, esEfectivo, fleteGanado=1.75)'
);

const { data: walletTrasCash } = await sb.from('delivery_wallets').select('*').eq('driver_id', USERS.driver1.id).single();
assert(
  approxEqual(walletTrasCash.cash_debt, 6.00),
  `Cálculo exacto efectivo: Total $7.75 - Flete $1.75 => Deuda neta en calle = $${walletTrasCash.cash_debt.toFixed(2)} ($6.00 esperado)`
);
assert(
  approxEqual(walletTrasCash.prepaid_balance, 0.00),
  `Flete en efectivo retenido en bolsillo NO duplica abono digital (prepaid_balance = $${walletTrasCash.prepaid_balance.toFixed(2)})`
);

const { data: txsDriver1 } = await sb.from('delivery_transactions').select('*').eq('driver_id', USERS.driver1.id);
assert(
  txsDriver1.some(t => t.type === 'cash_debt' && approxEqual(t.amount, 6.00)) &&
  txsDriver1.some(t => t.type === 'delivery_fee_offset' && approxEqual(t.amount, 1.75)),
  'Auditoría delivery_transactions registra cash_debt ($6.00) y delivery_fee_offset ($1.75)'
);

// ==============================================================================
// FASE 4: ROL ADMINISTRACIÓN (VALIDACIÓN DIGITAL, REPARTIDORES, RESTAURANTES Y CIERRES)
// ==============================================================================
console.log('\n=== FASE 4: ROL ADMIN, APROBACIÓN DIGITAL Y CIERRES DE CAJA SIN DUPLICADOS ===');

// 4.1 Admin valida pago Pago Móvil de ordenDigital -> pasa a 'pending' para Cocina
sb.asUser(USERS.admin);
const { error: errApprovePay } = await sb.from('orders').update({ status: 'pending' }).eq('id', ordenDigital.id);
assert(!errApprovePay, 'Admin aprueba pago Pago Móvil pasando la orden a estado pending');

// Cocina Burger prepara y despacha ordenDigital ($10 comida + $2.50 flete)
sb.asUser(USERS.ownerA);
await sb.from('orders').update({ status: 'cooking' }).eq('id', ordenDigital.id);
await sb.from('orders').update({ status: 'ready' }).eq('id', ordenDigital.id);

// Driver 1 entrega ordenDigital
sb.asUser(USERS.driver1);
await sb.from('orders').update({ driver_id: USERS.driver1.id, delivery_status: 'on_the_way', status: 'on_the_way' }).eq('id', ordenDigital.id);
const resDigital = await procesarBalanceCompletado({
  orden: { ...ordenDigital, driver_id: USERS.driver1.id },
  driverId: USERS.driver1.id,
  sb
});
assert(
  resDigital.esEfectivo === false && resDigital.esPagoMovil === true && approxEqual(resDigital.wallet.prepaid_balance, 2.50),
  `Entrega digital ($2.50 flete) acredita saldo a favor sin alterar cash_debt ($6.00) -> saldo $${resDigital.wallet.prepaid_balance.toFixed(2)}`
);

// 4.2 Verificación de balance de restaurante tras 2 órdenes ($6 + $10 = $16 comida * 90% = $14.40) y SIN cash_closure prematuro
const bizBurgerAfter2 = sb.db.businesses.find(b => b.id === BIZ_BURGER);
assert(
  approxEqual(bizBurgerAfter2.balance, 14.40),
  `Balance neto del restaurante = $14.40 (90% de $16.00 comida, excluyendo fletes)`
);
sb.asUser(USERS.ownerA);
const { data: cierresAntesSolicitud } = await sb.from('cash_closures').select('*').eq('business_id', BIZ_BURGER);
assert(
  cierresAntesSolicitud.length === 0,
  'procesarBalanceCompletado NO inserta cash_closures prematuros que bloqueen al restaurante antes de cerrar turno'
);

// 4.3 Cocina solicita Cierre de Caja #1 -> Admin verifica que 'pending_settlement' y 'pending' bloquean duplicados
const { data: cierre1, error: errCierre1 } = await sb.from('cash_closures').insert([{
  business_id: BIZ_BURGER,
  gross_amount: 16.00,
  commission_amount: 1.60,
  net_amount: 14.40,
  status: 'pending_settlement'
}]).select().single();
assert(!errCierre1 && cierre1?.status === 'pending_settlement', 'Cocina crea solicitud única de cierre de caja #1 ($14.40 neto)');

// Intentar insertar segundo cierre mientras existe pending_settlement debe fallar por índice UNIQUE idx_one_pending_closure_per_business
const { error: errDupCierre } = await sb.from('cash_closures').insert([{
  business_id: BIZ_BURGER,
  gross_amount: 16.00,
  commission_amount: 1.60,
  net_amount: 14.40,
  status: 'pending'
}]);
assert(
  Boolean(errDupCierre) && errDupCierre.code === '23505',
  'Restricción de base de datos (23505) bloquea envíos duplicados de cierre de caja cuando hay status IN (pending, pending_settlement)'
);

// Admin liquida el cierre #1 (simula click de liquidarCorte en Admin.jsx)
sb.asUser(USERS.admin);
const cierre1Ts = cierre1.created_at;
const { error: errSettled } = await sb.from('cash_closures').update({
  status: 'settled',
  settled_at: new Date().toISOString()
}).eq('id', cierre1.id).in('status', ['pending', 'pending_settlement']);
assert(!errSettled, 'Admin marca Cierre de Caja #1 como settled');

// Simular orden #3 entregada el MISMO DÍA después de cerrar turno #1 -> nuevo corte NO debe re-sumar los $16 previos
const laterTs = new Date(new Date(cierre1Ts).getTime() + 5000).toISOString();
sb.db.orders.push({
  id: crypto.randomUUID(),
  business_id: BIZ_BURGER,
  customer_id: USERS.client2.id,
  customer_phone: '04125551122',
  delivery_type: 'delivery',
  payment_method: 'pago_movil',
  items: [{ id: PROD_BURGER, name: 'Hamburguesa Clásica', price: 6.00, quantity: 1 }],
  subtotal_food: 6.00,
  delivery_fee: 2.00,
  total: 8.00,
  status: 'delivered',
  delivered_at: laterTs,
  created_at: laterTs
});

// Reproducir cálculo exacto de Cocina.jsx solicitarCorteCaja()
sb.asUser(USERS.ownerA);
const hoyInicio = new Date();
hoyInicio.setHours(0, 0, 0, 0);
const { data: ultimoLiq } = await sb.from('cash_closures')
  .select('id, created_at, settled_at')
  .eq('business_id', BIZ_BURGER)
  .eq('status', 'settled')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
const fechaCortePrevio = ultimoLiq?.created_at ? new Date(ultimoLiq.created_at) : null;
const tieneCorteHoy = fechaCortePrevio && fechaCortePrevio > hoyInicio;
const { data: todasComandas } = await sb.from('orders').select('*').eq('business_id', BIZ_BURGER);
const elegiblesTurno2 = todasComandas.filter(o => {
  if (o.status !== 'delivered') return false;
  const fechaOrden = new Date(o.delivered_at || o.created_at);
  return tieneCorteHoy ? fechaOrden > fechaCortePrevio : fechaOrden >= hoyInicio;
});
const brutoTurno2 = Number(elegiblesTurno2.reduce((acc, o) => acc + Number(o.subtotal_food ?? 0), 0).toFixed(2));
assert(
  approxEqual(brutoTurno2, 6.00),
  `Prevención de doble conteo mismo día: Turno #2 suma solo $6.00 nuevos tras corte liquidado (obtenido $${brutoTurno2.toFixed(2)})`
);

const { error: errCierre2 } = await sb.from('cash_closures').insert([{
  business_id: BIZ_BURGER,
  gross_amount: brutoTurno2,
  commission_amount: 0.60,
  net_amount: 5.40,
  status: 'pending'
}]);
assert(!errCierre2, 'Cocina puede abrir Cierre de Caja #2 limpio tras liquidarse el primero (incluye compatibilidad status = pending)');

// Admin valida KPI cortes contemplando tanto 'pending' como 'pending_settlement'
sb.asUser(USERS.admin);
const { data: allClosures } = await sb.from('cash_closures').select('*');
const pendingClosuresCount = allClosures.filter(c => ['pending', 'pending_settlement'].includes(c.status)).length;
assert(pendingClosuresCount === 1, 'Admin KPI y tabla reconocen status = pending y pending_settlement uniformemente');

// ==============================================================================
// FASE 5: LIQUIDACIÓN DE REPARTIDORES (TECHO $25, RETIRO PAGO MÓVIL, RECHAZO SIN DOBLE REEMBOLSO Y CAJA)
// ==============================================================================
console.log('\n=== FASE 5: LIQUIDACIÓN DE REPARTIDORES, TECHO $25 Y FALLBACK NO-RPC ===');

// 5.1 Driver 1 recibe orden en efectivo grande que eleva deuda sobre $25 -> bloqueo automático
sb.asUser(USERS.driver1);
const ordTecho = {
  id: crypto.randomUUID(),
  business_id: BIZ_BURGER,
  driver_id: USERS.driver1.id,
  delivery_type: 'delivery',
  payment_method: 'efectivo',
  subtotal_food: 23.00,
  delivery_fee: 2.00,
  driver_tip: 0,
  total: 25.00,
  status: 'on_the_way'
};
sb.db.orders.push(ordTecho);

const resTecho = await procesarBalanceCompletado({ orden: ordTecho, driverId: USERS.driver1.id, sb });
assert(
  approxEqual(resTecho.wallet.cash_debt, 29.00) && resTecho.wallet.is_blocked === true,
  `Deuda acumulada supera techo ($6.00 + $23.00 = $29.00 >= $25.00) => is_blocked = true`
);

const blkCash = validarAceptacionCarrera({ orden: { payment_method: 'efectivo', total: 8 }, wallet: resTecho.wallet });
const blkDigital = validarAceptacionCarrera({ orden: { payment_method: 'pago_movil', total: 8 }, wallet: resTecho.wallet });
assert(blkCash.permitido === false && blkDigital.permitido === true, 'Repartidor bloqueado NO puede aceptar efectivo pero SÍ carreras digitales');

// 5.2 Driver 1 amortiza deuda con sus $2.50 de saldo digital (vía RPC Zero-Trust)
const resAmort = await amortizarDeudaConSaldo({ driverId: USERS.driver1.id, montoAbono: 2.50, sb });
assert(
  approxEqual(resAmort.abonoReal, 2.50) &&
  approxEqual(resAmort.wallet.prepaid_balance, 0.00) &&
  approxEqual(resAmort.wallet.cash_debt, 26.50),
  'amortizarDeudaConSaldo reduce cash_debt ($29 -> $26.50) y debita prepaid_balance ($2.50 -> $0.00) bajo RLS'
);

// Simular ganancia digital nueva para Driver 1 (+$8.00 flete) y solicitar Retiro Pago Móvil ($5.00)
const ordDigitalExtra = {
  id: crypto.randomUUID(),
  business_id: BIZ_BURGER,
  driver_id: USERS.driver1.id,
  delivery_type: 'delivery',
  payment_method: 'pago_movil',
  subtotal_food: 20.00,
  delivery_fee: 8.00,
  driver_tip: 0,
  total: 28.00,
  status: 'on_the_way'
};
sb.db.orders.push(ordDigitalExtra);
await procesarBalanceCompletado({ orden: ordDigitalExtra, driverId: USERS.driver1.id, sb });

const resRetiro = await solicitarRetiroDriver({
  driverId: USERS.driver1.id,
  amount: 5.00,
  bankName: '0134 - Banesco',
  idDoc: 'V-20123456',
  phone: '04141112233',
  sb
});
assert(
  resRetiro.success === true &&
  resRetiro.withdrawal.status === 'pending' &&
  approxEqual(resRetiro.wallet.prepaid_balance, 3.00),
  'solicitarRetiroDriver descuenta $5.00 del saldo ($8.00 -> $3.00) y registra driver_withdrawals (pending) bajo RLS'
);

// Solicitud 2 de $2.00 para probar rechazo + candado optimista anti doble-reintegro en Admin
const resRetiro2 = await solicitarRetiroDriver({
  driverId: USERS.driver1.id,
  amount: 2.00,
  bankName: '0134 - Banesco',
  idDoc: 'V-20123456',
  phone: '04141112233',
  sb
});

// Admin liquida Retiro #1 con referencia PM-123456
sb.asUser(USERS.admin);
const { error: errLiqDriver } = await sb.from('driver_withdrawals')
  .update({ status: 'settled', settlement_reference: 'PM-123456' })
  .eq('id', resRetiro.withdrawal.id)
  .eq('status', 'pending');
assert(!errLiqDriver, 'Admin liquida retiro Pago Móvil #1 con referencia PM-123456');

// Admin rechaza Retiro #2 (con candado .eq('status', 'pending') de Admin.jsx) y simula segundo clic accidental
async function simularRechazoOptimista(retiro) {
  const { data: locked } = await sb.from('driver_withdrawals')
    .update({ status: 'rejected' })
    .eq('id', retiro.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (!locked) return false;
  const { data: w } = await sb.from('delivery_wallets').select('prepaid_balance').eq('driver_id', retiro.driver_id).single();
  await sb.from('delivery_wallets').update({
    prepaid_balance: Number((w.prepaid_balance + retiro.amount).toFixed(2))
  }).eq('driver_id', retiro.driver_id);
  return true;
}
const primerRechazo = await simularRechazoOptimista(resRetiro2.withdrawal);
const segundoRechazo = await simularRechazoOptimista(resRetiro2.withdrawal);
const walletTrasRechazo = sb.db.delivery_wallets.find(w => w.driver_id === USERS.driver1.id);
assert(
  primerRechazo === true && segundoRechazo === false && approxEqual(walletTrasRechazo.prepaid_balance, 3.00),
  'Admin rechaza retiro reintegrando $2.00 una sola vez (doble clic bloqueado por candado status = pending)'
);

// Admin recibe efectivo en caja física ($26.50) => deuda en $0.00 e is_blocked = false
const resCajaAdmin = await recibirEfectivoEnCajaAdmin({ driverId: USERS.driver1.id, montoRecibido: 26.50, sb });
assert(
  resCajaAdmin.success === true &&
  approxEqual(resCajaAdmin.nuevaDeuda, 0.00) &&
  resCajaAdmin.wallet.is_blocked === false,
  'recibirEfectivoEnCajaAdmin liquida deuda física ($26.50 -> $0.00) y desbloquea automáticamente al repartidor'
);

// 5.3 Validar path CLIENT_FALLBACK (simulando host sin RPC migrada usando contexto admin/sistema) + flete $0
sb.setRpcEnabled(false);
sb.asUser(USERS.admin);
const resFallbackZeroFee = await procesarBalanceCompletado({
  orden: {
    id: crypto.randomUUID(),
    business_id: BIZ_SUSHI,
    delivery_type: 'delivery',
    payment_method: 'efectivo',
    subtotal_food: 12.00,
    delivery_fee: 0, // Promoción envío gratis ($0.00) — NO debe coercionar a $2.50!
    driver_tip: 0,
    total: 12.00
  },
  driverId: USERS.driver2.id,
  sb
});
assert(
  resFallbackZeroFee.modoSeguro === 'CLIENT_FALLBACK' &&
  approxEqual(resFallbackZeroFee.fleteGanado, 0.00) &&
  approxEqual(resFallbackZeroFee.wallet.cash_debt, 12.00),
  'Modo fallback respeta delivery_fee = $0.00 sin coercionar a FLETE_BASE_DEFAULT ($2.50)'
);
sb.setRpcEnabled(true);

// ==============================================================================
// FASE 6: MATRIZ ADVERSARIAL ZERO-TRUST RLS Y VALIDACIÓN ANTI-ESCALACIÓN
// ==============================================================================
console.log('\n=== FASE 6: MATRIZ DE SEGURIDAD ZERO-TRUST RLS Y AUDITORÍA DE CÓDIGO ===');

// 6.1 Bloqueo de auto-escalación a Administrador vía email con 'admin' o user_metadata
assert(sb.isAdminUser(USERS.attacker) === false, 'RLS is_admin(): testadmin@gmail.com con user_metadata.role="admin" NO obtiene privilegios Admin');
sb.asUser(USERS.attacker);
const { data: logsRobados } = await sb.from('security_audit_logs').select('*');
assert(logsRobados.length === 0, 'Atacante con "admin" en correo Gmail recibe 0 filas de security_audit_logs');

// 6.2 Manipulación directa de billetera por repartidor bloqueada por RLS
sb.asUser(USERS.driver1);
const { error: errTamperWallet } = await sb.from('delivery_wallets')
  .update({ prepaid_balance: 99999, cash_debt: 0 })
  .eq('driver_id', USERS.driver1.id);
assert(Boolean(errTamperWallet), 'RLS delivery_wallets bloquea UPDATE directo del repartidor (protección contra alteración de saldo)');

const { error: errCrossRpc } = await sb.rpc('procesar_balance_completado_seguro', {
  p_order_id: ordenEfectivo.id,
  p_driver_id: USERS.driver2.id
});
assert(errCrossRpc && errCrossRpc.message.includes('UNAUTHORIZED'), 'RPC procesar_balance_completado_seguro rechaza que driver1 liquide billetera de driver2');

// 6.3 Suplantación de customer_id en orders bloqueada por RLS
sb.asUser(USERS.client2);
const { error: errImpersonateOrder } = await sb.from('orders').insert([{
  business_id: BIZ_BURGER,
  customer_id: USERS.client1.id, // Intentando hacerse pasar por client1
  customer_phone: '04141110000',
  delivery_type: 'delivery',
  payment_method: 'efectivo',
  items: [{ id: PROD_BURGER, name: 'Hamburguesa', price: 6.00, quantity: 1 }],
  total: 7.75
}]);
assert(Boolean(errImpersonateOrder), 'RLS orders_client_insert bloquea inserción directa suplantando customer_id de otro usuario');

// 6.4 Aislamiento cruzado de clientes sobre historial de pedidos
const { data: ordenesDeClient1VistasPorClient2 } = await sb.from('orders').select('*').eq('customer_id', USERS.client1.id);
assert(ordenesDeClient1VistasPorClient2.length === 0, 'RLS orders_client_select: Cliente 2 no puede leer órdenes del Cliente 1');

// 6.5 Verificación estática de AuthContext.jsx y Cocina.jsx (sin backdoor .includes('admin'))
const authCtxSrc = readFileSync('src/context/AuthContext.jsx', 'utf8');
const cocinaSrc = readFileSync('src/pages/Cocina.jsx', 'utf8');
assert(!authCtxSrc.includes(".includes('admin')"), 'AuthContext.jsx no contiene backdoor emailLower.includes("admin")');
assert(!cocinaSrc.includes(".includes('admin')"), 'Cocina.jsx no contiene backdoor email?.includes("admin")');
assert(cocinaSrc.includes("['pending', 'confirmed', 'paid'].includes(ord.status)"), 'Cocina.jsx KDS no permite iniciar preparación de órdenes pending_payment_verification');

console.log('\n==================================================================');
console.log(`RESULTADO INTEGRACIÓN MULTI-ROL: ${passed} pasadas, ${failed} fallidas`);
console.log('==================================================================');

if (failed > 0) {
  process.exit(1);
}
