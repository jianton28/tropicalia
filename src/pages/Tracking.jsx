import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { supabase } from '../lib/supabase';

export default function Tracking() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const orderId = searchParams.get('order_id') || localStorage.getItem('tropicalia_last_order_id');

  const [orden, setOrden] = useState(null);
  const [driverName, setDriverName] = useState('Repartidor asignado');
  const [loading, setLoading] = useState(true);

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

    // Marcador Cocina
    if (!restMarkerRef.current) {
      restMarkerRef.current = L.marker(coordsCocina).addTo(mapa)
        .bindPopup(`<strong>👨‍🍳 ${orden.businesses?.name || 'Restaurante'}</strong><br>Preparando tu pedido`)
        .openPopup();
    }

    // Marcador Repartidor
    if (orden.status === 'on_the_way') {
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

  function getStepPhase() {
    if (!orden) return 1;
    if (orden.status === 'pending_payment_verification') return 1;
    if (orden.status === 'pending' || orden.status === 'cooking' || orden.status === 'ready') return 2;
    if (orden.status === 'on_the_way') return 3;
    if (orden.status === 'delivered') return 4;
    return 1;
  }

  const phase = getStepPhase();

  return (
    <div className="container" style={{ maxWidth: '720px', marginTop: '28px', marginBottom: '80px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <Link to="/" className="btn-secundario">← Volver a la Tienda</Link>
        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
          {orderId ? `#ORD-${orderId.slice(0, 8)}` : ''}
        </span>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: 'var(--text-muted)' }}>Cargando estado del pedido...</p>
        </div>
      ) : !orden ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: '#fca5a5' }}>No se encontró la comanda solicitada.</p>
          <Link to="/" className="btn-primario" style={{ marginTop: '12px' }}>Ir al Catálogo</Link>
        </div>
      ) : (
        <div className="card">
          
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span className="badge badge-on_the_way" style={{ marginBottom: '8px' }}>
              {orden.status === 'pending_payment_verification' && 'Validando Pago'}
              {(orden.status === 'pending' || orden.status === 'cooking') && 'En Preparación'}
              {orden.status === 'ready' && 'Listo para Despacho'}
              {orden.status === 'on_the_way' && 'Conductor en Ruta'}
              {orden.status === 'delivered' && 'Pedido Entregado'}
            </span>
            <h1 style={{ fontSize: '1.6rem', margin: '6px 0 2px 0', color: '#fff' }}>
              {orden.status === 'pending_payment_verification' && 'Verificando Pago'}
              {(orden.status === 'pending' || orden.status === 'cooking') && 'Tu comida está en la Cocina'}
              {orden.status === 'ready' && '¡Pedido Empacado! Buscando Repartidor'}
              {orden.status === 'on_the_way' && '¡El Repartidor va en camino!'}
              {orden.status === 'delivered' && '🎉 ¡Pedido Entregado!'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              {orden.businesses?.name || 'Restaurante Aliado'}
            </p>
          </div>

          {/* STEPPER */}
          <div className="stepper">
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
              <span className="step-title">En Camino</span>
            </div>
            <div className={`step ${phase === 4 ? 'active' : ''}`}>
              <div className="step-icon">4</div>
              <span className="step-title">Entregado</span>
            </div>
          </div>

          {/* CÓDIGO SEGURO DE ENTREGA (PIN) */}
          {orden.status === 'on_the_way' && (
            <div style={{
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1.5px solid #10b981',
              borderRadius: '10px',
              padding: '16px',
              textAlign: 'center',
              marginBottom: '20px'
            }}>
              <strong style={{ color: '#34d399', fontSize: '0.9rem', display: 'block' }}>
                🔑 CÓDIGO SEGURO DE ENTREGA
              </strong>
              <div style={{
                fontSize: '2.2rem',
                letterSpacing: '6px',
                fontWeight: 900,
                color: '#fff',
                margin: '8px 0'
              }}>
                {orden.delivery_code || '4821'}
              </div>
              <small style={{ color: '#a7f3d0' }}>
                Dicta este código al repartidor ({driverName}) solo cuando tengas la bolsa sellada en tus manos.
              </small>
            </div>
          )}

          {/* MENSAJE EXPLICATIVO */}
          <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
            <p style={{ margin: 0, fontSize: '0.86rem', color: '#ccc' }}>
              {orden.status === 'pending_payment_verification' && '⏳ Tu comprobante de pago está siendo verificado. En cuanto sea confirmado, la cocina comenzará de inmediato.'}
              {orden.status === 'pending' && '👨‍🍳 La orden fue recibida por la cocina e ingresó al tren de preparación.'}
              {orden.status === 'cooking' && '🔥 Los cocineros están preparando tus platos con sello térmico de seguridad.'}
              {orden.status === 'ready' && '📦 El pedido está sellado y listo en barra esperando la asignación o llegada del repartidor.'}
              {orden.status === 'on_the_way' && `🛵 ${driverName} ya retiró tu comida y se desplaza hacia tu dirección.`}
              {orden.status === 'delivered' && '🎉 Entrega completada exitosamente. ¡Gracias por preferir Tropicalia!'}
            </p>
          </div>

          {/* MAPA DE SEGUIMIENTO */}
          <div style={{ height: '320px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #333' }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
          </div>

        </div>
      )}

    </div>
  );
}

