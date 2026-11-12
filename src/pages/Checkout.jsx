import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { fetchTasaBCV, toBs, formatUsd, formatBs } from '../services/bcvService';
import { addressService } from '../services/addressService';
import { getProductImageUrl } from '../services/imageService';
import MapAddressPicker from '../components/common/MapAddressPicker';
import SecurityVerification from '../components/common/SecurityVerification';
import { securityService } from '../services/securityService';
import {
  Bike,
  ShoppingBag,
  Store,
  MapPin,
  Lock,
  Phone,
  Info,
  ExternalLink,
  CheckCircle2,
  Paperclip,
  RefreshCw,
  Plus,
  X,
  Check,
  CreditCard
} from '../components/common/Icons';

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.2, parseFloat((R * c * 1.25).toFixed(1)));
}

function calcularTarifaPorKm(km) {
  if (km <= 1.0) return 1.00;
  const tarifa = 1.00 + ((km - 1.0) * 0.50);
  const redondeado = Math.round(tarifa * 4) / 4;
  return Math.min(6.00, Math.max(1.00, redondeado));
}

export default function Checkout() {
  const navigate = useNavigate();
  const { cart, businessId, businessName, changeQuantity, clearCart } = useCart();
  const { user } = useAuth();

  // Estados de control post-compra (Bug visual de carrito vacío corregido)
  const isOrderConfirmedRef = useRef(false);
  const [orderCompleted, setOrderCompleted] = useState(false);

  const [tasaBCV, setTasaBCV] = useState(875.65);
  const [restauranteInfo, setRestauranteInfo] = useState(null);
  const [coordsRestaurante, setCoordsRestaurante] = useState({ lat: 10.4806, lng: -66.9036 });
  const [distanciaKm, setDistanciaKm] = useState(1.8);
  const [fleteUsd, setFleteUsd] = useState(1.50);

  // Control de Paso Visual Figma ('carrito' | 'metodos')
  const [checkoutStep, setCheckoutStep] = useState('carrito');

  // Form states
  const [modalidad, setModalidad] = useState('delivery');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState(() => {
    return localStorage.getItem('tropicalia_delivery_address') || '';
  });
  const [mapUrl, setMapUrl] = useState('');
  const [notas, setNotas] = useState('');
  const [propina, setPropina] = useState(0);
  const [metodoPago, setMetodoPago] = useState('pago_movil');

  // Metodo especifico campos
  const [pmBanco, setPmBanco] = useState('');
  const [pmTelefono, setPmTelefono] = useState('');
  const [referencia, setReferencia] = useState('');
  const [binanceId, setBinanceId] = useState('');
  const [zelleTitular, setZelleTitular] = useState('');
  const [zinliEmisor, setZinliEmisor] = useState('');
  const [kontigoUsuario, setKontigoUsuario] = useState('');
  const [paypalCorreo, setPaypalCorreo] = useState('');
  const [puntoTipo, setPuntoTipo] = useState('Débito');
  const [efectivoBillete, setEfectivoBillete] = useState('');
  const [comprobanteFile, setComprobanteFile] = useState(null);

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Direcciones Múltiples y Envíos a Terceros
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('custom');
  const [showAddAddressForm, setShowAddAddressForm] = useState(false);
  const [newAlias, setNewAlias] = useState('Casa');
  const [newAddressText, setNewAddressText] = useState('');
  const [isThirdParty, setIsThirdParty] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [newCoords, setNewCoords] = useState(null);
  const [savingAddress, setSavingAddress] = useState(false);

  // Blindaje Zero-Trust: Idempotencia y Verificación Anti-Bot
  const [idempotencyKey, setIdempotencyKey] = useState(() => securityService.generateIdempotencyKey());
  const [botVerified, setBotVerified] = useState(false);

  useEffect(() => {
    if (user?.id) {
      const procesarDirecciones = (addrs) => {
        if (Array.isArray(addrs) && addrs.length > 0) {
          setSavedAddresses(addrs);
          const def = addrs.find(a => a.is_default || a.isDefault) || addrs[0];
          if (def && (!direccion || direccion.trim() === '')) {
            setSelectedAddressId(def.id);
            aplicarDireccion(def);
          }
        }
      };

      try {
        const res = addressService.getAddresses(user.id);
        if (res && typeof res.then === 'function') {
          res.then(procesarDirecciones).catch(err => {
            console.warn('Fallback al resolver direcciones en Checkout:', err);
            procesarDirecciones(addressService.getAddresses());
          });
        } else {
          procesarDirecciones(res);
        }
      } catch (err) {
        console.warn('Error cargando direcciones:', err);
        procesarDirecciones(addressService.getAddresses());
      }
    }
  }, [user]);

  function aplicarDireccion(addr) {
    if (!addr) return;
    setSelectedAddressId(addr.id);
    setDireccion(addr.address);
    if (addr.recipient_name) {
      setNombre(addr.recipient_name);
    } else if (user?.user_metadata?.full_name) {
      setNombre(user.user_metadata.full_name);
    }
    if (addr.recipient_phone) {
      setTelefono(addr.recipient_phone);
    } else if (user?.user_metadata?.phone) {
      setTelefono(user.user_metadata.phone);
    }
    if (addr.lat && addr.lng) {
      const lat = parseFloat(addr.lat);
      const lng = parseFloat(addr.lng);
      setMapUrl(`https://www.google.com/maps?q=${lat},${lng}`);
      localStorage.setItem('tropicalia_user_lat', lat.toString());
      localStorage.setItem('tropicalia_user_lng', lng.toString());
      const km = calcularDistanciaKm(coordsRestaurante.lat, coordsRestaurante.lng, lat, lng);
      setDistanciaKm(km);
      setFleteUsd(calcularTarifaPorKm(km));
      setGpsStatus(`Dirección seleccionada: "${addr.alias}" (${km.toFixed(1)} km)`);
    }
  }

  async function handleGuardarNuevaDireccion(e) {
    e.preventDefault();
    if (!newAddressText.trim()) {
      alert('Por favor ingresa la dirección escrita o referencia.');
      return;
    }
    if (isThirdParty && (!recipientName.trim() || !recipientPhone.trim())) {
      alert('Por favor indica el nombre y teléfono del destinatario para el envío a tercero.');
      return;
    }
    setSavingAddress(true);
    try {
      const lat = newCoords ? newCoords.lat : (parseFloat(localStorage.getItem('tropicalia_user_lat')) || 10.4950);
      const lng = newCoords ? newCoords.lng : (parseFloat(localStorage.getItem('tropicalia_user_lng')) || -66.8480);
      const nueva = await addressService.saveAddress({
        user_id: user?.id,
        alias: newAlias.trim() || 'Mi Dirección',
        recipient_name: isThirdParty ? recipientName.trim() : null,
        recipient_phone: isThirdParty ? recipientPhone.trim() : null,
        address: newAddressText.trim(),
        lat: lat,
        lng: lng,
        is_default: savedAddresses.length === 0
      });
      setSavedAddresses(prev => [nueva, ...prev.filter(a => a.id !== nueva.id)]);
      aplicarDireccion(nueva);
      setShowAddAddressForm(false);
      setNewAddressText('');
      setRecipientName('');
      setRecipientPhone('');
      setIsThirdParty(false);
    } catch (err) {
      alert('Error al guardar dirección: ' + err.message);
    } finally {
      setSavingAddress(false);
    }
  }

  // ============================================================================
  // CÁLCULO 100% AUTOMÁTICO DE DISTANCIA (SIN INGRESO MANUAL DEL USUARIO)
  // ============================================================================
  useEffect(() => {
    // Si la orden ya fue confirmada, evitar cualquier validación de carrito vacío
    if (isOrderConfirmedRef.current || orderCompleted) return;

    if (cart.length === 0 || !businessId) {
      navigate('/');
      return;
    }

    fetchTasaBCV().then(r => setTasaBCV(r));

    async function cargarRestauranteYCalcularDistancia() {
      const { data: neg } = await supabase
        .from('businesses')
        .select('name, phone, lat, lng')
        .eq('id', businessId)
        .maybeSingle();

      let coordsCocina = { lat: 10.4806, lng: -66.9036 };
      if (neg) {
        setRestauranteInfo(neg);
        if (neg.lat && neg.lng) {
          coordsCocina = {
            lat: parseFloat(neg.lat),
            lng: parseFloat(neg.lng)
          };
          setCoordsRestaurante(coordsCocina);
        }
      }

      // Auto-calcular distancia exacta con coordenadas del cliente
      const savedLat = localStorage.getItem('tropicalia_user_lat');
      const savedLng = localStorage.getItem('tropicalia_user_lng');

      if (savedLat && savedLng) {
        const km = calcularDistanciaKm(coordsCocina.lat, coordsCocina.lng, parseFloat(savedLat), parseFloat(savedLng));
        setDistanciaKm(km);
        setFleteUsd(calcularTarifaPorKm(km));
        setGpsStatus(`Distancia automática calculada (${km.toFixed(1)} km)`);
      }

      // Consulta en segundo plano de GPS de alta precisión
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            localStorage.setItem('tropicalia_user_lat', lat.toString());
            localStorage.setItem('tropicalia_user_lng', lng.toString());
            setMapUrl(`https://www.google.com/maps?q=${lat},${lng}`);

            const kmExacto = calcularDistanciaKm(coordsCocina.lat, coordsCocina.lng, lat, lng);
            setDistanciaKm(kmExacto);
            setFleteUsd(calcularTarifaPorKm(kmExacto));
            setGpsStatus(`GPS Verificado: ${kmExacto.toFixed(1)} km de la cocina`);
          },
          () => {
            // Si el cliente no comparte GPS, mantener distancia automática por zona
          },
          { enableHighAccuracy: true, timeout: 7000 }
        );
      }
    }

    cargarRestauranteYCalcularDistancia();

    if (user?.user_metadata) {
      if (user.user_metadata.full_name) setNombre(user.user_metadata.full_name);
      if (user.user_metadata.phone) setTelefono(user.user_metadata.phone);
    }
  }, [cart, businessId, navigate, user, orderCompleted]);

  // Cálculos financieros
  const subtotalComida = cart.reduce((acc, el) => acc + (parseFloat(el.price) * (el.quantity || 1)), 0);
  const costoDelivery = modalidad === 'delivery' ? fleteUsd : 0.00;
  const propinaMotorizado = modalidad === 'delivery' ? propina : 0.00;
  const totalUsd = subtotalComida + costoDelivery + propinaMotorizado;
  const totalBs = toBs(totalUsd, tasaBCV);

  function handleCapturarGPS() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización directa.');
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        localStorage.setItem('tropicalia_user_lat', lat.toString());
        localStorage.setItem('tropicalia_user_lng', lng.toString());
        const gmaps = `https://www.google.com/maps?q=${lat},${lng}`;
        setMapUrl(gmaps);

        const km = calcularDistanciaKm(coordsRestaurante.lat, coordsRestaurante.lng, lat, lng);
        setDistanciaKm(km);
        setFleteUsd(calcularTarifaPorKm(km));

        if (!direccion) {
          setDireccion(`Ubicación GPS exacta (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        }
        setGpsLoading(false);
        setGpsStatus(`GPS en Vivo Actualizado (${km.toFixed(1)} km)`);
      },
      () => {
        setGpsLoading(false);
        alert('No se pudo actualizar el GPS. Se mantendrá el cálculo automático.');
      },
      { enableHighAccuracy: true }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // 1. Verificación de Rate Limiting (Protección contra Flood de Bot)
    const rateCheck = securityService.checkOrderRateLimit();
    if (!rateCheck.allowed) {
      alert(`Por favor espera ${rateCheck.waitSeconds} segundos antes de emitir otro pedido.`);
      return;
    }

    // 2. Verificación Anti-Bot / Turnstile Zero-Trust
    if (!botVerified) {
      alert('Por favor completa la verificación de seguridad anti-bot antes de confirmar tu pedido.');
      return;
    }

    if (modalidad === 'delivery' && !direccion) {
      alert('Por favor indica tu dirección de entrega o usa el botón de ubicación GPS.');
      return;
    }

    setSubmitting(true);

    try {
      let referenciaFinal = '';
      let detalleExtraPago = '';

      if (metodoPago === 'pago_movil') {
        if (!pmBanco || !pmTelefono || !referencia) {
          throw new Error('Por favor completa el banco, teléfono emisor y número de referencia.');
        }
        referenciaFinal = `${securityService.sanitizeInput(referencia)} (${securityService.sanitizeInput(pmBanco)} - ${securityService.sanitizeInput(pmTelefono)})`;
      } else if (metodoPago === 'binance') {
        if (!binanceId) throw new Error('Ingresa tu Binance UID o correo de envío.');
        referenciaFinal = `UID/Email: ${securityService.sanitizeInput(binanceId)} (Ref: ${securityService.sanitizeInput(referencia) || 'S/R'})`;
      } else if (metodoPago === 'zelle') {
        if (!zelleTitular || !referencia) throw new Error('Ingresa el titular Zelle y la referencia.');
        referenciaFinal = `Zelle: ${securityService.sanitizeInput(zelleTitular)} (#${securityService.sanitizeInput(referencia)})`;
      } else if (metodoPago === 'zinli') {
        if (!zinliEmisor || !referencia) throw new Error('Ingresa tu usuario Zinli y la referencia.');
        referenciaFinal = `Zinli: ${securityService.sanitizeInput(zinliEmisor)} (#${securityService.sanitizeInput(referencia)})`;
      } else if (metodoPago === 'kontigo') {
        if (!kontigoUsuario || !referencia) throw new Error('Ingresa tu teléfono/usuario Kontigo y la referencia.');
        referenciaFinal = `Kontigo: ${securityService.sanitizeInput(kontigoUsuario)} (#${securityService.sanitizeInput(referencia)})`;
      } else if (metodoPago === 'paypal') {
        if (!paypalCorreo || !referencia) throw new Error('Ingresa tu correo PayPal y la referencia de transacción.');
        referenciaFinal = `PayPal: ${securityService.sanitizeInput(paypalCorreo)} (#${securityService.sanitizeInput(referencia)})`;
      } else if (metodoPago === 'punto') {
        referenciaFinal = `Punto (${puntoTipo}) - ${securityService.sanitizeInput(referencia) || 'Cobrar con punto'}`;
      } else if (metodoPago === 'efectivo' || metodoPago === 'efectivo_bs') {
        const billete = securityService.sanitizeInput(efectivoBillete) || 'Efectivo exacto';
        referenciaFinal = `EFECTIVO (${billete})`;
        detalleExtraPago = `[Pago con: ${billete}]`;
      }

      // Subida de comprobante
      let urlComprobante = null;
      if (comprobanteFile) {
        const ext = comprobanteFile.name.split('.').pop();
        const fileName = `pagos/${metodoPago}_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('receipts').upload(fileName, comprobanteFile);
        if (!upErr) {
          const { data: pubUrl } = supabase.storage.from('receipts').getPublicUrl(fileName);
          urlComprobante = pubUrl.publicUrl;
        }
      }

      const requiereVerificacion = ['pago_movil', 'binance', 'zelle', 'zinli', 'kontigo', 'paypal'].includes(metodoPago);
      const estadoInicial = requiereVerificacion ? 'pending_payment_verification' : 'pending';

      const addrActual = savedAddresses.find(a => a.id === selectedAddressId);
      const tagTercero = addrActual?.recipient_name ? `[Envío a Tercero: ${addrActual.recipient_name} (Tlf: ${addrActual.recipient_phone || telefono})]` : '';
      const notasCompletas = [notas, detalleExtraPago, tagTercero].filter(Boolean).join(' • ');

      const cleanNombre = securityService.sanitizeInput(nombre);
      const cleanTelefono = securityService.sanitizeInput(telefono);
      const cleanDireccion = securityService.sanitizeInput(direccion);
      const cleanNotas = securityService.sanitizeInput(notasCompletas);

      const payload = {
        business_id: businessId,
        customer_id: user?.id || null,
        customer_name: cleanNombre,
        customer_phone: cleanTelefono,
        delivery_type: modalidad,
        delivery_address: modalidad === 'delivery' ? `${cleanDireccion} (~${distanciaKm.toFixed(1)} km)` : 'Retiro en local (Pickup)',
        map_url: mapUrl || null,
        notes: cleanNotas,
        payment_method: metodoPago,
        payment_reference: referenciaFinal,
        payment_receipt_url: urlComprobante,
        items: cart,
        subtotal_food: subtotalComida,
        delivery_fee: costoDelivery,
        driver_tip: propinaMotorizado,
        total: totalUsd,
        total_bs: totalBs,
        status: estadoInicial,
        idempotency_key: idempotencyKey,
        bot_verified: true
      };

      // 3. Inserción atómica con Idempotencia via RPC Segura (o Fallback directo)
      let orden = null;
      try {
        const { data: rpcOrden, error: rpcErr } = await supabase.rpc('crear_pedido_seguro', {
          p_order_payload: payload,
          p_idempotency_key: idempotencyKey
        });
        if (!rpcErr && rpcOrden && rpcOrden.id) {
          orden = rpcOrden;
        }
      } catch {
        // Fallback a inserción directa con clave de idempotencia
      }

      if (!orden) {
        const { data: directOrden, error: ordenError } = await supabase
          .from('orders')
          .insert([payload])
          .select()
          .single();

        if (ordenError) throw ordenError;
        orden = directOrden;
      }

      // 4. Registrar emisión en el limitador de tasa y rotar clave de idempotencia
      securityService.recordOrderPlaced();
      setIdempotencyKey(securityService.generateIdempotencyKey());

      // Marcar orden completada para prevenir bug visual de carrito vacío
      isOrderConfirmedRef.current = true;
      setOrderCompleted(true);
      localStorage.setItem('tropicalia_last_order_id', orden.id);

      // Redirigir de inmediato al tracking
      navigate(`/tracking?order_id=${orden.id}`, { replace: true });

      // Limpiar el carrito de forma diferida tras la navegación
      setTimeout(() => {
        clearCart();
      }, 400);

    } catch (err) {
      alert('Error al registrar pedido: ' + err.message);
      setSubmitting(false);
    }
  }

  const metodosDisponibles = [
    { id: 'pago_movil', label: 'Pago Móvil' },
    { id: 'efectivo', label: 'Efectivo ($ USD)' },
    { id: 'efectivo_bs', label: 'Efectivo (Bs)' },
    { id: 'punto', label: 'Punto de Venta' },
    { id: 'binance', label: 'Binance Pay' },
    { id: 'zelle', label: 'Zelle' },
    { id: 'zinli', label: 'Zinli' }
  ];

  // Pantalla de confirmación suave post-compra (Evita parpadeo de "carrito vacío")
  if (orderCompleted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#ffffff', padding: '24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
          <CheckCircle2 size={56} color="#10b981" />
        </div>
        <h2 style={{ color: 'var(--dark-amaranth)', fontSize: '1.4rem', margin: '0 0 6px 0' }}>¡Pedido Confirmado con Éxito!</h2>
        <p style={{ color: '#4b5563', fontSize: '0.9rem', margin: '0 0 20px 0' }}>Abriendo el seguimiento en vivo de tu comanda...</p>
        <div style={{ width: '38px', height: '38px', border: '3px solid #f3f4f6', borderTopColor: 'var(--golden-orange)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  function handleAvanzarAPagar() {
    if (!nombre.trim() || !telefono.trim()) {
      alert('Por favor ingresa tu nombre y número de teléfono WhatsApp antes de pasar al pago.');
      return;
    }
    if (modalidad === 'delivery' && !direccion.trim()) {
      alert('Por favor indica tu dirección de entrega o selecciona una ubicación en el mapa.');
      return;
    }
    setCheckoutStep('metodos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#ffffff', paddingBottom: checkoutStep === 'carrito' ? '150px' : '90px' }}>
      
      {/* HEADER PLANO OFICIAL FIGMA ('Carrito' 225316 / 'Métodos de Pago' 225325) */}
      <header className="figma-header" style={{ marginBottom: '18px' }}>
        <div className="figma-header-top" style={{ marginBottom: '6px' }}>
          <h1 className="figma-header-title" style={{ fontSize: '1.5rem' }}>
            {checkoutStep === 'carrito' ? 'Carrito' : 'Métodos de Pago'}
          </h1>
          {checkoutStep === 'carrito' ? (
            <Link
              to="/"
              style={{
                background: 'rgba(255,255,255,0.16)',
                color: '#ffffff',
                textDecoration: 'none',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: '999px'
              }}
            >
              ← Menú
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCheckoutStep('carrito');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              style={{
                background: 'rgba(255,255,255,0.16)',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: '999px',
                cursor: 'pointer'
              }}
            >
              ← Volver al Carrito
            </button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'rgba(255, 255, 255, 0.88)' }}>
          {businessName} • Tasa oficial BCV: {formatBs(tasaBCV)}
        </p>
      </header>

      <div style={{ padding: '0 20px' }}>

        {/* =====================================================================
            PASO 1: CARRITO Y DESPACHO (FIGMA Screenshot 225316)
            ===================================================================== */}
        {checkoutStep === 'carrito' && (
          <div>
            {/* CAJA GRIS PRINCIPAL CON ÍTEMS DEL CARRITO (Screenshot 225316) */}
            <div style={{
              background: '#dcdcdc',
              borderRadius: '18px',
              padding: '16px',
              marginBottom: '18px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.92rem', color: 'var(--dark-amaranth)', fontWeight: 700 }}>
                  {cart.length} {cart.length === 1 ? 'Plato en carrito' : 'Platos en carrito'}
                </span>
                <button
                  type="button"
                  onClick={clearCart}
                  style={{ background: 'none', border: 'none', color: 'var(--dark-amaranth)', fontSize: '0.76rem', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
                >
                  Vaciar
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {cart.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      paddingBottom: idx < cart.length - 1 ? '10px' : '0',
                      borderBottom: idx < cart.length - 1 ? '1px solid rgba(130, 19, 58, 0.14)' : 'none'
                    }}
                  >
                    {/* Miniatura Cuadrada Redondeada */}
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '10px',
                      backgroundColor: '#cfcfcf',
                      border: '1px solid rgba(130, 19, 58, 0.2)',
                      overflow: 'hidden',
                      flexShrink: 0
                    }}>
                      <img
                        src={getProductImageUrl({ image_url: item.image_url, name: item.name })}
                        alt={item.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    </div>

                    {/* Nombre, Precio y Stepper Compacto */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--dark-amaranth)', lineHeight: 1.2 }}>
                        {item.name}
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.88rem', fontWeight: 700, color: 'var(--dark-amaranth)', marginTop: '2px' }}>
                        {formatUsd(item.price * item.quantity)}
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '5px', background: '#ffffff', padding: '2px 8px', borderRadius: '999px' }}>
                        <button type="button" onClick={() => changeQuantity(idx, -1)} style={{ border: 'none', background: 'none', color: 'var(--dark-amaranth)', fontWeight: 800, cursor: 'pointer', padding: '0 4px' }}>−</button>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>{item.quantity}</span>
                        <button type="button" onClick={() => changeQuantity(idx, 1)} style={{ border: 'none', background: 'none', color: 'var(--dark-amaranth)', fontWeight: 800, cursor: 'pointer', padding: '0 4px' }}>+</button>
                      </div>
                    </div>

                    {/* Botón Trash + "Eliminar" (Screenshot 225316) */}
                    <button
                      type="button"
                      onClick={() => changeQuantity(idx, -(item.quantity || 1))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--dark-amaranth)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        flexShrink: 0
                      }}
                      title="Eliminar plato del carrito"
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700 }}>Eliminar</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* MODALIDAD DE ENTREGA, DIRECCIONES MÚLTIPLES Y DATOS DE CONTACTO */}
            <div className="figma-form" style={{
              background: '#ffffff',
              border: '1px solid rgba(130, 19, 58, 0.2)',
              borderRadius: '18px',
              padding: '16px',
              marginBottom: '18px'
            }}>
              <h3 style={{ marginTop: 0, color: 'var(--dark-amaranth)', fontSize: '1.05rem', marginBottom: '12px' }}>
                Modalidad y Datos de Entrega
              </h3>

          {/* SELECTOR SEGMENTADO DEL TIPO DE PEDIDO */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 700, color: '#374151' }}>
              ¿Cómo deseas recibir tu comida?
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setModalidad('delivery')}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: modalidad === 'delivery' ? '2px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                  background: modalidad === 'delivery' ? 'var(--dark-amaranth)' : '#f9fafb',
                  color: modalidad === 'delivery' ? '#ffffff' : '#374151',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
              >
                <Bike size={18} /> Delivery a Domicilio
              </button>
              <button
                type="button"
                onClick={() => setModalidad('pickup')}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: modalidad === 'pickup' ? '2px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                  background: modalidad === 'pickup' ? 'var(--dark-amaranth)' : '#f9fafb',
                  color: modalidad === 'pickup' ? '#ffffff' : '#374151',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
              >
                <ShoppingBag size={18} /> Retiro en Local (Pickup)
              </button>
            </div>
          </div>

          {/* TARJETA INFORMATIVA DE RETIRO EN LOCAL */}
          {modalidad === 'pickup' && (
            <div style={{
              background: '#fffbeb',
              border: '1.5px solid var(--golden-orange)',
              borderRadius: '14px',
              padding: '14px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <Store size={20} color="var(--dark-amaranth)" />
                <strong style={{ color: 'var(--dark-amaranth)', fontSize: '0.95rem' }}>
                  Punto de Retiro: {restauranteInfo?.name || businessName}
                </strong>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {restauranteInfo?.phone ? (
                  <>
                    <Phone size={13} color="var(--dark-amaranth)" /> Contacto directo: {restauranteInfo.phone}
                  </>
                ) : 'Atención al cliente en barra'}
              </p>
              <div style={{ background: '#ffffff', borderRadius: '8px', padding: '8px 10px', border: '1px solid #fde68a', fontSize: '0.78rem', color: '#1f2937', marginBottom: '8px' }}>
                <strong>Tiempo estimado:</strong> 15 a 25 minutos.<br />
                <strong>Instrucciones:</strong> Al llegar, muestra tu nombre o código en barra para retirar tu orden sellada.
              </div>
              {coordsRestaurante.lat && coordsRestaurante.lng && (
                <a
                  href={`https://www.google.com/maps?q=${coordsRestaurante.lat},${coordsRestaurante.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.8rem',
                    color: 'var(--ocean-twilight)',
                    fontWeight: 700,
                    textDecoration: 'none'
                  }}
                >
                  <ExternalLink size={13} /> Ver cómo llegar en Google Maps →
                </a>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label>Nombre y Apellido:</label>
              <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} required placeholder="Ej: Jimmie Hamilton" />
            </div>
            <div>
              <label>Teléfono (WhatsApp activo para avisarte):</label>
              <input type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} required placeholder="Ej: 04141234567" />
            </div>
          </div>

          {modalidad === 'delivery' && (
            <div style={{ marginTop: '14px' }}>
              
              {/* SELECTOR DE DIRECCIONES GUARDADAS Y ENVÍOS A TERCEROS */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ margin: 0, fontWeight: 800, color: '#374151', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={18} color="var(--dark-amaranth)" /> Tus Direcciones de Entrega
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAddAddressForm(prev => !prev)}
                    className="btn-secundario"
                    style={{ padding: '4px 10px', fontSize: '0.78rem', borderRadius: '8px', fontWeight: 700 }}
                  >
                    {showAddAddressForm ? 'Cerrar formulario' : '+ Agregar dirección extra'}
                  </button>
                </div>

                {savedAddresses.length > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: '10px',
                    overflowX: 'auto',
                    paddingBottom: '6px',
                    scrollbarWidth: 'none'
                  }}>
                    {savedAddresses.map(addr => {
                      const isSelected = selectedAddressId === addr.id;
                      const esTercero = Boolean(addr.recipient_name);
                      return (
                        <div
                          key={addr.id}
                          onClick={() => aplicarDireccion(addr)}
                          style={{
                            minWidth: '180px',
                            maxWidth: '220px',
                            background: isSelected ? '#ffffff' : '#f9fafb',
                            border: isSelected ? '2px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                            borderRadius: '12px',
                            padding: '10px',
                            cursor: 'pointer',
                            boxShadow: isSelected ? '0 4px 12px rgba(130, 19, 58, 0.12)' : 'none',
                            flexShrink: 0,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <strong style={{ fontSize: '0.84rem', color: isSelected ? 'var(--dark-amaranth)' : '#1f2937' }}>
                              {addr.alias}
                            </strong>
                            {isSelected && (
                              <span style={{ background: 'var(--dark-amaranth)', color: '#ffffff', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Check size={11} color="#ffffff" strokeWidth={3} />
                              </span>
                            )}
                          </div>
                          {esTercero && (
                            <span style={{ background: '#ecfdf5', color: '#065f46', fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', display: 'inline-block', marginBottom: '4px' }}>
                              Para: {addr.recipient_name}
                            </span>
                          )}
                          <p style={{ margin: 0, fontSize: '0.74rem', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {addr.address}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* FORMULARIO INLINE: AGREGAR DIRECCIÓN EXTRA O ENVÍO A TERCERO CON MAPA */}
              {showAddAddressForm && (
                <div style={{
                  background: '#fdfbf7',
                  border: '1.5px dashed var(--golden-orange)',
                  borderRadius: '16px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '0.96rem', fontWeight: 800 }}>
                      + Agregar Nueva Dirección o Envío a Tercero
                    </h4>
                    <span style={{ fontSize: '0.74rem', color: '#78350f', background: '#fef3c7', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                      Con Mapa Interactivo
                    </span>
                  </div>

                  {/* Preajustes rápidos de Alias */}
                  <div style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '0.78rem', color: '#4b5563', marginBottom: '4px', display: 'block' }}>
                      Identificador de la dirección (Alias):
                    </label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      {['Casa', 'Oficina', 'Mamá', 'Pareja', 'Otra'].map(sug => {
                        return (
                          <button
                            key={sug}
                            type="button"
                            onClick={() => setNewAlias(sug)}
                            style={{
                              background: newAlias === sug ? 'var(--dark-amaranth)' : '#ffffff',
                              color: newAlias === sug ? '#ffffff' : '#374151',
                              border: '1px solid #d1d5db',
                              borderRadius: '8px',
                              padding: '3px 8px',
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              fontWeight: 700
                            }}
                          >
                            {sug}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      value={newAlias}
                      onChange={e => setNewAlias(e.target.value)}
                      placeholder="Ej: Apartamento Playa, Casa de la Abuela..."
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>

                  {/* Opción de Envío a Tercero */}
                  <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', marginBottom: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0, fontWeight: 700, fontSize: '0.84rem', color: '#1f2937' }}>
                      <input
                        type="checkbox"
                        checked={isThirdParty}
                        onChange={e => setIsThirdParty(e.target.checked)}
                        style={{ width: '16px', height: '16px' }}
                      />
                      <span>Esta dirección es para un tercero (otra persona la recibirá)</span>
                    </label>

                    {isThirdParty && (
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '0.76rem' }}>Nombre del Destinatario:</label>
                          <input
                            type="text"
                            value={recipientName}
                            onChange={e => setRecipientName(e.target.value)}
                            placeholder="Ej: Carmen Gómez"
                            style={{ fontSize: '0.85rem' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.76rem' }}>Teléfono Destinatario (WhatsApp):</label>
                          <input
                            type="tel"
                            value={recipientPhone}
                            onChange={e => setRecipientPhone(e.target.value)}
                            placeholder="04141234567"
                            style={{ fontSize: '0.85rem' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Dirección escrita */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.78rem', color: '#4b5563', marginBottom: '4px', display: 'block' }}>
                      Punto de referencia o dirección escrita:
                    </label>
                    <input
                      type="text"
                      value={newAddressText}
                      onChange={e => setNewAddressText(e.target.value)}
                      placeholder="Ej: Av. Francisco de Miranda, Edif. Centro Plaza, Torre B, Piso 5"
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>

                  {/* Mapa Interactivo Leaflet con Pin Arrastrable */}
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.78rem', color: '#4b5563', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={15} color="var(--dark-amaranth)" /> Selecciona la ubicación exacta en el mapa:
                    </label>
                    <MapAddressPicker
                      initialLat={parseFloat(localStorage.getItem('tropicalia_user_lat')) || 10.4950}
                      initialLng={parseFloat(localStorage.getItem('tropicalia_user_lng')) || -66.8480}
                      onLocationSelect={(coords) => setNewCoords(coords)}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setShowAddAddressForm(false)}
                      className="btn-secundario"
                      style={{ padding: '7px 14px', fontSize: '0.82rem' }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleGuardarNuevaDireccion}
                      className="btn-primario"
                      disabled={savingAddress}
                      style={{ padding: '7px 16px', fontSize: '0.82rem', fontWeight: 800 }}
                    >
                      {savingAddress ? 'Guardando...' : 'Guardar y Usar Dirección'}
                    </button>
                  </div>
                </div>
              )}

              {/* DISTANCIA Y TARIFA EXACTA AUTOMÁTICA (SIN INGRESO MANUAL DEL USUARIO) */}
              <div style={{
                background: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: '16px',
                padding: '16px',
                marginBottom: '14px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Lock size={12} /> Distancia Exacta Calculada Automáticamente
                    </span>
                    <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--dark-amaranth)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={18} color="var(--dark-amaranth)" /> {distanciaKm.toFixed(1)} km <span style={{ fontSize: '0.88rem', color: '#4b5563', fontWeight: 600 }}>• Tarifa de Envío: {formatUsd(costoDelivery)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCapturarGPS}
                    className="btn-secundario"
                    style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '8px', fontWeight: 700 }}
                    disabled={gpsLoading}
                    title="Recalcular con coordenadas GPS en vivo"
                  >
                    {gpsLoading ? 'Calculando...' : 'Recalcular GPS'}
                  </button>
                </div>
                <small style={{ color: '#059669', display: 'block', marginTop: '6px', fontWeight: 600 }}>
                  {gpsStatus || `Distancia calculada automáticamente entre la cocina (${restauranteInfo?.name || 'Local'}) y tu ubicación.`}
                </small>
              </div>

              {/* PROPINA VOLUNTARIA AL MOTORIZADO */}
              <div style={{ marginBottom: '12px' }}>
                <label>Propina voluntaria al repartidor:</label>
                <select value={propina} onChange={e => setPropina(parseFloat(e.target.value))}>
                  <option value="0">Sin propina ($0.00)</option>
                  <option value="0.5">Propina $0.50 (Bs. {toBs(0.5, tasaBCV).toFixed(2)})</option>
                  <option value="1.0">Propina $1.00 (Bs. {toBs(1.0, tasaBCV).toFixed(2)})</option>
                  <option value="2.0">Propina $2.00 (Bs. {toBs(2.0, tasaBCV).toFixed(2)})</option>
                  <option value="3.0">Excelente servicio $3.00</option>
                </select>
              </div>

              <div>
                <label>Dirección exacta / Punto de referencia activo:</label>
                <input
                  type="text"
                  value={direccion}
                  onChange={e => setDireccion(e.target.value)}
                  required={modalidad === 'delivery'}
                  placeholder="Ej: Urb. Las Mercedes, Calle París, Edif. Altamira, Apto 4-B"
                />
              </div>
            </div>
          )}

          <div style={{ marginTop: '10px' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--dark-amaranth)', display: 'block', marginBottom: '4px' }}>
              Instrucciones especiales para cocina o empaque (Opcional):
            </label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej: Sin cebolla, salsas aparte, cubiertos biodegradables"
            />
          </div>
        </div>

        {/* CAJA GRIS DE DESGLOSE (Subtotal / Delivery - Screenshot 225316) */}
        <div style={{
          background: '#dcdcdc',
          borderRadius: '16px',
          padding: '14px 18px',
          marginBottom: '20px',
          fontFamily: 'var(--font-display)',
          color: 'var(--dark-amaranth)',
          fontSize: '0.94rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontWeight: 700 }}>
            <span>Subtotal</span>
            <span>{formatUsd(subtotalComida)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: propinaMotorizado > 0 ? '8px' : '0', fontWeight: 700 }}>
            <span>
              Delivery {modalidad === 'delivery' && <small style={{ fontSize: '0.72rem', opacity: 0.85 }}>(~{distanciaKm.toFixed(1)} km)</small>}
            </span>
            <span>{modalidad === 'delivery' ? formatUsd(costoDelivery) : 'Gratis (Pickup)'}</span>
          </div>
          {propinaMotorizado > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Propina Repartidor</span>
              <span>{formatUsd(propinaMotorizado)}</span>
            </div>
          )}
        </div>

        {/* FRANJA FIJA INFERIOR "Total: 000.0$ + Pagar" SOBRE BOTTOM DOCK (Screenshot 225316) */}
        <div className="figma-sticky-strip">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>
                  Total:
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 700, color: 'var(--golden-orange)' }}>
                  {formatUsd(totalUsd)}
                </span>
              </div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#4b5563' }}>
                Equivalente BCV: {formatBs(totalBs)}
              </div>
            </div>

            <button
              type="button"
              onClick={handleAvanzarAPagar}
              className="btn-primario"
              style={{
                padding: '10px 28px',
                borderRadius: '10px',
                fontSize: '0.98rem'
              }}
            >
              Pagar
            </button>
          </div>
        </div>
      </div>
        )}

        {/* =====================================================================
            PASO 2: MÉTODOS DE PAGO (FIGMA Screenshot 225325)
            ===================================================================== */}
        {checkoutStep === 'metodos' && (
          <form onSubmit={handleSubmit} className="figma-form">
            <div style={{
              background: '#f8f5f6',
              borderRadius: '12px',
              padding: '10px 14px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: '1px solid rgba(130,19,58,0.2)'
            }}>
              <span style={{ fontFamily: 'var(--font-display)', color: 'var(--dark-amaranth)', fontWeight: 700, fontSize: '0.9rem' }}>
                Total a Cancelar:
              </span>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--golden-orange)' }}>
                  {formatUsd(totalUsd)}
                </strong>
                <div style={{ fontSize: '0.74rem', color: '#4b5563', fontWeight: 700 }}>
                  {formatBs(totalBs)}
                </div>
              </div>
            </div>

            {/* GRILLA DE MARCAS 2 COLUMNAS (Screenshot 225325) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
              
              {/* 1. Pago Móvil */}
              <button
                type="button"
                onClick={() => setMetodoPago('pago_movil')}
                style={{
                  background: 'var(--tropicalia-radial)',
                  color: '#ffffff',
                  border: metodoPago === 'pago_movil' ? '3px solid var(--golden-orange)' : '2px solid transparent',
                  borderRadius: '12px',
                  height: '76px',
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: metodoPago === 'pago_movil' ? '0 4px 14px rgba(130, 19, 58, 0.35)' : '0 2px 6px rgba(0,0,0,0.08)',
                  position: 'relative'
                }}
              >
                Pago Móvil
                {metodoPago === 'pago_movil' && <span style={{ position: 'absolute', top: '6px', right: '6px' }}><Check size={14} color="#ffffff" strokeWidth={3} /></span>}
              </button>

              {/* 2. Efectivo (USD / Bs) */}
              <button
                type="button"
                onClick={() => setMetodoPago('efectivo')}
                style={{
                  background: '#ffffff',
                  border: ['efectivo', 'efectivo_bs'].includes(metodoPago) ? '3px solid var(--dark-amaranth)' : '1.5px solid #e5e7eb',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  position: 'relative',
                  boxShadow: ['efectivo', 'efectivo_bs'].includes(metodoPago) ? '0 4px 14px rgba(16, 185, 129, 0.25)' : 'none'
                }}
                title="Efectivo en Divisas o Bolívares"
              >
                <svg width="56" height="38" viewBox="0 0 64 42" fill="none">
                  <rect x="6" y="10" width="52" height="28" rx="4" fill="#34d399" />
                  <rect x="4" y="6" width="52" height="28" rx="4" fill="#4ade80" />
                  <rect x="2" y="2" width="52" height="28" rx="4" fill="#6ee7b7" stroke="#10b981" strokeWidth="1.5" />
                  <circle cx="28" cy="16" r="6" fill="#059669" />
                  <circle cx="11" cy="16" r="2.5" fill="#059669" />
                  <circle cx="45" cy="16" r="2.5" fill="#059669" />
                </svg>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#065f46' }}>Efectivo</span>
              </button>

              {/* 3. Kontigo */}
              <button
                type="button"
                onClick={() => setMetodoPago('kontigo')}
                style={{
                  background: '#ff6b00',
                  color: '#ffffff',
                  border: metodoPago === 'kontigo' ? '3px solid var(--dark-amaranth)' : '2px solid transparent',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  position: 'relative'
                }}
              >
                <svg width="26" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 11c0-3.5-3-6-7-6S5 7.5 5 11c0 2 .9 3.8 2.4 4.9L7 19h2l.5-2h5l.5 2h2l-.4-3.1c1.5-1.1 2.4-2.9 2.4-4.9z" />
                  <line x1="9" y1="11" x2="13" y2="11" />
                </svg>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.96rem', fontWeight: 700, letterSpacing: '0.02em' }}>kontigo</span>
              </button>

              {/* 4. PayPal */}
              <button
                type="button"
                onClick={() => setMetodoPago('paypal')}
                style={{
                  background: '#ffffff',
                  border: metodoPago === 'paypal' ? '3px solid #003087' : '1.5px solid #e5e7eb',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  position: 'relative'
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M7 4h6.5c2.8 0 4.5 1.5 4.2 4.2-.3 2.7-2.2 4.3-5 4.3H9.5L8.3 20H5L7 4z" fill="#003087" />
                  <path d="M9.5 7.5h6c2.4 0 3.9 1.3 3.6 3.7-.3 2.4-1.9 3.8-4.4 3.8h-2.9l-1 6H7.8l1.7-13.5z" fill="#0079c1" opacity="0.88" />
                </svg>
                <span style={{ fontWeight: 900, fontStyle: 'italic', fontSize: '1.05rem', color: '#003087' }}>
                  Pay<span style={{ color: '#0079c1' }}>Pal</span>
                </span>
              </button>

              {/* 5. Binance */}
              <button
                type="button"
                onClick={() => setMetodoPago('binance')}
                style={{
                  background: '#0b0e11',
                  color: '#f3ba2f',
                  border: metodoPago === 'binance' ? '3px solid #f3ba2f' : '2px solid transparent',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px'
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#f3ba2f">
                  <path d="M12 3l4 4-4 4-4-4 4-4zm0 10l4 4-4 4-4-4 4-4zm-7-3l2.5 2.5L5 15l-2.5-2.5L5 10zm14 0l2.5 2.5L19 15l-2.5-2.5L19 10z" />
                </svg>
                <span style={{ fontWeight: 800, fontSize: '0.96rem' }}>Binance</span>
              </button>

              {/* 6. Zinli */}
              <button
                type="button"
                onClick={() => setMetodoPago('zinli')}
                style={{
                  background: '#ffffff',
                  border: metodoPago === 'zinli' ? '3px solid #59359a' : '1.5px solid #e5e7eb',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 900, letterSpacing: '0.08em', color: '#59359a' }}>
                  ZINLI
                </span>
              </button>

              {/* 7. Zelle */}
              <button
                type="button"
                onClick={() => setMetodoPago('zelle')}
                style={{
                  background: '#6d1ed4',
                  color: '#ffffff',
                  border: metodoPago === 'zelle' ? '3px solid var(--golden-orange)' : '2px solid transparent',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800 }}>
                  Zelle
                </span>
              </button>

              {/* 8. Punto de Venta */}
              <button
                type="button"
                onClick={() => setMetodoPago('punto')}
                style={{
                  background: 'var(--ocean-twilight)',
                  color: '#ffffff',
                  border: metodoPago === 'punto' ? '3px solid var(--golden-orange)' : '2px solid transparent',
                  borderRadius: '12px',
                  height: '76px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px'
                }}
              >
                <CreditCard size={22} color="#ffffff" />
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', fontWeight: 700 }}>Punto de Venta</span>
              </button>

            </div>

            {/* CAMPOS DINÁMICOS CON CONTRASTE CLARO DEL MANUAL DE MARCA */}
            <div style={{ background: '#f8f5f6', border: '1px solid rgba(130, 19, 58, 0.2)', borderLeft: '4px solid var(--dark-amaranth)', borderRadius: '14px', padding: '16px', marginBottom: '18px' }}>
              {metodoPago === 'pago_movil' && (
                <div>
                  <div style={{ background: '#fffbeb', borderLeft: '3px solid var(--golden-orange)', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: 'var(--dark-amaranth)' }}>Datos Pago Móvil Tropicalia:</strong><br />
                    Banco: <strong>Banesco (0134)</strong> • RIF/CI: <strong>V-24.123.456</strong> • Teléfono: <strong>0412-1234567</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Banco Origen:</label>
                      <select value={pmBanco} onChange={e => setPmBanco(e.target.value)} required>
                        <option value="">Seleccione el banco...</option>
                        <option value="0134 - Banesco">0134 - Banesco</option>
                        <option value="0102 - Banco de Venezuela">0102 - Banco de Venezuela</option>
                        <option value="0105 - Mercantil">0105 - Mercantil</option>
                        <option value="0108 - Provincial">0108 - Provincial</option>
                        <option value="0191 - BNC">0191 - BNC</option>
                        <option value="0172 - Bancamiga">0172 - Bancamiga</option>
                        <option value="Otro Banco">Otro Banco Nacional</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Teléfono Origen:</label>
                      <input type="tel" value={pmTelefono} onChange={e => setPmTelefono(e.target.value)} required placeholder="Ej: 04121234567" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Referencia (últimos 4 o 6 dígitos):</label>
                      <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} maxLength={8} required placeholder="Ej: 849201" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Monto en Bs (BCV):</label>
                      <input type="text" readOnly value={formatBs(totalBs)} style={{ color: '#065f46', fontWeight: 'bold' }} />
                    </div>
                  </div>
                </div>
              )}

              {(metodoPago === 'efectivo' || metodoPago === 'efectivo_bs') && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button
                      type="button"
                      onClick={() => setMetodoPago('efectivo')}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '8px',
                        border: metodoPago === 'efectivo' ? '2px solid #059669' : '1px solid #d1d5db',
                        background: metodoPago === 'efectivo' ? '#ecfdf5' : '#ffffff',
                        color: '#065f46',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                      }}
                    >
                      Divisas ($ USD)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMetodoPago('efectivo_bs')}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '8px',
                        border: metodoPago === 'efectivo_bs' ? '2px solid #059669' : '1px solid #d1d5db',
                        background: metodoPago === 'efectivo_bs' ? '#ecfdf5' : '#ffffff',
                        color: '#065f46',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                      }}
                    >
                      Bolívares (Bs)
                    </button>
                  </div>

                  <div style={{ background: '#fffbeb', borderLeft: '3px solid var(--golden-orange)', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: 'var(--dark-amaranth)' }}>
                      {metodoPago === 'efectivo' ? 'Efectivo en Divisas ($ USD):' : 'Efectivo en Bolívares (Bs):'}
                    </strong><br />
                    Total a pagar al recibir: <strong>{metodoPago === 'efectivo' ? formatUsd(totalUsd) : formatBs(totalBs)}</strong>.
                  </div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>
                    ¿Con qué billete vas a pagar? (Para preparar vuelto exacto):
                  </label>
                  <input type="text" value={efectivoBillete} onChange={e => setEfectivoBillete(e.target.value)} required={metodoPago === 'efectivo'} placeholder="Ej: Billete de $20 / Pago exacto" />
                </div>
              )}

              {metodoPago === 'kontigo' && (
                <div>
                  <div style={{ background: '#fff7ed', borderLeft: '3px solid #ff6b00', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: '#c2410c' }}>Datos Kontigo Tropicalia:</strong><br />
                    Usuario / Teléfono Kontigo: <strong>@tropicalia.crb</strong> • Total: <strong>{formatUsd(totalUsd)}</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Tu usuario o teléfono Kontigo:</label>
                      <input type="text" value={kontigoUsuario} onChange={e => setKontigoUsuario(e.target.value)} required placeholder="Ej: @usuario o 04141234567" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Referencia Kontigo:</label>
                      <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Ej: KT-94820" />
                    </div>
                  </div>
                </div>
              )}

              {metodoPago === 'paypal' && (
                <div>
                  <div style={{ background: '#eff6ff', borderLeft: '3px solid #003087', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: '#003087' }}>Datos PayPal Tropicalia:</strong><br />
                    Correo PayPal: <strong>pagos@tropicalia.com</strong> • Total: <strong>{formatUsd(totalUsd)}</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Tu correo PayPal emisor:</label>
                      <input type="email" value={paypalCorreo} onChange={e => setPaypalCorreo(e.target.value)} required placeholder="Ej: cliente@gmail.com" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>ID de transacción PayPal:</label>
                      <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Ej: 4X9810283L" />
                    </div>
                  </div>
                </div>
              )}

              {metodoPago === 'punto' && (
                <div>
                  <div style={{ background: '#fffbeb', borderLeft: '3px solid var(--golden-orange)', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: 'var(--dark-amaranth)' }}>Pago por Punto de Venta:</strong><br />
                    El repartidor llevará el punto inalámbrico a tu puerta.
                  </div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Tipo de Tarjeta:</label>
                  <select value={puntoTipo} onChange={e => setPuntoTipo(e.target.value)}>
                    <option value="Débito">Tarjeta de Débito / Maestro</option>
                    <option value="Crédito">Tarjeta de Crédito</option>
                    <option value="Internacional">Tarjeta Internacional (Contactless)</option>
                  </select>
                </div>
              )}

              {metodoPago === 'binance' && (
                <div>
                  <div style={{ background: '#fffbeb', borderLeft: '3px solid #f3ba2f', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: '#92400e' }}>Datos Binance Pay Tropicalia:</strong><br />
                    Pay ID: <strong>238192847</strong> • Monto USDT neto: <strong>{formatUsd(totalUsd)}</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Tu Binance Pay ID o Correo:</label>
                      <input type="text" value={binanceId} onChange={e => setBinanceId(e.target.value)} required placeholder="Ej: 8934123 o user@binance" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Referencia Binance:</label>
                      <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Opcional" />
                    </div>
                  </div>
                </div>
              )}

              {metodoPago === 'zelle' && (
                <div>
                  <div style={{ background: '#f5f3ff', borderLeft: '3px solid #6d1ed4', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: '#5b21b6' }}>Datos Zelle Tropicalia:</strong><br />
                    Correo Zelle: <strong>pagos@tropicalia.com</strong> • Titular: <strong>Tropicalia C.A.</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Titular de la cuenta Zelle:</label>
                      <input type="text" value={zelleTitular} onChange={e => setZelleTitular(e.target.value)} required placeholder="Ej: Maria Gonzalez" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Código o Referencia Zelle:</label>
                      <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Ej: ZL-839210" />
                    </div>
                  </div>
                </div>
              )}

              {metodoPago === 'zinli' && (
                <div>
                  <div style={{ background: '#f5f3ff', borderLeft: '3px solid #59359a', padding: '10px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.83rem', color: '#1f2937' }}>
                    <strong style={{ color: '#59359a' }}>Datos Zinli Tropicalia:</strong><br />
                    Usuario Zinli: <strong>zinli@tropicalia.com</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Correo o Teléfono Zinli Emisor:</label>
                      <input type="text" value={zinliEmisor} onChange={e => setZinliEmisor(e.target.value)} required placeholder="Ej: usuario@correo.com" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)' }}>Referencia de Transacción:</label>
                      <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Ej: 993812" />
                    </div>
                  </div>
                </div>
              )}

              {/* ADJUNTAR COMPROBANTE DIGITAL */}
              {['pago_movil', 'binance', 'zelle', 'zinli', 'kontigo', 'paypal'].includes(metodoPago) && (
                <div style={{ marginTop: '10px', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                    <Paperclip size={13} /> Adjuntar captura o comprobante de pago (Opcional):
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setComprobanteFile(e.target.files[0] || null)}
                    style={{ padding: '8px', background: '#dedede', borderRadius: '8px', width: '100%', boxSizing: 'border-box', fontSize: '0.8rem' }}
                  />
                </div>
              )}
            </div>

            {/* Verificación de Seguridad Anti-Bot Zero-Trust */}
            <SecurityVerification
              action="checkout"
              onVerify={(_, valid) => setBotVerified(valid)}
            />

            <button
              type="submit"
              className="btn-primario"
              style={{ width: '100%', padding: '14px', fontSize: '1rem', borderRadius: '10px' }}
              disabled={submitting}
            >
              {submitting ? 'Procesando tu orden...' : `Confirmar y Enviar Pedido (${formatUsd(totalUsd)})`}
            </button>
          </form>
        )}

      </div>
    </div>
  );
}

