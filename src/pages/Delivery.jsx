import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';

const TECHO_DEUDA = 20.00;

export default function Delivery() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [perfil, setPerfil] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);
  const [pedidosDisponibles, setPedidosDisponibles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal de entrega
  const [mostrarModal, setMostrarModal] = useState(false);
  const [codigoEntrega, setCodigoEntrega] = useState('');
  const [fotoEntrega, setFotoEntrega] = useState(null);
  const [finalizando, setFinalizando] = useState(false);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const driverMarkerRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    initDriver();

    const channel = supabase.channel('delivery-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        cargarCarreraEnCurso();
        cargarCarrerasDisponibles();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user]);

  async function initDriver() {
    setLoading(true);
    let { data: drv } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!drv) {
      const nombre = user.user_metadata?.full_name || 'Repartidor';
      const tlf = user.user_metadata?.phone || 'Sin número';
      const { data: nuevo } = await supabase.from('driver_profiles').insert([{
        id: user.id,
        full_name: nombre,
        phone: tlf,
        is_online: false
      }]).select().single();
      drv = nuevo;
    }

    setPerfil(drv);
    await cargarWallet(user.id);
    await cargarCarreraEnCurso();
    await cargarCarrerasDisponibles();
    initLeafletMap();
    setLoading(false);
  }

  function initLeafletMap() {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const coordsCaracas = [10.4806, -66.9036];
    mapInstanceRef.current = L.map(mapContainerRef.current).setView(coordsCaracas, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(mapInstanceRef.current);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lat, lng], 14);
          driverMarkerRef.current = L.marker([lat, lng], {
            icon: L.divIcon({
              className: 'custom-driver-icon',
              html: '<div style="background:#fbbf24; border:2px solid #000; border-radius:50%; width:16px; height:16px;"></div>',
              iconSize: [16, 16]
            })
          }).addTo(mapInstanceRef.current).bindPopup('Tu ubicación GPS').openPopup();
        }
      });
    }
  }

  async function cargarWallet(driverId) {
    let { data: w } = await supabase
      .from('delivery_wallets')
      .select('*')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (!w) {
      const { data: nw } = await supabase.from('delivery_wallets').insert([{
        driver_id: driverId,
        prepaid_balance: 0.00,
        cash_debt: 0.00,
        debt_ceiling: TECHO_DEUDA,
        is_blocked: false
      }]).select().single();
      w = nw;
    }
    setWallet(w);
  }

  async function toggleDisponibilidad() {
    if (!perfil) return;
    const nuevo = !perfil.is_online;
    const { error } = await supabase
      .from('driver_profiles')
      .update({ is_online: nuevo })
      .eq('id', user.id);

    if (!error) {
      setPerfil({ ...perfil, is_online: nuevo });
      if (nuevo) cargarCarrerasDisponibles();
    }
  }

  async function cargarCarreraEnCurso() {
    const { data: activa } = await supabase
      .from('orders')
      .select('*, businesses(name, phone)')
      .eq('driver_id', user.id)
      .not('status', 'in', '("delivered","cancelled","rejected")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setPedidoActivo(activa || null);
  }

  async function cargarCarrerasDisponibles() {
    const { data: pedidos } = await supabase
      .from('orders')
      .select('*, businesses(name, phone)')
      .eq('delivery_type', 'delivery')
      .is('driver_id', null)
      .in('status', ['pending', 'cooking', 'ready', 'on_the_way'])
      .order('created_at', { ascending: true });

    setPedidosDisponibles(pedidos || []);
  }

  async function aceptarCarrera(ordenId) {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const { data, error } = await supabase
      .from('orders')
      .update({
        driver_id: user.id,
        delivery_status: 'accepted',
        delivery_code: pin
      })
      .eq('id', ordenId)
      .is('driver_id', null)
      .select()
      .maybeSingle();

    if (error || !data) {
      alert('Esta carrera ya fue tomada por otro repartidor.');
    }

    await cargarCarreraEnCurso();
    await cargarCarrerasDisponibles();
  }

  async function actualizarPaso(nuevoPaso) {
    if (!pedidoActivo) return;
    const actualizacion = { delivery_status: nuevoPaso };
    if (nuevoPaso === 'on_the_way') {
      actualizacion.status = 'on_the_way';
    }

    const { error } = await supabase
      .from('orders')
      .update(actualizacion)
      .eq('id', pedidoActivo.id);

    if (!error) {
      setPedidoActivo({ ...pedidoActivo, ...actualizacion });
    }
  }

  async function finalizarEntrega() {
    if (!pedidoActivo) return;
    setFinalizando(true);

    try {
      let fotoUrl = null;

      if (codigoEntrega) {
        if (codigoEntrega.trim() !== (pedidoActivo.delivery_code || '4821')) {
          throw new Error('El código de 4 dígitos no coincide con el del cliente.');
        }
      } else if (fotoEntrega) {
        const ext = fotoEntrega.name.split('.').pop();
        const ruta = `entregas/${pedidoActivo.id}_${Date.now()}.${ext}`;
        const { error: errUp } = await supabase.storage.from('receipts').upload(ruta, fotoEntrega);
        if (errUp) throw errUp;
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(ruta);
        fotoUrl = urlData.publicUrl;
      } else {
        throw new Error('Ingresa el código seguro de 4 dígitos o adjunta la foto de entrega.');
      }

      await supabase.from('orders').update({
        delivery_status: 'delivered',
        status: 'delivered',
        delivery_photo_url: fotoUrl
      }).eq('id', pedidoActivo.id);

      // Si cobró efectivo, actualizar deuda
      if (pedidoActivo.payment_method === 'efectivo' && wallet) {
        const comision = (parseFloat(pedidoActivo.total || 0) - parseFloat(pedidoActivo.delivery_fee || 0)) * 0.10;
        const nuevaDeuda = (parseFloat(wallet.cash_debt || 0)) + comision;
        await supabase.from('delivery_wallets').update({
          cash_debt: nuevaDeuda,
          is_blocked: nuevaDeuda >= TECHO_DEUDA
        }).eq('driver_id', user.id);
        await cargarWallet(user.id);
      }

      alert('¡Entrega concretada con éxito!');
      setMostrarModal(false);
      setCodigoEntrega('');
      setFotoEntrega(null);
      await cargarCarreraEnCurso();
      await cargarCarrerasDisponibles();

    } catch (err) {
      alert('Error al confirmar: ' + err.message);
    } finally {
      setFinalizando(false);
    }
  }

  const saldo = parseFloat(wallet?.prepaid_balance || 0);
  const deuda = parseFloat(wallet?.cash_debt || 0);
  const bloqueado = deuda >= TECHO_DEUDA;

  return (
    <div className="container" style={{ maxWidth: '840px', marginTop: '24px', marginBottom: '80px' }}>
      
      {/* CABECERA DELIVERY */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #333', paddingBottom: '14px', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#fff' }}>
            {perfil?.full_name || 'Repartidor Tropicalia'}
          </h1>
          <small style={{ color: 'var(--text-muted)' }}>
            Vehículo: {perfil?.vehicle_type?.toUpperCase() || 'MOTO'} • Placa: {perfil?.vehicle_plate || 'N/A'}
          </small>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={toggleDisponibilidad}
            className={`btn-toggle ${perfil?.is_online ? 'activo' : 'pausado'}`}
          >
            {perfil?.is_online ? '🟢 En Línea' : '⚪ Desconectado'}
          </button>

          <button
            onClick={async () => {
              await signOut();
              navigate('/portal');
            }}
            className="btn-secundario"
            style={{ borderColor: 'var(--red)', color: '#fca5a5' }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* BILLETERA Y TOPE DE DEUDA */}
      <div className="card" style={{ marginBottom: '20px', background: '#161616' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Billetera Digital</span>
            <div style={{ fontSize: '1.15rem', color: '#34d399', fontWeight: 700 }}>
              Saldo a Favor: {formatUsd(saldo)}
            </div>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Deuda Efectivo (Tope $20.00)</span>
            <div style={{ fontSize: '1.15rem', color: bloqueado ? '#ef4444' : 'var(--gold)', fontWeight: 700 }}>
              {formatUsd(deuda)} / {formatUsd(TECHO_DEUDA)}
            </div>
          </div>
        </div>
        {bloqueado && (
          <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid var(--red)', color: '#fca5a5', padding: '8px 12px', borderRadius: '6px', fontSize: '0.82rem', marginTop: '10px' }}>
            ⚠️ Has alcanzado el tope de deuda ($20.00). Debes amortizar con tu saldo para aceptar pedidos en efectivo.
          </div>
        )}
      </div>

      {/* MAPA */}
      <div style={{ height: '240px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #333', marginBottom: '20px' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* CARRERA ACTIVA EN CURSO */}
      {pedidoActivo && (
        <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: '24px', background: '#1b1b1b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span className="badge badge-cooking">CARRERA EN CURSO</span>
            <strong style={{ color: 'var(--gold)' }}>
              Flete: {formatUsd(pedidoActivo.delivery_fee || 2.50)}
            </strong>
          </div>

          <h3 style={{ margin: '0 0 6px 0', fontSize: '1.2rem', color: '#fff' }}>
            #ORD-{pedidoActivo.id.slice(0, 8)} • {pedidoActivo.businesses?.name || 'Local'}
          </h3>
          <p style={{ margin: '4px 0', fontSize: '0.9rem', color: '#ccc' }}>
            <strong>Destino:</strong> {pedidoActivo.delivery_address}
          </p>
          <p style={{ margin: '4px 0', fontSize: '0.9rem', color: '#ccc' }}>
            <strong>Cliente:</strong> {pedidoActivo.customer_name} ({pedidoActivo.customer_phone || 'S/N'})
          </p>

          {pedidoActivo.payment_method === 'efectivo' ? (
            <div style={{ background: '#3b1818', border: '1px solid #7f1d1d', borderRadius: '6px', padding: '8px', margin: '10px 0', fontSize: '0.85rem', color: '#fca5a5' }}>
              💵 <strong>Cobro en Efectivo:</strong> Debes cobrar {formatUsd(pedidoActivo.total)} al entregar.
            </div>
          ) : (
            <div style={{ background: '#182818', border: '1px solid #166534', borderRadius: '6px', padding: '8px', margin: '10px 0', fontSize: '0.85rem', color: '#86efac' }}>
              ✅ <strong>Pago Digital Confirmado.</strong> No debes cobrar nada al cliente.
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            {pedidoActivo.delivery_status === 'accepted' && (
              <button
                type="button"
                onClick={() => actualizarPaso('arrived_at_store')}
                className="btn-primario"
                style={{ width: '100%' }}
              >
                1. Llegué al Restaurante
              </button>
            )}
            {pedidoActivo.delivery_status === 'arrived_at_store' && (
              <button
                type="button"
                onClick={() => actualizarPaso('on_the_way')}
                className="btn-primario"
                style={{ width: '100%', background: 'var(--green)' }}
              >
                2. Recibí el Paquete (En Camino)
              </button>
            )}
            {pedidoActivo.delivery_status === 'on_the_way' && (
              <button
                type="button"
                onClick={() => setMostrarModal(true)}
                className="btn-primario"
                style={{ width: '100%', background: '#6366f1' }}
              >
                3. Entregar al Cliente
              </button>
            )}
          </div>
        </div>
      )}

      {/* POOL DE CARRERAS DISPONIBLES */}
      <div>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '12px' }}>
          🛵 Carreras Disponibles ({pedidosDisponibles.length})
        </h2>

        {pedidoActivo ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Tienes una carrera activa en curso. Finalízala para tomar otra comanda.
          </p>
        ) : !perfil?.is_online ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Debes colocarte <strong>En Línea</strong> en la parte superior para recibir órdenes.
          </p>
        ) : pedidosDisponibles.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>No hay carreras disponibles en este instante.</p>
          </div>
        ) : (
          <div className="grid-cards">
            {pedidosDisponibles.map(ord => {
              const esEfectivo = ord.payment_method === 'efectivo';
              const flete = parseFloat(ord.delivery_fee || 2.50);
              const propina = parseFloat(ord.driver_tip || 0);
              const ganancia = flete + propina;

              return (
                <div key={ord.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <strong style={{ color: 'var(--gold)' }}>#ORD-{ord.id.slice(0, 8)}</strong>
                      <span className={`badge ${esEfectivo ? 'badge-cooking' : 'badge-on_the_way'}`}>
                        {esEfectivo ? '💵 Efectivo' : '📲 Digital'}
                      </span>
                    </div>

                    <p style={{ margin: '4px 0', fontSize: '0.85rem' }}><strong>Local:</strong> {ord.businesses?.name || 'Restaurante'}</p>
                    <p style={{ margin: '4px 0', fontSize: '0.85rem' }}><strong>Entrega:</strong> {ord.delivery_address}</p>

                    <div style={{ background: '#222', borderRadius: '6px', padding: '8px', margin: '8px 0', fontSize: '0.85rem' }}>
                      <span>Ganancia Estimada:</span>
                      <strong style={{ color: '#10b981', fontSize: '1.1rem', display: 'block' }}>
                        {formatUsd(ganancia)}
                      </strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => aceptarCarrera(ord.id)}
                    className="btn-primario"
                    style={{ width: '100%', marginTop: '10px' }}
                    disabled={esEfectivo && bloqueado}
                  >
                    {esEfectivo && bloqueado ? 'Bloqueado por deuda' : 'Aceptar Carrera'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL PARA FINALIZAR ENTREGA */}
      {mostrarModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--gold)' }}>Confirmar Entrega Segura</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Ingresa el código seguro de 4 dígitos que te proporcionará el cliente:
            </p>

            <label>Código PIN de 4 dígitos:</label>
            <input
              type="text"
              maxLength={6}
              value={codigoEntrega}
              onChange={e => setCodigoEntrega(e.target.value)}
              placeholder="Ej: 4821"
              style={{ fontSize: '1.4rem', textAlign: 'center', letterSpacing: '4px', fontWeight: 'bold' }}
            />

            <div style={{ margin: '14px 0', textAlign: 'center', color: '#666', fontSize: '0.8rem' }}>
              — O si no cuenta con código, toma una foto de la entrega —
            </div>

            <label>Foto de la entrega:</label>
            <input
              type="file"
              accept="image/*"
              onChange={e => setFotoEntrega(e.target.files[0] || null)}
              style={{ background: '#1c1c1c' }}
            />

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                onClick={() => setMostrarModal(false)}
                className="btn-secundario"
                style={{ flex: 1 }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={finalizarEntrega}
                className="btn-primario"
                style={{ flex: 1, background: 'var(--green)' }}
                disabled={finalizando}
              >
                {finalizando ? 'Validando...' : 'Finalizar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

