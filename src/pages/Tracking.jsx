import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { supabase } from '../lib/supabase';
import { cancelarOrdenConReversion } from '../services/inventoryService';
import { formatUsd } from '../services/bcvService';

export default function Tracking() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const orderId = searchParams.get('order_id') || localStorage.getItem('tropicalia_last_order_id');

  const [orden, setOrden] = useState(null);
  const [driverName, setDriverName] = useState('Repartidor asignado');
  const [loading, setLoading] = useState(true);

  // Estados de cancelación
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('Agregué platos por error');
  const [cancelling, setCancelling] = useState(false);
  const [cancelFeedback, setCancelFeedback] = useState('');

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const restMarkerRef = useRef(null);
  const driverMarkerRef = useRef(null);

  useEffect(() => {
    if (!orderId) {
      navigate('/');
      return;
    }

    cargarOrden();

    // Suscripción Realtime en Supabase
    const channel = supabase.channel(`tracking-${orderId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`
      }, () => {
        cargarOrden();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [orderId]);

  async function cargarOrden() {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, businesses(name, phone, lat, lng)')
        .eq('id', orderId)
        .maybeSingle();

      if (error || !data) {
        console.warn('Error cargando orden:', error);
        setLoading(false);
        return;
      }

      setOrden(data);

      if (data.driver_id) {
        const { data: driver } = await supabase
          .from('driver_profiles')
          .select('full_name')
          .eq('id', data.driver_id)
          .maybeSingle();

        if (driver?.full_name) {
          setDriverName(driver.full_name);
        }
      }

      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  // Inicializar o actualizar mapa Leaflet
  useEffect(() => {
    if (!orden || !mapContainerRef.current) return;

    const latRest = orden.businesses?.lat ? parseFloat(orden.businesses.lat) : 10.4880;
    const lngRest = orden.businesses?.lng ? parseFloat(orden.businesses.lng) : -66.8650;
    const coordsCocina = [latRest, lngRest];

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapContainerRef.current).setView(coordsCocina, 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(mapInstanceRef.current);
    }

    const mapa = mapInstanceRef.current;

    // Marcador Cocina / Punto de Retiro
    if (!restMarkerRef.current) {
      const popupText = orden.delivery_type === 'pickup'
        ? `<strong>🏪 Punto de Retiro: ${orden.businesses?.name || 'Tropicalia'}</strong><br>Retira tu orden aquí`
        : `<strong>👨‍🍳 ${orden.businesses?.name || 'Restaurante'}</strong><br>Preparando tu pedido`;

      restMarkerRef.current = L.marker(coordsCocina).addTo(mapa)
        .bindPopup(popupText)
        .openPopup();
    }

    // Marcador Repartidor (solo si es delivery y está en camino)
    if (orden.delivery_type !== 'pickup' && orden.status === 'on_the_way') {
      const coordsDriver = [latRest - 0.0035, lngRest - 0.006];
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = L.marker(coordsDriver, {
          icon: L.divIcon({
            className: 'driver-live-pin',
            html: '<div style="background:#10b981; border:3px solid #fff; border-radius:50%; width:22px; height:22px; box-shadow:0 0 12px rgba(16,185,129,0.9);"></div>',
            iconSize: [22, 22]
          })
        }).addTo(mapa).bindPopup(`<strong>🛵 ${driverName}</strong><br>En camino a tu ubicación`);
      } else {
        driverMarkerRef.current.setLatLng(coordsDriver);
      }
      mapa.setView(coordsDriver, 15);
    } else {
      mapa.setView(coordsCocina, 15);
    }

    if (orden.status === 'delivered') {
      localStorage.removeItem('tropicalia_last_order_id');
    }

  }, [orden, driverName]);

  async function handleConfirmarCancelacion(e) {
    e.preventDefault();
    if (!orden) return;

    setCancelling(true);
    setCancelFeedback('');

    try {
      const res = await cancelarOrdenConReversion(orden.id, motivoCancelacion, 'cliente');
      setCancelling(false);
      setShowCancelModal(false);
      setCancelFeedback(`✅ Tu pedido ha sido cancelado exitosamente. Se han reintegrado ${res.reversionCount || 0} artículos al inventario disponible.`);
      await cargarOrden();
    } catch (err) {
      setCancelling(false);
      alert('No se pudo cancelar el pedido: ' + err.message);
    }
  }

  const esPickup = orden?.delivery_type === 'pickup';

  function getStepPhase() {
    if (!orden) return 1;
    if (orden.status === 'pending_payment_verification' || orden.status === 'pending') return 1;
    if (orden.status === 'cooking') return 2;
    if (orden.status === 'ready' || orden.status === 'on_the_way') return 3;
    if (orden.status === 'delivered') return 4;
    return 1;
  }

  const phase = getStepPhase();
  const esCancelable = orden && !['delivered', 'cancelled', 'rejected'].includes(orden.status);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#ffffff', paddingBottom: '90px' }}>
      
      {/* HEADER OFICIAL FIGMA */}
      <header className="figma-header" style={{ marginBottom: '20px' }}>
        <div className="figma-header-top" style={{ marginBottom: 0 }}>
          <Link to="/" style={{ color: '#ffffff', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
            ← Volver a la Tienda
          </Link>
          <span style={{ background: 'rgba(255, 255, 255, 0.2)', color: '#ffffff', padding: '4px 12px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 800 }}>
            {orderId ? `#ORD-${orderId.slice(0, 8)}` : ''}
          </span>
        </div>
        <h1 style={{ fontSize: '1.45rem', margin: '10px 0 0 0', color: '#ffffff' }}>
          {esPickup ? 'Seguimiento de Retiro en Barra' : 'Seguimiento en Vivo'}
        </h1>
        <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
          {orden?.businesses?.name || 'Tropicalia Delivery Express'} • {esPickup ? '🥡 Retiro en Local' : '🛵 Delivery a Domicilio'}
        </p>
      </header>

      <div style={{ padding: '0 20px' }}>

        {cancelFeedback && (
          <div style={{ background: '#ecfdf5', border: '1px solid #10b981', color: '#065f46', padding: '12px 16px', borderRadius: '16px', fontSize: '0.85rem', marginBottom: '16px', fontWeight: 600 }}>
            {cancelFeedback}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', background: '#f9fafb', borderRadius: '20px', border: '1px solid #e5e7eb' }}>
            <p style={{ color: 'var(--text-muted)' }}>Cargando estado del pedido...</p>
          </div>
        ) : !orden ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', background: '#f9fafb', borderRadius: '20px', border: '1px solid #e5e7eb' }}>
            <p style={{ color: '#b91c1c' }}>No se encontró la comanda solicitada.</p>
            <Link to="/" className="btn-primario" style={{ marginTop: '12px' }}>Ir al Catálogo</Link>
          </div>
        ) : (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '20px',
            padding: '20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)'
          }}>
            
            {/* ESTADO ENCABEZADO */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <span className="badge badge-on_the_way" style={{
                marginBottom: '8px',
                background: orden.status === 'cancelled' ? '#ef4444' : orden.status === 'ready' ? 'var(--golden-orange)' : undefined,
                color: orden.status === 'ready' ? '#000000' : undefined
              }}>
                {orden.status === 'pending_payment_verification' && 'Validando Pago'}
                {orden.status === 'pending' && 'En Cola de Cocina'}
                {orden.status === 'cooking' && '👨‍🍳 En Preparación'}
                {orden.status === 'ready' && (esPickup ? '🥡 ¡Listo en Mostrador!' : '📦 Empacado / Listo')}
                {orden.status === 'on_the_way' && '🛵 Conductor en Ruta'}
                {orden.status === 'delivered' && (esPickup ? '🎉 Retirado en Mostrador' : '🎉 Pedido Entregado')}
                {orden.status === 'cancelled' && '❌ Pedido Cancelado'}
              </span>

              <h2 style={{ fontSize: '1.35rem', margin: '6px 0 2px 0', color: orden.status === 'cancelled' ? '#dc2626' : 'var(--dark-amaranth)' }}>
                {orden.status === 'pending_payment_verification' && 'Verificando Comprobante'}
                {orden.status === 'pending' && 'Comanda Recibida en Cocina'}
                {orden.status === 'cooking' && (esPickup ? 'Tus platos están en los fogones' : 'Tu comida está en la Cocina')}
                {orden.status === 'ready' && (esPickup ? '🥡 ¡Tu comida está lista en la barra!' : '¡Pedido Empacado! Asignando Repartidor')}
                {orden.status === 'on_the_way' && '¡El Repartidor va en camino!'}
                {orden.status === 'delivered' && (esPickup ? '🎉 ¡Comida entregada en barra!' : '🎉 ¡Pedido Entregado con éxito!')}
                {orden.status === 'cancelled' && 'Pedido Cancelado'}
              </h2>

              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                {orden.businesses?.name || 'Restaurante Aliado'} • {esPickup ? 'Mostrador de Despacho' : 'Entrega a Domicilio'}
              </p>
            </div>

            {/* STEPPER DINÁMICO (ADAPTADO A PICKUP O DELIVERY) */}
            {orden.status !== 'cancelled' && (
              <div className="stepper" style={{ marginBottom: '24px' }}>
                <div className={`step ${phase === 1 ? 'active' : ''} ${phase > 1 ? 'completed' : ''}`}>
                  <div className="step-icon">1</div>
                  <span className="step-title">Confirmado</span>
                </div>
                <div className={`step ${phase === 2 ? 'active' : ''} ${phase > 2 ? 'completed' : ''}`}>
                  <div className="step-icon">2</div>
                  <span className="step-title">En Cocina</span>
                </div>
                <div className={`step ${phase === 3 ? 'active' : ''} ${phase > 3 ? 'completed' : ''}`}>
                  <div className="step-icon">3</div>
                  <span className="step-title">{esPickup ? 'Listo en Barra' : 'En Camino'}</span>
                </div>
                <div className={`step ${phase === 4 ? 'active' : ''}`}>
                  <div className="step-icon">4</div>
                  <span className="step-title">{esPickup ? 'Retirado' : 'Entregado'}</span>
                </div>
              </div>
            )}

            {/* NOTIFICACIÓN Y CÓDIGO DE RETIRO PARA CLIENTES PICKUP */}
            {esPickup && orden.status === 'ready' && (
              <div style={{
                background: '#fffbeb',
                border: '2px solid var(--golden-orange)',
                borderRadius: '16px',
                padding: '18px',
                textAlign: 'center',
                marginBottom: '20px'
              }}>
                <span style={{ fontSize: '2rem' }}>🥡</span>
                <strong style={{ color: 'var(--dark-amaranth)', fontSize: '1.05rem', display: 'block', marginTop: '4px' }}>
                  ¡TU COMIDA TE ESPERA EN LA BARRA!
                </strong>
                <p style={{ margin: '6px 0 12px 0', fontSize: '0.85rem', color: '#4b5563' }}>
                  Acércate al mostrador de <strong>{orden.businesses?.name}</strong> y muestra este código de retiro:
                </p>
                <div style={{
                  fontSize: '2.4rem',
                  letterSpacing: '6px',
                  fontWeight: 900,
                  color: 'var(--dark-amaranth)',
                  background: '#ffffff',
                  padding: '8px 16px',
                  borderRadius: '12px',
                  display: 'inline-block',
                  border: '1px solid #fde68a',
                  marginBottom: '10px'
                }}>
                  {orden.delivery_code || (orden.id || '').slice(0, 4).toUpperCase()}
                </div>
                <small style={{ color: '#78350f', display: 'block', fontWeight: 600 }}>
                  A nombre de: {orden.customer_name}
                </small>
              </div>
            )}

            {/* CÓDIGO SEGURO DE ENTREGA PARA CLIENTES DELIVERY */}
            {!esPickup && orden.status === 'on_the_way' && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1.5px solid #10b981',
                borderRadius: '16px',
                padding: '16px',
                textAlign: 'center',
                marginBottom: '20px'
              }}>
                <strong style={{ color: '#047857', fontSize: '0.88rem', display: 'block' }}>
                  🔑 CÓDIGO SEGURO DE ENTREGA
                </strong>
                <div style={{
                  fontSize: '2.2rem',
                  letterSpacing: '6px',
                  fontWeight: 900,
                  color: 'var(--dark-amaranth)',
                  margin: '8px 0'
                }}>
                  {orden.delivery_code || '4821'}
                </div>
                <small style={{ color: '#065f46' }}>
                  Dicta este código al repartidor ({driverName}) solo cuando tengas la bolsa sellada en tus manos.
                </small>
              </div>
            )}

            {/* MENSAJE EXPLICATIVO DEL ESTADO */}
            <div style={{ background: '#f8f9fb', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', marginBottom: '20px' }}>
              <p style={{ margin: 0, fontSize: '0.86rem', color: '#4b5563' }}>
                {orden.status === 'pending_payment_verification' && '⏳ Tu comprobante de pago está siendo verificado. En cuanto sea confirmado, la cocina comenzará de inmediato.'}
                {orden.status === 'pending' && '👨‍🍳 La orden fue recibida por la cocina e ingresó al tren de preparación.'}
                {orden.status === 'cooking' && (esPickup
                  ? '🔥 Los cocineros están preparando tus platos al momento. Puedes ir acercándote al restaurante para retirarlo recién salido del fuego.'
                  : '🔥 Los cocineros están preparando tus platos con sello térmico de seguridad.')}
                {orden.status === 'ready' && (esPickup
                  ? `🥡 Tu pedido está empacado en barra de ${orden.businesses?.name || 'el local'}. Pasa al mostrador indicando tu nombre o código.`
                  : '📦 El pedido está sellado y listo en barra esperando la asignación o llegada del repartidor.')}
                {orden.status === 'on_the_way' && `🛵 ${driverName} ya retiró tu comida y se desplaza hacia tu dirección.`}
                {orden.status === 'delivered' && '🎉 Entrega completada exitosamente. ¡Gracias por preferir Tropicalia!'}
                {orden.status === 'cancelled' && `❌ Esta orden fue cancelada. Motivo: ${orden.notes || 'Cancelada por el usuario'}.`}
              </p>
            </div>

            {/* BOTÓN CÓMO LLEGAR AL LOCAL PARA PICKUP */}
            {esPickup && orden.businesses?.lat && (
              <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                <a
                  href={`https://www.google.com/maps?q=${orden.businesses.lat},${orden.businesses.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primario"
                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
                >
                  🗺️ Abrir ruta a {orden.businesses.name} en Google Maps
                </a>
              </div>
            )}

            {/* MAPA DE SEGUIMIENTO */}
            <div style={{ height: '300px', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
              <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
            </div>

            {/* BOTÓN CANCELAR PEDIDO (CON REVERSIÓN DE STOCK) */}
            {esCancelable && (
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '16px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => setShowCancelModal(true)}
                  style={{
                    background: '#fef2f2',
                    border: '1.5px solid #f87171',
                    color: '#b91c1c',
                    padding: '10px 20px',
                    borderRadius: '999px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ✕ Cancelar este pedido
                </button>
                <small style={{ display: 'block', color: '#9ca3af', marginTop: '6px', fontSize: '0.75rem' }}>
                  Los artículos serán devueltos automáticamente al stock disponible.
                </small>
              </div>
            )}

          </div>
        )}

      </div>

      {/* MODAL DE CONFIRMACIÓN DE CANCELACIÓN */}
      {showCancelModal && (
        <div className="modal-figma-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>¿Deseas cancelar tu pedido?</h3>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#4b5563', margin: '0 0 14px 0' }}>
              {orden?.status === 'cooking'
                ? '⚠️ La cocina ya comenzó a preparar tus platos. Al cancelar, los insumos y artículos serán devueltos de inmediato al inventario.'
                : 'Al cancelar tu orden, se anulará la comanda y los artículos volverán al inventario disponible.'}
            </p>

            <form onSubmit={handleConfirmarCancelacion}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                Indícanos el motivo de la cancelación:
              </label>
              <select
                value={motivoCancelacion}
                onChange={e => setMotivoCancelacion(e.target.value)}
                className="form-input-figma"
                required
              >
                <option value="Agregué platos por error">Agregué platos por error / cambiar ítems</option>
                <option value="Demora en el tiempo de espera">Tiempo de espera mayor al esperado</option>
                <option value="Cambio de planes o emergencia">Cambio de planes o emergencia personal</option>
                <option value="Problemas con el método de pago">Inconveniente con el método de pago</option>
                <option value="Otro motivo">Otro motivo</option>
              </select>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="btn-secundario"
                  style={{ flex: 1 }}
                  disabled={cancelling}
                >
                  Mantener Pedido
                </button>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    background: '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '999px',
                    fontWeight: 800,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                    padding: '12px'
                  }}
                  disabled={cancelling}
                >
                  {cancelling ? 'Revirtiendo...' : 'Confirmar Cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
