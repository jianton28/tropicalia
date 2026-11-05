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
import { semanticSearchService, normalizarTexto } from '../services/semanticSearchService.js';
import { securityService } from '../services/securityService.js';

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

console.log('\n=== TEST 4: BUSCADOR GLOBAL INTELIGENTE (SINÓNIMOS CON IA Y BÚSQUEDA CRUZADA) ===');

// 4.1 Normalización de texto
assert(normalizarTexto('Hambúrguesa con Quesó!') === 'hamburguesa con queso', 'Normalización remueve tildes y signos');
assert(normalizarTexto('PIZZA NAPOLITANA') === 'pizza napolitana', 'Normalización a minúsculas');

// 4.2 Mapeo semántico y expansión de sinónimos
const expansionBurger = semanticSearchService.expandirTerminos('burger');
assert(expansionBurger.sinonimos.includes('hamburguesa'), 'Mapeo semántico: "burger" equivale a "hamburguesa"');
assert(expansionBurger.sinonimos.includes('cheeseburger'), 'Mapeo semántico: incluye variantes como "cheeseburger"');
assert(expansionBurger.conceptosDetectados.some(c => c.includes('Hamburguesas')), 'Detecta concepto visual de Hamburguesas');

const expansionPizza = semanticSearchService.expandirTerminos('pizza');
assert(expansionPizza.sinonimos.includes('pizzeria') || expansionPizza.sinonimos.includes('margarita'), 'Mapeo semántico: "pizza" expande a pizzería y margarita');

// 4.3 Búsqueda cruzada de Platos y Restaurantes
const testProductos = [
  { id: 'prod-1', name: 'Hamburguesa Tropical Especial', description: 'Carne jugosa con queso y tocineta', price: 9.5, category: 'Hamburguesas', business_id: 'biz-1' },
  { id: 'prod-2', name: 'Pizza Margarita Familiar', description: 'Masa madre, salsa pomodoro y mozzarella', price: 12.0, category: 'Pizzas', business_id: 'biz-2' },
  { id: 'prod-3', name: 'Roll Tempura Salmón', description: '10 piezas con queso crema y aguacate', price: 11.0, category: 'Sushi', business_id: 'biz-3' },
  { id: 'prod-4', name: 'Alitas BBQ Crispy', description: '8 alitas crujientes con salsa BBQ', price: 7.5, category: 'Platos Salados', business_id: 'biz-1' }
];

const testRestaurantes = [
  { id: 'biz-1', name: 'Burger & Grill Tropicalia', category: 'Hamburguesas y Carnes', rating: 4.95, distanciaKm: 1.2 },
  { id: 'biz-2', name: 'Pizzería Bella Napoli', category: 'Pizzas Artesanales', rating: 4.85, distanciaKm: 2.1 },
  { id: 'biz-3', name: 'Tokyo Sushi House', category: 'Sushi y Asiática', rating: 4.90, distanciaKm: 3.5 }
];

// Caso A: Búsqueda con sinónimo en inglés "burger"
const resultadoBurger = semanticSearchService.buscarCatalogoLocal({
  query: 'burger',
  productos: testProductos,
  restaurantes: testRestaurantes
});

assert(resultadoBurger.platosIndependientes.some(p => p.id === 'prod-1'), 'Búsqueda "burger" encuentra el plato "Hamburguesa Tropical Especial"');
assert(resultadoBurger.restaurantesCoincidentes.some(r => r.id === 'biz-1'), 'Búsqueda "burger" encuentra el restaurante "Burger & Grill Tropicalia"');
assert(resultadoBurger.restaurantesCoincidentes[0].id === 'biz-1', 'Restaurante especializado en burgers queda de primero en el ordenamiento');
assert(resultadoBurger.restaurantesCoincidentes[0].platosCoincidentes.length > 0, 'Restaurante incluye lista cruzada de platos afines');

// Caso B: Búsqueda general "pizza"
const resultadoPizza = semanticSearchService.buscarCatalogoLocal({
  query: 'pizza',
  productos: testProductos,
  restaurantes: testRestaurantes
});

assert(resultadoPizza.platosIndependientes.some(p => p.id === 'prod-2'), 'Búsqueda "pizza" encuentra el plato "Pizza Margarita Familiar"');
assert(resultadoPizza.restaurantesCoincidentes.some(r => r.id === 'biz-2'), 'Búsqueda "pizza" encuentra "Pizzería Bella Napoli"');

// Caso C: Tolerancia a errores ortográficos (Fuzzy Matching "hamburgesa" sin 'u')
const resultadoFuzzy = semanticSearchService.buscarCatalogoLocal({
  query: 'hamburgesa',
  productos: testProductos,
  restaurantes: testRestaurantes
});
assert(resultadoFuzzy.platosIndependientes.some(p => p.id === 'prod-1'), 'Fuzzy matching: "hamburgesa" (con error ortográfico) encuentra "Hamburguesa Tropical Especial"');

// Caso D: Rendimiento y Caché (< 50ms para 100 consultas)
const tInicio = performance.now();
for (let i = 0; i < 100; i++) {
  semanticSearchService.buscarCatalogoLocal({
    query: 'burger',
    productos: testProductos,
    restaurantes: testRestaurantes
  });
}
const tTotal = performance.now() - tInicio;
assert(tTotal < 50, `Rendimiento ultra-rápido: 100 consultas en ${tTotal.toFixed(2)}ms (promedio ${(tTotal / 100).toFixed(3)}ms/consulta)`);

console.log('\n=== TEST 5: ZERO-TRUST CIBERSEGURIDAD, ANTI-BOT Y IDEMPOTENCIA ===');

// 5.1 Clave de idempotencia única (UUID v4)
const key1 = securityService.generateIdempotencyKey();
const key2 = securityService.generateIdempotencyKey();
assert(key1 !== key2, 'Genera claves de idempotencia únicas por transacción');
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key1), 'Clave de idempotencia cumple especificación RFC 4122 UUID v4');

// 5.2 Sanitización de entradas (Prevención XSS / Inyección)
const inputPeligroso = '<script>alert("xss")</script>Carlos Ruiz <img src=x onerror=alert(1)>';
const saneado = securityService.sanitizeInput(inputPeligroso);
assert(!saneado.includes('<script>') && !saneado.includes('onerror'), 'Sanitización remueve tags HTML y manejadores onerror');
assert(saneado.includes('Carlos Ruiz'), 'Sanitización preserva texto legítimo del usuario');

// 5.3 Validación de teléfono y correo
assert(securityService.validateEmail('cliente@tropicalia.com') === true, 'Email válido aceptado');
assert(securityService.validateEmail('invalido@@email') === false, 'Email inválido rechazado');
assert(securityService.validatePhoneVE('04141352503') === true, 'Teléfono móvil VE (0414) válido');
assert(securityService.validatePhoneVE('584241234567') === true, 'Teléfono VE formato internacional válido');
assert(securityService.validatePhoneVE('123') === false, 'Teléfono truncado rechazado');

// 5.4 Rate Limiting de Autenticación (Prevención de Fuerza Bruta)
const testUser = 'hacker_test@tropicalia.com';
securityService.resetLoginAttempts(testUser);

assert(securityService.checkLoginRateLimit(testUser).blocked === false, 'Usuario nuevo no está bloqueado');
assert(securityService.checkLoginRateLimit(testUser).attemptsLeft === 5, 'Cuenta inicia con 5 intentos disponibles');

// Simular 4 intentos fallidos
for (let i = 0; i < 4; i++) {
  securityService.recordFailedLoginAttempt(testUser);
}
assert(securityService.checkLoginRateLimit(testUser).blocked === false, 'Con 4 intentos fallidos sigue sin bloquearse');
assert(securityService.checkLoginRateLimit(testUser).attemptsLeft === 1, 'Queda exactamente 1 intento restante');

// 5to intento fallido -> Bloqueo estricto
securityService.recordFailedLoginAttempt(testUser);
const lockCheck = securityService.checkLoginRateLimit(testUser);
assert(lockCheck.blocked === true, 'Al 5to intento fallido se activa bloqueo por fuerza bruta');
assert(lockCheck.remainingSeconds > 0, 'Informa segundos restantes de bloqueo');

// Desbloqueo tras login exitoso
securityService.resetLoginAttempts(testUser);
assert(securityService.checkLoginRateLimit(testUser).blocked === false, 'Restablecimiento exitoso tras autenticación legítima');

// 5.5 Rate Limiting de Pedidos (Protección contra Bombardeo)
securityService.recordOrderPlaced();
const orderLimit = securityService.checkOrderRateLimit();
assert(orderLimit.allowed === false, 'Bloquea órdenes inmediatas consecutivas (< 30s)');
assert(orderLimit.waitSeconds > 0 && orderLimit.waitSeconds <= 30, 'Calcula ventana de enfriamiento de 30 segundos');

console.log(`\n========================================`);
console.log(`RESULTADOS: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('¡TODAS LAS PRUEBAS UNITARIAS PASARON EXITOSAMENTE!');
}
