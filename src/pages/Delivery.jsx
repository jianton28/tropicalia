import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';
import { abrirNotificacionWhatsApp, NUMERO_ORIGEN_NEGOCIO } from '../services/whatsappService';
import { 
  validarAceptacionCarrera, 
  procesarBalanceCompletado, 
  amortizarDeudaConSaldo, 
  TECHO_DEUDA_EFECTIVO 
} from '../services/paymentService';

const TECHO_DEUDA = TECHO_DEUDA_EFECTIVO;

export default function Delivery() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [perfil, setPerfil] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [pedidoActivo, setPedidoActivo] = useState(null);
  const [pedidosDisponibles, setPedidosDisponibles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal de Entrega Segura (Finalizar)
  const [mostrarModal, setMostrarModal] = useState(false);
  const [codigoEntrega, setCodigoEntrega] = useState('');
  const [fotoEntrega, setFotoEntrega] = useState(null);
  const [finalizando, setFinalizando] = useState(false);

  // Modal Cancelar con Código de Seguridad (Comida en manos)
  const [mostrarModalCancelarCodigo, setMostrarModalCancelarCodigo] = useState(false);
  const [pinCancelacion, setPinCancelacion] = useState('');
  const [motivoCancelacion, setMotivoCancelacion] = useState('Cliente no localizable en dirección');
  const [cancelando, setCancelando] = useState(false);

  // Modal Datos de Pago Móvil
  const [mostrarModalPagoMovil, setMostrarModalPagoMovil] = useState(false);
  const [pmBanco, setPmBanco] = useState('0102 - Banco de Venezuela');
  const [pmCedula, setPmCedula] = useState('');
  const [pmTelefono, setPmTelefono] = useState('');

  // Modal Retirar Ganancias
  const [mostrarModalRetiro, setMostrarModalRetiro] = useState(false);
  const [montoRetiro, setMontoRetiro] = useState('');
  const [retirando, setRetirando] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState('');

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const driverMarkerRef = useRef(null);

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  useEffect(() => {
    if (!user) return;
    initDriver();

    const channel = supabase.channel('delivery-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        cargarCarreraEnCurso();
        cargarCarrerasDisponibles();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_wallets', filter: `driver_id=eq.${user.id}` }, () => {
        cargarWallet(user.id);
      })
      .subscribe();

    const handleBalanceEvent = () => {
      cargarWallet(user.id);
    };
    window.addEventListener('tropicalia:balance_actualizado', handleBalanceEvent);

    return () => {
      channel.unsubscribe();
      window.removeEventListener('tropicalia:balance_actualizado', handleBalanceEvent);
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
      const nombre = user.user_metadata?.full_name || 'Repartidor Tropicalia';
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

    // Cargar datos de pago móvil guardados en metadata o localStorage
    const savedMeta = user.user_metadata?.pagomovil || {};
    const localSaved = JSON.parse(localStorage.getItem(`pm_${user.id}`) || '{}');
    setPmBanco(drv?.pagomovil_bank || savedMeta.bank || localSaved.bank || '0102 - Banco de Venezuela');
    setPmCedula(drv?.pagomovil_id || savedMeta.idDoc || localSaved.idDoc || '');
    setPmTelefono(drv?.pagomovil_phone || savedMeta.phone || localSaved.phone || user.user_metadata?.phone || '');

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
              html: '<div style="background:#ef9d24; border:3px solid #82133a; border-radius:50%; width:18px; height:18px; box-shadow:0 0 10px rgba(239,157,36,0.8);"></div>',
              iconSize: [18, 18]
            })
          }).addTo(mapInstanceRef.current).bindPopup('📍 Tu ubicación GPS').openPopup();
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
      showToast(nuevo ? '🟢 Modo EN LÍNEA: Recibirás carreras en vivo' : '⚪ Modo DESCONECTADO');
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
    const orden = pedidosDisponibles.find(p => p.id === ordenId);
    if (orden) {
      const check = validarAceptacionCarrera({ orden, wallet });
      if (!check.permitido) {
        alert(check.motivo);
        return;
      }
    }

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
    } else {
      showToast('🛵 ¡Carrera aceptada! Dirígete al restaurante.');
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
      const ordenActualizada = { ...pedidoActivo, ...actualizacion };
      setPedidoActivo(ordenActualizada);
      if (nuevoPaso === 'arrived_at_store') {
        showToast('🏪 Avisado al restaurante: Repartidor en puerta');
      }
      if (nuevoPaso === 'on_the_way') {
        showToast('🚀 Paquete recibido. En ruta hacia el cliente.');
        // Notificación automática al cliente de pedido en camino
        abrirNotificacionWhatsApp(ordenActualizada, 'on_the_way', ordenActualizada.businesses);
      }
    }
  }

  // ==============================================================================
  // CANCELACIÓN DE COMANDAS CON REGLA DE SEGURIDAD
  // ==============================================================================
  async function handleLiberarCarreraSinComida() {
    if (!pedidoActivo) return;
    const confirma = window.confirm(
      '¿Deseas liberar esta carrera?\n\nComo aún no tienes la comida en mano, el pedido volverá al panel disponible para que otro compañero pueda tomarlo.'
    );
    if (!confirma) return;

    const { error } = await supabase
      .from('orders')
      .update({
        driver_id: null,
        delivery_status: 'pending'
      })
      .eq('id', pedidoActivo.id);

    if (!error) {
      showToast('Carrera liberada correctamente.');
      await cargarCarreraEnCurso();
      await cargarCarrerasDisponibles();
    } else {
      alert('Error al liberar carrera: ' + error.message);
    }
  }

  async function handleConfirmarCancelarConCodigo(e) {
    e.preventDefault();
    if (!pedidoActivo) return;

    // Validación de código: Debe coincidir con el delivery_code de la orden o códigos de soporte
    const pinValido = pedidoActivo.delivery_code || '4821';
    const esMaster = pinCancelacion.trim() === '9999' || pinCancelacion.trim() === '4821';
    
    if (pinCancelacion.trim() !== pinValido && !esMaster) {
      alert('❌ Código de seguridad incorrecto.\n\nYa retiraste la comida del restaurante. Para cancelar la comanda en ruta debes ingresar el código seguro proporcionado por soporte técnico o por el cliente.');
      return;
    }

    setCancelando(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          delivery_status: 'cancelled',
          notes: `Cancelado por repartidor en ruta (PIN verificado): ${motivoCancelacion}`
        })
        .eq('id', pedidoActivo.id);

      if (error) throw error;

      showToast('⚠️ Comanda cancelada y autorizada con código.');
      setMostrarModalCancelarCodigo(false);
      setPinCancelacion('');
      await cargarCarreraEnCurso();
      await cargarCarrerasDisponibles();
    } catch (err) {
      alert('Error cancelando orden: ' + err.message);
    } finally {
      setCancelando(false);
    }
  }

  // ==============================================================================
  // FINALIZAR ENTREGA SEGURA Y PROCESAR BALANCES
  // ==============================================================================
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

      // Procesar balances en Supabase (Efectivo retenido o Pago Móvil acreditado)
      const resBalance = await procesarBalanceCompletado({
        orden: pedidoActivo,
        driverId: user.id
      });

      if (resBalance.esEfectivo) {
        showToast(`🎉 ¡Entrega completada! Efectivo retenido registrado en deuda en calle.`);
      } else {
        showToast(`🎉 ¡Entrega completada! Flete (${formatUsd(resBalance.fleteGanado)}) acreditado a tu balance.`);
      }

      // Notificación automática al cliente de pedido entregado
      abrirNotificacionWhatsApp(pedidoActivo, 'delivered', pedidoActivo.businesses);

      setMostrarModal(false);
      setCodigoEntrega('');
      setFotoEntrega(null);
      await cargarWallet(user.id);
      await cargarCarreraEnCurso();
      await cargarCarrerasDisponibles();

    } catch (err) {
      alert('Error al confirmar: ' + err.message);
    } finally {
      setFinalizando(false);
    }
  }

  // ==============================================================================
  // AMORTIZAR DEUDA CON SALDO PRINCIPAL
  // ==============================================================================
  async function handleSaldarDeudaConSaldo() {
    const saldo = parseFloat(wallet?.prepaid_balance || 0);
    const deuda = parseFloat(wallet?.cash_debt || 0);

    if (saldo <= 0) {
      alert('No tienes saldo a favor en tu billetera para amortizar deuda.');
      return;
    }
    if (deuda <= 0) {
      alert('¡Excelente! No tienes deuda pendiente por carreras en efectivo.');
      return;
    }

    const abono = Math.min(saldo, deuda);
    const confirma = window.confirm(
      `¿Deseas acreditar ${formatUsd(abono)} de tus ganancias disponibles para saldar tu deuda en efectivo?`
    );
    if (!confirma) return;

    try {
      const res = await amortizarDeudaConSaldo({ driverId: user.id, montoAbono: abono });
      showToast(`💳 Se amortizaron ${formatUsd(res.abonoReal)} de tu deuda con éxito.`);
      setWallet(res.wallet);
      await cargarCarrerasDisponibles();
    } catch (err) {
      alert('Error amortizando deuda: ' + err.message);
    }
  }

  // ==============================================================================
  // RETIRO DE GANANCIAS & PAGO MÓVIL
  // ==============================================================================
  async function handleGuardarPagoMovil(e) {
    e.preventDefault();
    if (!pmCedula.trim() || !pmTelefono.trim()) {
      alert('Ingresa tu Cédula y Teléfono de Pago Móvil.');
      return;
    }

    try {
      const pmData = { bank: pmBanco, idDoc: pmCedula.trim(), phone: pmTelefono.trim() };
      await supabase.auth.updateUser({
        data: { pagomovil: pmData }
      });
      localStorage.setItem(`pm_${user.id}`, JSON.stringify(pmData));

      // Intento opcional si existe columna en driver_profiles
      try {
        await supabase.from('driver_profiles').update({
          pagomovil_bank: pmBanco,
          pagomovil_id: pmCedula.trim(),
          pagomovil_phone: pmTelefono.trim()
        }).eq('id', user.id);
      } catch (e) {}

      showToast('✅ Datos de Pago Móvil actualizados correctamente.');
      setMostrarModalPagoMovil(false);
    } catch (err) {
      alert('Error guardando datos: ' + err.message);
    }
  }

  async function handleSolicitarRetiro(e) {
    e.preventDefault();
    const saldo = parseFloat(wallet?.prepaid_balance || 0);
    const monto = parseFloat(montoRetiro);

    if (isNaN(monto) || monto <= 0) {
      alert('Ingresa un monto válido mayor a 0');
      return;
    }
    if (monto > saldo) {
      alert(`El monto no puede superar tu saldo disponible (${formatUsd(saldo)})`);
      return;
    }
    if (!pmCedula.trim() || !pmTelefono.trim()) {
      alert('Por favor configura primero tus datos de Pago Móvil para transferirte.');
      setMostrarModalRetiro(false);
      setMostrarModalPagoMovil(true);
      return;
    }

    setRetirando(true);
    try {
      // 1. Deducir saldo
      const nuevoSaldo = saldo - monto;
      const { error: errW } = await supabase.from('delivery_wallets').update({
        prepaid_balance: nuevoSaldo
      }).eq('driver_id', user.id);

      if (errW) throw errW;

      // 2. Registrar solicitud
      try {
        await supabase.from('driver_withdrawals').insert([{
          driver_id: user.id,
          amount: monto,
          bank_name: pmBanco,
          id_doc: pmCedula,
          phone: pmTelefono,
          status: 'pending'
        }]);
      } catch (e) {
        console.warn('Fallback guardado retiro:', e);
      }

      showToast(`💸 Solicitud de retiro por ${formatUsd(monto)} enviada. Se transferirá a tu Pago Móvil.`);
      setMostrarModalRetiro(false);
      setMontoRetiro('');
      await cargarWallet(user.id);
    } catch (err) {
      alert('Error procesando retiro: ' + err.message);
    } finally {
      setRetirando(false);
    }
  }

  const saldo = parseFloat(wallet?.prepaid_balance || 0);
  const deuda = parseFloat(wallet?.cash_debt || 0);
  const bloqueado = deuda >= TECHO_DEUDA;

  return (
    <div className="container" style={{ maxWidth: '880px', marginTop: '20px', marginBottom: '80px' }}>
      
      {/* TOAST DE NOTIFICACIÓN */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, var(--dark-amaranth), var(--crimson-violet))',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '12px',
          border: '1px solid var(--golden-orange)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          zIndex: 3000,
          fontWeight: 700,
          animation: 'shoppingCardIn 0.3s ease'
        }}>
          {toastMsg}
        </div>
      )}

      {/* CABECERA DELIVERY DE MARCA TROPICALIA */}
      <div style={{
        background: 'linear-gradient(135deg, #1c151e 0%, #291a27 100%)',
        border: '1px solid #4a2e46',
        borderRadius: '18px',
        padding: '18px 22px',
        marginBottom: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--dark-amaranth), var(--golden-orange))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.6rem'
          }}>
            🛵
          </div>
          <div>
            <h1 style={{ fontSize: '1.45rem', margin: 0, color: '#fff', fontWeight: 800 }}>
              {perfil?.full_name || 'Repartidor Tropicalia'}
            </h1>
            <div style={{ fontSize: '0.82rem', color: '#d1c7d0', marginTop: '3px' }}>
              Vehículo: <strong style={{ color: 'var(--golden-orange)' }}>{perfil?.vehicle_type?.toUpperCase() || 'MOTO'}</strong> • Placa: {perfil?.vehicle_plate || 'N/A'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={toggleDisponibilidad}
            className={`btn-toggle ${perfil?.is_online ? 'activo' : 'pausado'}`}
            style={{ fontWeight: 800, padding: '8px 16px', borderRadius: '10px' }}
          >
            {perfil?.is_online ? '🟢 En Línea' : '⚪ Desconectado'}
          </button>

          <button
            onClick={async () => {
              await signOut();
              navigate('/portal');
            }}
            className="btn-secundario"
            style={{ borderColor: 'var(--red)', color: '#fca5a5', padding: '8px 14px', borderRadius: '10px' }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* TARJETA DE BILLETERA, DEUDA & RETIROS */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '18px',
        padding: '20px',
        marginBottom: '20px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'center' }}>
          {/* Saldo Principal */}
          <div style={{ background: '#fdfbf7', border: '1px solid #f2e9dc', borderRadius: '14px', padding: '14px' }}>
            <span style={{ fontSize: '0.76rem', color: '#78716c', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Ganancias Disponibles
            </span>
            <div style={{ fontSize: '1.5rem', color: '#10b981', fontWeight: 900, marginTop: '4px' }}>
              {formatUsd(saldo)}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setMostrarModalRetiro(true)}
                disabled={saldo <= 0}
                className="btn-primario"
                style={{
                  fontSize: '0.78rem',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  fontWeight: 800
                }}
              >
                💸 Retirar a Pago Móvil
              </button>
              <button
                type="button"
                onClick={() => setMostrarModalPagoMovil(true)}
                className="btn-secundario"
                style={{ fontSize: '0.75rem', padding: '6px 10px', borderRadius: '8px' }}
                title="Configurar cuenta Pago Móvil"
              >
                ⚙️ Datos
              </button>
            </div>
          </div>

          {/* Deuda en Efectivo */}
          <div style={{
            background: bloqueado ? '#fef2f2' : '#fdfbf7',
            border: `1px solid ${bloqueado ? '#fca5a5' : '#f2e9dc'}`,
            borderRadius: '14px',
            padding: '14px'
          }}>
            <span style={{ fontSize: '0.76rem', color: bloqueado ? '#dc2626' : '#78716c', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Deuda Efectivo (Tope: $25.00)
            </span>
            <div style={{ fontSize: '1.5rem', color: bloqueado ? '#dc2626' : 'var(--golden-orange)', fontWeight: 900, marginTop: '4px' }}>
              {formatUsd(deuda)} <small style={{ fontSize: '0.9rem', color: '#78716c' }}>/ {formatUsd(TECHO_DEUDA)}</small>
            </div>
            <div style={{ marginTop: '10px' }}>
              <button
                type="button"
                onClick={handleSaldarDeudaConSaldo}
                disabled={saldo <= 0 || deuda <= 0}
                className="btn-primario"
                style={{
                  fontSize: '0.78rem',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  background: (saldo > 0 && deuda > 0) ? 'var(--dark-amaranth)' : '#d1d5db',
                  color: '#fff',
                  fontWeight: 800
                }}
              >
                💳 Acreditar Saldo para Saldar Deuda
              </button>
            </div>
          </div>
        </div>

        {/* Alerta de bloqueo */}
        {bloqueado && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #ef4444',
            color: '#b91c1c',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '0.84rem',
            marginTop: '14px',
            fontWeight: 700
          }}>
            ⚠️ <strong>Límite de Deuda Superado ($25.00):</strong> Tienes acumulado {formatUsd(deuda)} en efectivo. Pulsa el botón "Acreditar Saldo" para amortizar tu deuda y desbloquear las carreras con cobro en efectivo.
          </div>
        )}
      </div>

      {/* MAPA GPS EN VIVO */}
      <div style={{ height: '220px', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e5e7eb', marginBottom: '22px', boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* CARRERA ACTIVA EN CURSO */}
      {pedidoActivo && (
        <div style={{
          background: 'linear-gradient(135deg, #201722 0%, #2d1d2b 100%)',
          border: '2px solid var(--golden-orange)',
          borderRadius: '18px',
          padding: '20px',
          marginBottom: '26px',
          boxShadow: '0 8px 30px rgba(239, 157, 36, 0.25)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span className="badge badge-cooking" style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
              🛵 CARRERA EN CURSO
            </span>
            <strong style={{ color: 'var(--golden-orange)', fontSize: '1.15rem' }}>
              Flete Ganancia: {formatUsd(pedidoActivo.delivery_fee || 2.50)}
            </strong>
          </div>

          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: '#fff' }}>
            #ORD-{pedidoActivo.id.slice(0, 8)} • {pedidoActivo.businesses?.name || 'Local'}
          </h3>
          <p style={{ margin: '4px 0', fontSize: '0.92rem', color: '#f3e8f4' }}>
            <strong>📍 Destino:</strong> {pedidoActivo.delivery_address}
          </p>
          <p style={{ margin: '4px 0', fontSize: '0.92rem', color: '#f3e8f4' }}>
            <strong>👤 Cliente:</strong> {pedidoActivo.customer_name} ({pedidoActivo.customer_phone || 'S/N'})
          </p>

          {pedidoActivo.payment_method === 'efectivo' ? (
            <div style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', borderRadius: '8px', padding: '10px 14px', margin: '12px 0', fontSize: '0.88rem', color: '#fca5a5' }}>
              💵 <strong>Cobro en Efectivo Requerido:</strong> Debes cobrar <strong>{formatUsd(pedidoActivo.total)}</strong> al entregar al cliente.
            </div>
          ) : (
            <div style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid #10b981', borderRadius: '8px', padding: '10px 14px', margin: '12px 0', fontSize: '0.88rem', color: '#a7f3d0' }}>
              ✅ <strong>Pago Digital Liquidado.</strong> No cobres dinero al cliente.
            </div>
          )}

          {/* ACCIONES DE PROGRESO DE LA CARRERA */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            {pedidoActivo.delivery_status === 'accepted' && (
              <button
                type="button"
                onClick={() => actualizarPaso('arrived_at_store')}
                className="btn-primario"
                style={{ flex: 2, padding: '12px', background: 'var(--golden-orange)', color: '#000', fontWeight: 800, borderRadius: '10px' }}
              >
                1. Llegué al Restaurante
              </button>
            )}
            {pedidoActivo.delivery_status === 'arrived_at_store' && (
              <button
                type="button"
                onClick={() => actualizarPaso('on_the_way')}
                className="btn-primario"
                style={{ flex: 2, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', fontWeight: 800, borderRadius: '10px' }}
              >
                2. Recibí el Paquete (En Camino al Cliente)
              </button>
            )}
            {pedidoActivo.delivery_status === 'on_the_way' && (
              <button
                type="button"
                onClick={() => setMostrarModal(true)}
                className="btn-primario"
                style={{ flex: 2, padding: '12px', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', fontWeight: 800, borderRadius: '10px' }}
              >
                3. Entregar al Cliente
              </button>
            )}

            {/* BOTÓN WHATSAPP CLIENTE */}
            <button
              type="button"
              onClick={() => abrirNotificacionWhatsApp(pedidoActivo, pedidoActivo.delivery_status || 'on_the_way', pedidoActivo.businesses)}
              className="btn-secundario"
              style={{ padding: '12px 14px', background: '#25D366', color: '#000', fontWeight: 700, borderRadius: '10px', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              title="Avisar al cliente por WhatsApp con mensaje preformateado"
            >
              💬 WhatsApp Cliente
            </button>

            {/* BOTÓN CANCELAR CON REGLA DE SEGURIDAD */}
            {pedidoActivo.delivery_status !== 'on_the_way' ? (
              <button
                type="button"
                onClick={handleLiberarCarreraSinComida}
                className="btn-secundario"
                style={{ flex: 1, padding: '12px', borderColor: '#fca5a5', color: '#fca5a5', borderRadius: '10px' }}
                title="Liberar carrera antes de retirar comida"
              >
                ✕ Liberar Carrera
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMostrarModalCancelarCodigo(true)}
                className="btn-secundario"
                style={{ flex: 1, padding: '12px', borderColor: '#ef4444', color: '#fca5a5', borderRadius: '10px' }}
                title="Comida en manos: Requiere código seguro de cancelación"
              >
                🔒 Cancelar con PIN
              </button>
            )}
          </div>
        </div>
      )}

      {/* POOL DE CARRERAS DISPONIBLES */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0, color: 'var(--dark-amaranth)', fontWeight: 800 }}>
            🛵 Carreras Disponibles ({pedidosDisponibles.length})
          </h2>
          <button
            type="button"
            onClick={cargarCarrerasDisponibles}
            className="btn-secundario"
            style={{ fontSize: '0.8rem', padding: '5px 12px', borderRadius: '8px' }}
          >
            🔄 Actualizar
          </button>
        </div>

        {pedidoActivo ? (
          <div style={{ background: '#fdfbf7', border: '1px dashed #d6cbbe', padding: '20px', borderRadius: '14px', textAlign: 'center', color: '#78716c' }}>
            Tienes una carrera en curso. Complétala o libérala para poder tomar una nueva.
          </div>
        ) : !perfil?.is_online ? (
          <div style={{ background: '#fdfbf7', border: '1px dashed #d6cbbe', padding: '24px', borderRadius: '14px', textAlign: 'center', color: '#78716c' }}>
            Debes colocarte <strong>En Línea</strong> en el botón superior para ver y tomar carreras.
          </div>
        ) : pedidosDisponibles.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', padding: '36px', borderRadius: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📡</div>
            <strong style={{ color: '#374151', fontSize: '1.05rem' }}>Buscando pedidos cercanos...</strong>
            <p style={{ color: '#9ca3af', margin: '4px 0 0 0', fontSize: '0.88rem' }}>
              En cuanto un restaurante prepare una comanda aparecerá aquí al instante.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {pedidosDisponibles.map(ord => {
              const esEfectivo = ord.payment_method === 'efectivo';
              const flete = parseFloat(ord.delivery_fee || 2.50);
              const propina = parseFloat(ord.driver_tip || 0);
              const ganancia = flete + propina;

              return (
                <div
                  key={ord.id}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '16px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.03)'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ color: 'var(--dark-amaranth)' }}>#ORD-{ord.id.slice(0, 8)}</strong>
                      <span className={`badge ${esEfectivo ? 'badge-cooking' : 'badge-on_the_way'}`} style={{ fontSize: '0.74rem' }}>
                        {esEfectivo ? '💵 Efectivo' : '📲 Digital'}
                      </span>
                    </div>

                    <p style={{ margin: '4px 0', fontSize: '0.85rem', color: '#4b5563' }}>
                      <strong>Local:</strong> {ord.businesses?.name || 'Restaurante'}
                    </p>
                    <p style={{ margin: '4px 0', fontSize: '0.85rem', color: '#4b5563' }}>
                      <strong>Entrega:</strong> {ord.delivery_address}
                    </p>

                    <div style={{ background: '#fdfbf7', border: '1px solid #f2e9dc', borderRadius: '10px', padding: '10px', margin: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: '#78716c' }}>Tu Ganancia:</span>
                      <strong style={{ color: '#10b981', fontSize: '1.2rem' }}>
                        {formatUsd(ganancia)}
                      </strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => aceptarCarrera(ord.id)}
                    className="btn-primario"
                    style={{
                      width: '100%',
                      marginTop: '6px',
                      padding: '10px',
                      background: (esEfectivo && bloqueado) ? '#9ca3af' : 'var(--golden-orange)',
                      color: '#000',
                      fontWeight: 800,
                      borderRadius: '10px'
                    }}
                    disabled={esEfectivo && bloqueado}
                  >
                    {esEfectivo && bloqueado ? '🚫 Bloqueado por deuda ($25)' : 'Aceptar Carrera'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: FINALIZAR ENTREGA SEGURA CON CÓDIGO */}
      {mostrarModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px', borderRadius: '18px' }}>
            <h3 style={{ margin: '0 0 10px 0', color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>Confirmar Entrega Segura</h3>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '14px' }}>
              Solicita al cliente el código PIN de 4 dígitos para certificar la entrega:
            </p>

            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Código PIN del Cliente:</label>
            <input
              type="text"
              maxLength={6}
              value={codigoEntrega}
              onChange={e => setCodigoEntrega(e.target.value)}
              placeholder="Ej: 4821"
              style={{
                fontSize: '1.6rem',
                textAlign: 'center',
                letterSpacing: '6px',
                fontWeight: 900,
                color: 'var(--dark-amaranth)',
                margin: '6px 0 14px 0',
                padding: '10px'
              }}
            />

            <div style={{ margin: '10px 0', textAlign: 'center', color: '#9ca3af', fontSize: '0.78rem' }}>
              — O toma una foto de la entrega como comprobante —
            </div>

            <input
              type="file"
              accept="image/*"
              onChange={e => setFotoEntrega(e.target.files[0] || null)}
              style={{ margin: '6px 0 16px 0', fontSize: '0.82rem' }}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setMostrarModal(false)}
                className="btn-secundario"
                style={{ flex: 1, padding: '10px', borderRadius: '10px' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={finalizarEntrega}
                className="btn-primario"
                style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', fontWeight: 800, borderRadius: '10px' }}
                disabled={finalizando}
              >
                {finalizando ? 'Validando...' : 'Finalizar Entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CANCELACIÓN CON CÓDIGO (COMIDA EN MANOS) */}
      {mostrarModalCancelarCodigo && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px', borderRadius: '18px', border: '2px solid #ef4444' }}>
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '2.5rem' }}>🔒</span>
              <h3 style={{ margin: '6px 0 0 0', color: '#dc2626', fontSize: '1.2rem' }}>Cancelar Comanda en Tránsito</h3>
              <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: '4px' }}>
                Ya tienes la comida en tu poder. Para cancelar debes ingresar el código de autorización de 4 dígitos (solicítalo a soporte o al cliente).
              </p>
            </div>

            <form onSubmit={handleConfirmarCancelarConCodigo}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Código de Autorización (4 dígitos) *</label>
              <input
                type="text"
                required
                maxLength={6}
                value={pinCancelacion}
                onChange={e => setPinCancelacion(e.target.value)}
                placeholder="PIN"
                style={{
                  fontSize: '1.6rem',
                  textAlign: 'center',
                  letterSpacing: '6px',
                  fontWeight: 900,
                  margin: '4px 0 12px 0',
                  padding: '8px'
                }}
              />

              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Motivo de la Cancelación *</label>
              <select
                value={motivoCancelacion}
                onChange={e => setMotivoCancelacion(e.target.value)}
                className="form-input-figma"
                style={{ margin: '4px 0 16px 0', padding: '8px' }}
              >
                <option value="Cliente no localizable en dirección">Cliente no localizable en dirección</option>
                <option value="Accidente o avería en el trayecto">Accidente o avería en el trayecto</option>
                <option value="Dirección errónea o fuera de zona">Dirección errónea o fuera de zona</option>
                <option value="Cancelado por orden de soporte">Cancelado por orden de soporte</option>
              </select>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setMostrarModalCancelarCodigo(false)}
                  className="btn-secundario"
                  style={{ flex: 1, padding: '10px', borderRadius: '10px' }}
                >
                  Volver
                </button>
                <button
                  type="submit"
                  disabled={cancelando}
                  className="btn-primario"
                  style={{ flex: 1, padding: '10px', background: '#dc2626', color: '#fff', fontWeight: 800, borderRadius: '10px' }}
                >
                  {cancelando ? 'Cancelando...' : 'Confirmar Cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: DATOS DE PAGO MÓVIL PARA RETIROS */}
      {mostrarModalPagoMovil && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px', borderRadius: '18px' }}>
            <h3 style={{ margin: '0 0 8px 0', color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
              🏦 Cuenta Pago Móvil para Retiros
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '14px' }}>
              Tus ganancias acumuladas serán transferidas a estos datos:
            </p>

            <form onSubmit={handleGuardarPagoMovil} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Banco Receptor:</label>
                <select
                  value={pmBanco}
                  onChange={e => setPmBanco(e.target.value)}
                  className="form-input-figma"
                  style={{ margin: '4px 0 0 0', padding: '8px' }}
                >
                  <option value="0102 - Banco de Venezuela">0102 - Banco de Venezuela</option>
                  <option value="0134 - Banesco">0134 - Banesco</option>
                  <option value="0105 - Mercantil">0105 - Mercantil</option>
                  <option value="0108 - Provincial">0108 - Provincial</option>
                  <option value="0172 - Bancamiga">0172 - Bancamiga</option>
                  <option value="0191 - BNC">0191 - BNC</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Cédula o RIF:</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: V-24890123"
                  value={pmCedula}
                  onChange={e => setPmCedula(e.target.value)}
                  className="form-input-figma"
                  style={{ margin: '4px 0 0 0', padding: '8px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Teléfono Pago Móvil:</label>
                <input
                  type="tel"
                  required
                  placeholder="Ej: 04141234567"
                  value={pmTelefono}
                  onChange={e => setPmTelefono(e.target.value)}
                  className="form-input-figma"
                  style={{ margin: '4px 0 0 0', padding: '8px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setMostrarModalPagoMovil(false)}
                  className="btn-secundario"
                  style={{ flex: 1, padding: '10px', borderRadius: '10px' }}
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  className="btn-primario"
                  style={{ flex: 1, padding: '10px', background: 'var(--golden-orange)', color: '#000', fontWeight: 800, borderRadius: '10px' }}
                >
                  Guardar Datos
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: SOLICITUD DE RETIRO DE SALDO */}
      {mostrarModalRetiro && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px', borderRadius: '18px' }}>
            <h3 style={{ margin: '0 0 8px 0', color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
              💸 Retirar Ganancias
            </h3>
            <p style={{ fontSize: '0.84rem', color: '#6b7280', marginBottom: '12px' }}>
              Saldo disponible para transferir: <strong style={{ color: '#10b981' }}>{formatUsd(saldo)}</strong>
            </p>

            <div style={{ background: '#fdfbf7', border: '1px solid #e7ded4', borderRadius: '10px', padding: '10px', marginBottom: '14px', fontSize: '0.8rem' }}>
              <div><strong>Destino:</strong> {pmBanco}</div>
              <div><strong>Titular:</strong> {pmCedula || 'Sin cédula'} • {pmTelefono || 'Sin teléfono'}</div>
            </div>

            <form onSubmit={handleSolicitarRetiro}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>Monto a Retirar ($ USD):</label>
              <div style={{ display: 'flex', gap: '8px', margin: '4px 0 16px 0' }}>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={saldo}
                  required
                  placeholder="0.00"
                  value={montoRetiro}
                  onChange={e => setMontoRetiro(e.target.value)}
                  className="form-input-figma"
                  style={{ margin: 0, padding: '10px', fontSize: '1.2rem', fontWeight: 800 }}
                />
                <button
                  type="button"
                  onClick={() => setMontoRetiro(saldo.toString())}
                  className="btn-secundario"
                  style={{ whiteSpace: 'nowrap', padding: '10px 14px', borderRadius: '10px', fontSize: '0.8rem' }}
                >
                  Todo
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setMostrarModalRetiro(false)}
                  className="btn-secundario"
                  style={{ flex: 1, padding: '10px', borderRadius: '10px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={retirando}
                  className="btn-primario"
                  style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', fontWeight: 800, borderRadius: '10px' }}
                >
                  {retirando ? 'Procesando...' : 'Confirmar Retiro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
