import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { fetchTasaBCV, toBs, formatUsd, formatBs } from '../services/bcvService';

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.2, R * c * 1.25);
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

  const [tasaBCV, setTasaBCV] = useState(875.65);
  const [coordsRestaurante, setCoordsRestaurante] = useState({ lat: 10.4806, lng: -66.9036 });
  const [distanciaKm, setDistanciaKm] = useState(1.5);
  const [fleteUsd, setFleteUsd] = useState(1.50);

  // Form states
  const [modalidad, setModalidad] = useState('delivery');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
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
  const [puntoTipo, setPuntoTipo] = useState('Débito');
  const [efectivoBillete, setEfectivoBillete] = useState('');
  const [comprobanteFile, setComprobanteFile] = useState(null);

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cart.length === 0 || !businessId) {
      alert('Tu carrito está vacío. Agrega platos desde el menú.');
      navigate('/');
      return;
    }

    fetchTasaBCV().then(r => setTasaBCV(r));

    // Cargar coordenadas del restaurante
    async function cargarRestaurante() {
      const { data: neg } = await supabase
        .from('businesses')
        .select('name, lat, lng')
        .eq('id', businessId)
        .maybeSingle();

      if (neg && neg.lat && neg.lng) {
        setCoordsRestaurante({
          lat: parseFloat(neg.lat),
          lng: parseFloat(neg.lng)
        });
      }
    }
    cargarRestaurante();

    // Auto-completar datos si el usuario tiene sesión
    if (user?.user_metadata) {
      if (user.user_metadata.full_name) setNombre(user.user_metadata.full_name);
      if (user.user_metadata.phone) setTelefono(user.user_metadata.phone);
    }
  }, [cart, businessId, navigate, user]);

  // Cálculos financieros
  const subtotalComida = cart.reduce((acc, el) => acc + (parseFloat(el.price) * (el.quantity || 1)), 0);
  const costoDelivery = modalidad === 'delivery' ? fleteUsd : 0.00;
  const propinaMotorizado = modalidad === 'delivery' ? propina : 0.00;
  const totalUsd = subtotalComida + costoDelivery + propinaMotorizado;
  const totalBs = toBs(totalUsd, tasaBCV);

  function handleManualDistance(kmValue) {
    const km = parseFloat(kmValue);
    setDistanciaKm(km);
    setFleteUsd(calcularTarifaPorKm(km));
  }

  function handleCapturarGPS() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización. Selecciona la distancia aproximada.');
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const gmaps = `https://www.google.com/maps?q=${lat},${lng}`;
        setMapUrl(gmaps);

        const km = calcularDistanciaKm(coordsRestaurante.lat, coordsRestaurante.lng, lat, lng);
        setDistanciaKm(km);
        setFleteUsd(calcularTarifaPorKm(km));

        if (!direccion) {
          setDireccion(`Ubicación GPS exacta (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        }
        setGpsLoading(false);
        setGpsStatus(`✅ GPS Listo (${km.toFixed(1)} km)`);
      },
      () => {
        setGpsLoading(false);
        alert('No se pudo obtener el GPS automático. Puedes seleccionar la distancia aproximada manualmente.');
      },
      { enableHighAccuracy: true }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
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
        referenciaFinal = `${referencia} (${pmBanco} - ${pmTelefono})`;
      } else if (metodoPago === 'binance') {
        if (!binanceId) throw new Error('Ingresa tu Binance UID o correo de envío.');
        referenciaFinal = `UID/Email: ${binanceId} (Ref: ${referencia || 'S/R'})`;
      } else if (metodoPago === 'zelle') {
        if (!zelleTitular || !referencia) throw new Error('Ingresa el titular Zelle y la referencia.');
        referenciaFinal = `Zelle: ${zelleTitular} (#${referencia})`;
      } else if (metodoPago === 'zinli') {
        if (!zinliEmisor || !referencia) throw new Error('Ingresa tu usuario Zinli y la referencia.');
        referenciaFinal = `Zinli: ${zinliEmisor} (#${referencia})`;
      } else if (metodoPago === 'punto') {
        referenciaFinal = `Punto (${puntoTipo}) - ${referencia || 'Cobrar con punto'}`;
      } else if (metodoPago === 'efectivo' || metodoPago === 'efectivo_bs') {
        const billete = efectivoBillete || 'Efectivo exacto';
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

      const requiereVerificacion = ['pago_movil', 'binance', 'zelle', 'zinli'].includes(metodoPago);
      const estadoInicial = requiereVerificacion ? 'pending_payment_verification' : 'pending';

      const notasCompletas = [notas, detalleExtraPago].filter(Boolean).join(' • ');

      const payload = {
        business_id: businessId,
        customer_name: nombre,
        customer_phone: telefono,
        delivery_type: modalidad,
        delivery_address: modalidad === 'delivery' ? `${direccion} (~${distanciaKm.toFixed(1)} km)` : 'Retiro en local (Pickup)',
        map_url: mapUrl || null,
        notes: notasCompletas,
        payment_method: metodoPago,
        payment_reference: referenciaFinal,
        payment_receipt_url: urlComprobante,
        items: cart,
        subtotal_food: subtotalComida,
        delivery_fee: costoDelivery,
        driver_tip: propinaMotorizado,
        total: totalUsd,
        total_bs: totalBs,
        status: estadoInicial
      };

      const { data: orden, error: ordenError } = await supabase
        .from('orders')
        .insert([payload])
        .select()
        .single();

      if (ordenError) throw ordenError;

      localStorage.setItem('tropicalia_last_order_id', orden.id);
      clearCart();

      navigate(`/tracking?order_id=${orden.id}`);

    } catch (err) {
      alert('Error al registrar pedido: ' + err.message);
      setSubmitting(false);
    }
  }

  const metodosDisponibles = [
    { id: 'pago_movil', label: 'Pago Móvil', icon: '📱' },
    { id: 'efectivo', label: 'Efectivo ($ USD)', icon: '💵' },
    { id: 'efectivo_bs', label: 'Efectivo (Bs)', icon: '🇻🇪' },
    { id: 'punto', label: 'Punto de Venta', icon: '💳' },
    { id: 'binance', label: 'Binance Pay', icon: '🟡' },
    { id: 'zelle', label: 'Zelle', icon: '🏦' },
    { id: 'zinli', label: 'Zinli', icon: '🟣' }
  ];

  return (
    <div className="container" style={{ maxWidth: '720px', marginTop: '28px', marginBottom: '80px' }}>
      
      {/* NAVEGACIÓN SUPERIOR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <Link to="/" className="btn-secundario">← Seguir comprando</Link>
        <strong style={{ color: 'var(--gold)', fontSize: '1.1rem' }}>Finalizar Compra</strong>
      </div>

      {/* RESUMEN DEL CARRITO */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>🛒 Tu Carrito ({businessName})</h2>
          <button type="button" onClick={clearCart} className="btn-secundario" style={{ fontSize: '0.75rem', padding: '4px 10px', color: '#fca5a5' }}>
            Vaciar
          </button>
        </div>

        <div>
          {cart.map((item, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #242424' }}>
              <div>
                <strong>{item.quantity}x {item.name}</strong>
                <small style={{ color: 'var(--text-muted)', display: 'block' }}>{formatUsd(item.price)} c/u</small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong>{formatUsd(item.price * item.quantity)}</strong>
                <button type="button" onClick={() => changeQuantity(idx, -1)} className="btn-secundario" style={{ padding: '2px 8px' }}>-</button>
                <button type="button" onClick={() => changeQuantity(idx, 1)} className="btn-secundario" style={{ padding: '2px 8px' }}>+</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', marginTop: '12px', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Subtotal Comida:</span>
            <strong>{formatUsd(subtotalComida)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Costo de Delivery <small style={{ color: '#fbbf24' }}>{modalidad === 'delivery' ? `(~${distanciaKm.toFixed(1)} km)` : '(Pickup Gratis)'}</small>:
            </span>
            <strong>{formatUsd(costoDelivery)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Propina Repartidor:</span>
            <strong>{formatUsd(propinaMotorizado)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', color: 'var(--gold)', borderTop: '1px dashed #333', paddingTop: '8px' }}>
            <strong>Total a Pagar:</strong>
            <strong>{formatUsd(totalUsd)}</strong>
          </div>
          <div style={{ textAlign: 'right', color: '#34d399', fontSize: '0.85rem', fontWeight: 600 }}>
            Monto en Bolívares (BCV): {formatBs(totalBs)}
          </div>
        </div>
      </div>

      {/* FORMULARIO DE PAGO Y DESPACHO */}
      <form onSubmit={handleSubmit} className="card">
        <h3 style={{ marginTop: 0, color: 'var(--gold)', fontSize: '1.1rem' }}>1. Datos de Contacto y Entrega</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div>
            <label>Nombre y Apellido:</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} required placeholder="Ej: Jimmie Hamilton" />
          </div>
          <div>
            <label>Teléfono (WhatsApp activo):</label>
            <input type="tel" value={telefono} onChange={e => setTelefono(e.target.value)} required placeholder="Ej: 04141234567" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '6px' }}>
          <div>
            <label>Tipo de Pedido:</label>
            <select value={modalidad} onChange={e => setModalidad(e.target.value)}>
              <option value="delivery">🛵 Delivery a Domicilio</option>
              <option value="pickup">🥡 Retiro en el Local (Pickup)</option>
            </select>
          </div>
          {modalidad === 'delivery' && (
            <div>
              <label>Distancia Estimada de Entrega:</label>
              <select value={distanciaKm.toString()} onChange={e => handleManualDistance(e.target.value)}>
                <option value="1.0">0 a 1 km (Tarifa Mínima $1.00)</option>
                <option value="1.5">1.5 km (~$1.25)</option>
                <option value="2.5">2.5 km (~$1.75)</option>
                <option value="4.0">4.0 km (~$2.50)</option>
                <option value="6.0">6.0 km (~$3.50)</option>
                <option value="9.0">9.0 km o más ($5.00)</option>
              </select>
            </div>
          )}
        </div>

        {modalidad === 'delivery' && (
          <div style={{ marginTop: '6px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
              <button
                type="button"
                onClick={handleCapturarGPS}
                className="btn-secundario"
                disabled={gpsLoading}
                style={{ fontSize: '0.82rem' }}
              >
                {gpsLoading ? '⏳ Calculando GPS...' : (gpsStatus || '📍 Calcular con mi GPS actual')}
              </button>
              <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 600 }}>
                🛵 Flete: {formatUsd(fleteUsd)}
              </span>
            </div>
            <label>Dirección exacta / Punto de referencia:</label>
            <input
              type="text"
              value={direccion}
              onChange={e => setDireccion(e.target.value)}
              required={modalidad === 'delivery'}
              placeholder="Ej: Urb. Las Mercedes, Calle París, Edif. Altamira, Apto 4-B"
            />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div>
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
            <label>Instrucciones de cocina o entrega:</label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej: Sin cebolla, tocar timbre 4B"
            />
          </div>
        </div>

        {/* 2. MÉTODO DE PAGO */}
        <h3 style={{ marginTop: '24px', color: 'var(--gold)', fontSize: '1.1rem' }}>2. Método de Pago</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', margin: '8px 0 16px 0' }}>
          {metodosDisponibles.map(m => (
            <div
              key={m.id}
              onClick={() => setMetodoPago(m.id)}
              style={{
                background: metodoPago === m.id ? 'rgba(251, 191, 36, 0.12)' : '#161616',
                borderColor: metodoPago === m.id ? 'var(--gold)' : '#2e2e2e',
                borderWidth: '1.5px',
                borderStyle: 'solid',
                borderRadius: '10px',
                padding: '12px 8px',
                textAlign: 'center',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span style={{ fontSize: '1.35rem' }}>{m.icon}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: metodoPago === m.id ? 'var(--gold)' : '#e5e7eb' }}>
                {m.label}
              </span>
            </div>
          ))}
        </div>

        {/* CAMPOS DINÁMICOS POR MÉTODO */}
        <div style={{ background: '#141414', border: '1px solid #2e2e2e', borderRadius: '10px', padding: '16px', marginBottom: '18px' }}>
          {metodoPago === 'pago_movil' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Datos Pago Móvil Tropicalia:</strong><br />
                Banco: <strong>Banesco (0134)</strong> • RIF/CI: <strong>V-24.123.456</strong> • Teléfono: <strong>0412-1234567</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Banco Origen:</label>
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
                  <label>Teléfono Origen:</label>
                  <input type="tel" value={pmTelefono} onChange={e => setPmTelefono(e.target.value)} required placeholder="Ej: 04121234567" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '6px' }}>
                <div>
                  <label>Referencia (últimos 4 o 6 dígitos):</label>
                  <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} maxLength={8} required placeholder="Ej: 849201" />
                </div>
                <div>
                  <label>Monto Pagado en Bs (BCV):</label>
                  <input type="text" readOnly value={formatBs(totalBs)} style={{ color: '#34d399', fontWeight: 'bold' }} />
                </div>
              </div>
            </div>
          )}

          {metodoPago === 'efectivo' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Efectivo en Divisas ($ USD):</strong><br />
                Total a pagar al recibir: <strong>{formatUsd(totalUsd)}</strong>.
              </div>
              <label>¿Con qué billete vas a pagar? (Para preparar vuelto exacto):</label>
              <input type="text" value={efectivoBillete} onChange={e => setEfectivoBillete(e.target.value)} required placeholder="Ej: Billete de $20 / Pago exacto" />
            </div>
          )}

          {metodoPago === 'efectivo_bs' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Efectivo en Bolívares (Bs):</strong><br />
                Total a entregar al recibir: <strong>{formatBs(totalBs)}</strong>.
              </div>
              <label>Observación sobre efectivo (Opcional):</label>
              <input type="text" value={efectivoBillete} onChange={e => setEfectivoBillete(e.target.value)} placeholder="Ej: Sencillo en billetes nuevos" />
            </div>
          )}

          {metodoPago === 'punto' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Pago por Punto de Venta:</strong><br />
                El repartidor llevará el punto inalámbrico a tu puerta.
              </div>
              <label>Tipo de Tarjeta:</label>
              <select value={puntoTipo} onChange={e => setPuntoTipo(e.target.value)}>
                <option value="Débito">Tarjeta de Débito / Maestro</option>
                <option value="Crédito">Tarjeta de Crédito</option>
                <option value="Internacional">Tarjeta Internacional (Contactless)</option>
              </select>
            </div>
          )}

          {metodoPago === 'binance' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Datos Binance Pay Tropicalia:</strong><br />
                Pay ID: <strong>238192847</strong> • Monto USDT neto: <strong>{formatUsd(totalUsd)}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Tu Binance Pay ID o Correo:</label>
                  <input type="text" value={binanceId} onChange={e => setBinanceId(e.target.value)} required placeholder="Ej: 8934123 o user@binance" />
                </div>
                <div>
                  <label>Referencia Binance:</label>
                  <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Opcional" />
                </div>
              </div>
            </div>
          )}

          {metodoPago === 'zelle' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Datos Zelle Tropicalia:</strong><br />
                Correo Zelle: <strong>pagos@tropicalia.com</strong> • Titular: <strong>Tropicalia C.A.</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Nombre del Titular de la cuenta Zelle:</label>
                  <input type="text" value={zelleTitular} onChange={e => setZelleTitular(e.target.value)} required placeholder="Ej: Maria Gonzalez" />
                </div>
                <div>
                  <label>Código o Referencia Zelle:</label>
                  <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Ej: ZL-839210" />
                </div>
              </div>
            </div>
          )}

          {metodoPago === 'zinli' && (
            <div>
              <div style={{ background: 'rgba(251, 191, 36, 0.08)', borderLeft: '3px solid var(--gold)', padding: '10px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.83rem', color: '#d1d5db' }}>
                <strong style={{ color: 'var(--gold)' }}>Datos Zinli Tropicalia:</strong><br />
                Usuario Zinli: <strong>zinli@tropicalia.com</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label>Correo o Teléfono Zinli Emisor:</label>
                  <input type="text" value={zinliEmisor} onChange={e => setZinliEmisor(e.target.value)} required placeholder="Ej: usuario@correo.com" />
                </div>
                <div>
                  <label>Referencia de Transacción:</label>
                  <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} required placeholder="Ej: 993812" />
                </div>
              </div>
            </div>
          )}

          {/* ADJUNTAR COMPROBANTE DIGITAL */}
          {['pago_movil', 'binance', 'zelle', 'zinli'].includes(metodoPago) && (
            <div style={{ marginTop: '14px', borderTop: '1px solid #282828', paddingTop: '12px' }}>
              <label>📎 Adjuntar captura o comprobante de pago (Opcional):</label>
              <input
                type="file"
                accept="image/*"
                onChange={e => setComprobanteFile(e.target.files[0] || null)}
                style={{ padding: '6px', background: '#1c1c1c' }}
              />
            </div>
          )}
        </div>

        <button
          type="submit"
          className="btn-primario"
          style={{ width: '100%', padding: '14px', fontSize: '1rem' }}
          disabled={submitting}
        >
          {submitting ? 'Procesando tu orden...' : `Confirmar y Enviar Pedido (${formatUsd(totalUsd)})`}
        </button>
      </form>

    </div>
  );
}

