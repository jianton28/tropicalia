import {
  NUMERO_ORIGEN_NEGOCIO,
  NUMERO_ORIGEN_INTERNACIONAL,
  formatearTelefonoVE,
  generarMensajeEstado,
  generarEnlaceWhatsApp
} from '../services/whatsappService.js';

import {
  TECHO_DEUDA_EFECTIVO,
  calcularMontoTotalEfectivo,
  validarAceptacionCarrera
} from '../services/paymentService.js';

import { toBs, formatUsd, formatBs } from '../services/bcvService.js';

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

console.log('=== TEST 1: WHATSAPP SERVICE & 04141352503 CONFIG ===');
assert(NUMERO_ORIGEN_NEGOCIO === '04141352503', 'Número de origen local es 04141352503');
assert(NUMERO_ORIGEN_INTERNACIONAL === '584141352503', 'Número internacional es 584141352503');
assert(formatearTelefonoVE('04141352503') === '584141352503', 'Formatea 04141352503 a 584141352503');
assert(formatearTelefonoVE('04129876543') === '584129876543', 'Formatea 04129876543 a 584129876543');
assert(formatearTelefonoVE('584241112233') === '584241112233', 'Preserva 584241112233');

const mockOrden = {
  id: 'a1b2c3d4-e5f6-7890-abcd-1234567890ef',
  customer_name: 'Carlos Ruiz',
  customer_phone: '04141234567',
  delivery_type: 'delivery',
  delivery_address: 'Av. Libertador, Edif. Caracas',
  delivery_code: '5892',
  items: [
    { name: 'Hamburguesa Tropical', quantity: 2, price: 8.5 },
    { name: 'Papas Rústicas', quantity: 1, price: 3.0 }
  ],
  subtotal_food: 20.0,
  delivery_fee: 2.5,
  driver_tip: 1.0,
  total: 23.5,
  total_bs: 20562.5,
  payment_method: 'pago_movil',
  businesses: { name: 'Tropicalia Gourmet Burger' }
};

const msgCooking = generarMensajeEstado(mockOrden, 'cooking', mockOrden.businesses);
assert(msgCooking.includes('0414-1352503'), 'Mensaje incluye número de soporte 0414-1352503');
assert(msgCooking.includes('EN PREPARACIÓN'), 'Mensaje identifica estado EN PREPARACIÓN');
assert(msgCooking.includes('Hamburguesa Tropical'), 'Mensaje lista ítems de la orden');
assert(msgCooking.includes('23.50'), 'Mensaje incluye total financiero');

const linkCooking = generarEnlaceWhatsApp(mockOrden, 'cooking', mockOrden.businesses);
assert(linkCooking.startsWith('https://wa.me/584141234567?text='), 'Enlace wa.me apunta al teléfono normalizado del cliente');

console.log('\n=== TEST 2: PAYMENT SERVICE & DEBT CEILING ($25) ===');
assert(TECHO_DEUDA_EFECTIVO === 25.00, 'Techo de deuda en efectivo es exactamente $25.00');

const ordenEfectivo = {
  total: 18.5,
  items: [{ price: 15, quantity: 1 }],
  delivery_fee: 2.5,
  driver_tip: 1.0
};
const totalCalculado = calcularMontoTotalEfectivo(ordenEfectivo);
assert(totalCalculado === 18.5, 'Cálculo de monto total efectivo nunca es 0');

// Caso 1: Repartidor con deuda baja ($10) puede aceptar orden en efectivo de $5
const checkBajo = validarAceptacionCarrera({
  orden: { payment_method: 'efectivo', total: 5.0 },
  wallet: { cash_debt: 10.0, prepaid_balance: 0 }
});
assert(checkBajo.permitido === true, 'Repartidor con deuda $10 puede aceptar carrera');

// Caso 2: Repartidor con deuda límite ($25) NO puede aceptar efectivo
const checkLimite = validarAceptacionCarrera({
  orden: { payment_method: 'efectivo', total: 4.0 },
  wallet: { cash_debt: 25.0, prepaid_balance: 0 }
});
assert(checkLimite.permitido === false, 'Repartidor con $25 de deuda es bloqueado para efectivo');

// Caso 3: Repartidor con deuda límite SÍ puede aceptar órdenes de Pago Móvil / Digitales
const checkDigital = validarAceptacionCarrera({
  orden: { payment_method: 'pago_movil', total: 30.0 },
  wallet: { cash_debt: 26.0, prepaid_balance: 0 }
});
assert(checkDigital.permitido === true, 'Repartidor con deuda en efectivo puede aceptar órdenes prepagadas / digitales');

console.log('\n=== TEST 3: BCV CURRENCY FORMATTING ===');
assert(formatUsd(15.5) === '$15.50', 'formatUsd formatea correctamente');
assert(toBs(10, 800) === 8000, 'toBs calcula tasa correctamente');

console.log(`\n========================================`);
console.log(`RESULTADOS: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('¡TODAS LAS PRUEBAS UNITARIAS PASARON EXITOSAMENTE!');
}
