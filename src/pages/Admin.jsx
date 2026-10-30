import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';
import { cancelarOrdenConReversion } from '../services/inventoryService';
import { abrirNotificacionWhatsApp, NUMERO_ORIGEN_NEGOCIO } from '../services/whatsappService';
import { 
  procesarBalanceCompletado, 
  recibirEfectivoEnCajaAdmin, 
  TECHO_DEUDA_EFECTIVO 
} from '../services/paymentService';

export default function Admin() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const [tab, setTab] = useState('activas'); // 'activas', 'pagos', 'cortes', 'locales', 'drivers', 'ordenes'
  const [pagos, setPagos] = useState([]);
  const [cortes, setCortes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [locales, setLocales] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [filtroEstadoOrdenes, setFiltroEstadoOrdenes] = useState('todas'); // 'todas', 'activas', 'delivered', 'cancelled'
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState('');

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  }

  useEffect(() => {
    recargarTodoAdmin();

    const channel = supabase.channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        recargarTodoAdmin();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_closures' }, () => {
        cargarCortes();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  async function recargarTodoAdmin() {
    setLoading(true);
    await Promise.all([
      cargarPagos(),
      cargarCortes(),
      cargarDrivers(),
      cargarLocales(),
      cargarOrdenes()
    ]);
    setLoading(false);
  }

  async function cargarPagos() {
    const { data } = await supabase
      .from('orders')
      .select('*, businesses(name)')
      .eq('status', 'pending_payment_verification')
      .order('created_at', { ascending: false });

    setPagos(data || []);
  }

  async function cargarCortes() {
    const { data } = await supabase
      .from('cash_closures')
      .select('*, businesses(name, phone)')
      .order('created_at', { ascending: false });

    setCortes(data || []);
  }

  async function cargarDrivers() {
    const { data } = await supabase
      .from('driver_profiles')
      .select('*, delivery_wallets(cash_debt, prepaid_balance, is_blocked)')
      .order('full_name', { ascending: true });

    setDrivers(data || []);
  }

  async function cargarLocales() {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .order('name', { ascending: true });

    setLocales(data || []);
  }

  async function cargarOrdenes() {
    const { data } = await supabase
      .from('orders')
      .select('*, businesses(name)')
      .order('created_at', { ascending: false })
      .limit(60);

    setOrdenes(data || []);
  }

  async function aprobarPago(ordenId) {
    if (!confirm('¿Aprobar pago y enviar orden directamente a cocina?')) return;
    const { error } = await supabase
      .from('orders')
      .update({ status: 'pending' })
      .eq('id', ordenId);

    if (!error) {
      const ord = pagos.find(p => p.id === ordenId) || ordenes.find(o => o.id === ordenId);
      if (ord) {
        abrirNotificacionWhatsApp({ ...ord, status: 'pending' }, 'cooking', ord.businesses);
      }
      showToast('✅ Pago verificado y aprobado. Notificación generada y orden enviada a cocina.');
      recargarTodoAdmin();
    }
  }

  async function rechazarPago(ordenId) {
    const motivo = prompt('Motivo del rechazo de pago y cancelación de comanda:');
    if (!motivo) return;

    try {
      const ord = pagos.find(p => p.id === ordenId) || ordenes.find(o => o.id === ordenId);
      await cancelarOrdenConReversion(ordenId, `Pago rechazado por administración: ${motivo}`, 'administrador');
      if (ord) {
        abrirNotificacionWhatsApp(ord, 'cancelled', ord.businesses);
      }
      showToast('❌ Pago rechazado y comanda cancelada. Insumos devueltos al stock.');
      recargarTodoAdmin();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // ==============================================================================
  // CIERRE DE COMANDAS ACTIVAS EN CUALQUIER MOMENTO
  // ==============================================================================
  async function forzarCierreEntregada(ordenId) {
    if (!confirm('¿Confirmas que deseas cerrar esta orden activa como ENTREGADA exitosamente?')) return;
    try {
      const ord = ordenes.find(o => o.id === ordenId);
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'delivered',
          delivery_status: 'delivered'
        })
        .eq('id', ordenId);

      if (error) throw error;

      // Si tenía repartidor asignado, liquidar balance en Supabase
      if (ord && ord.driver_id) {
        await procesarBalanceCompletado({ orden: ord, driverId: ord.driver_id });
      }

      // Notificación automática al cliente
      if (ord) {
        abrirNotificacionWhatsApp(ord, 'delivered', ord.businesses);
      }

      showToast('✅ Orden cerrada exitosamente con estado Entregada.');
      recargarTodoAdmin();
    } catch (err) {
      alert('Error al cerrar orden: ' + err.message);
    }
  }

  async function forzarCierreCancelada(ordenId) {
    const motivo = prompt('Indica el motivo del cierre y cancelación administrativa:');
    if (!motivo) return;

    try {
      const ord = ordenes.find(o => o.id === ordenId);
      const res = await cancelarOrdenConReversion(ordenId, motivo, 'administrador');
      
      if (ord) {
        abrirNotificacionWhatsApp(ord, 'cancelled', ord.businesses);
      }

      showToast(`❌ Orden cancelada y cerrada. Se reintegraron ${res.reversionCount || 0} artículos al inventario.`);
      recargarTodoAdmin();
    } catch (err) {
      alert('Error al cancelar la orden: ' + err.message);
    }
  }

  async function handleRecibirEfectivoDriver(driverId, nombre, deudaActual) {
    const montoStr = prompt(`El repartidor ${nombre} tiene una deuda de $${deudaActual.toFixed(2)} en efectivo.\n¿Cuánto dinero te entrega en caja para saldar?`, deudaActual.toFixed(2));
    if (!montoStr) return;
    const abono = parseFloat(montoStr);
    if (isNaN(abono) || abono <= 0) return;

    try {
      const res = await recibirEfectivoEnCajaAdmin({ driverId, montoRecibido: abono });
      showToast(`✅ Deuda saldada. Nueva deuda de ${nombre}: $${res.nuevaDeuda.toFixed(2)}`);
      cargarDrivers();
    } catch (err) {
      alert('Error recibiendo efectivo: ' + err.message);
    }
  }

  async function liquidarCorte(corteId) {
    if (!confirm('¿Confirmas que la transferencia fue realizada al restaurante?')) return;
    const { error } = await supabase
      .from('cash_closures')
      .update({ status: 'settled' })
      .eq('id', corteId);

    if (!error) {
      showToast('💰 Liquidación marcada como realizada.');
      cargarCortes();
    }
  }

  async function toggleLocal(local) {
    const nuevo = !local.is_active;
    await supabase.from('businesses').update({ is_active: nuevo }).eq('id', local.id);
    showToast(`Restaurante "${local.name}" ${nuevo ? 'activado' : 'pausado'}`);
    cargarLocales();
  }

  const ordenesActivas = ordenes.filter(o => !['delivered', 'cancelled', 'rejected'].includes(o.status));

  const totalVentasEntregadas = ordenes
    .filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

  return (
    <div className="container" style={{ maxWidth: '1200px', marginTop: '22px', marginBottom: '80px' }}>
      
      {/* TOAST NOTIFICACIÓN */}
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

      {/* CABECERA ADMIN DE MARCA TROPICALIA */}
      <div style={{
        background: 'linear-gradient(135deg, #1c151e 0%, #291a27 100%)',
        border: '1px solid #4a2e46',
        borderRadius: '18px',
        padding: '18px 24px',
        marginBottom: '22px',
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
            🌴
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', margin: 0, color: '#fff', fontWeight: 800 }}>
              Consola Administrativa • Tropicalia CRB
            </h1>
            <div style={{ fontSize: '0.82rem', color: '#d1c7d0', marginTop: '3px' }}>
              Supervisión general, cierre forzado de comandas, pagos, cortes y flota
            </div>
          </div>
        </div>

        <button
          onClick={async () => {
            await signOut();
            navigate('/portal');
          }}
          className="btn-secundario"
          style={{ borderColor: 'var(--red)', color: '#fca5a5', padding: '8px 16px', borderRadius: '10px' }}
        >
          Cerrar Sesión
        </button>
      </div>

      {/* TARJETAS KPI */}
      <div className="kpi-grid" style={{ marginBottom: '22px' }}>
        <div className="kpi-card" style={{ borderLeft: '4px solid var(--golden-orange)' }}>
          <small>🔥 Comandas Activas</small>
          <h3 style={{ color: ordenesActivas.length > 0 ? 'var(--golden-orange)' : '#fff' }}>
            {ordenesActivas.length}
          </h3>
        </div>
        <div className="kpi-card" style={{ borderLeft: '4px solid #ef4444' }}>
          <small>💳 Pagos por Validar</small>
          <h3 style={{ color: pagos.length > 0 ? '#ef4444' : '#fff' }}>{pagos.length}</h3>
        </div>
        <div className="kpi-card" style={{ borderLeft: '4px solid #3b82f6' }}>
          <small>💰 Liquidaciones Pendientes</small>
          <h3 style={{ color: '#60a5fa' }}>
            {cortes.filter(c => c.status === 'pending_settlement').length}
          </h3>
        </div>
        <div className="kpi-card" style={{ borderLeft: '4px solid #10b981' }}>
          <small>📈 Ventas Globales Entregadas</small>
          <h3 style={{ color: '#34d399' }}>{formatUsd(totalVentasEntregadas)}</h3>
        </div>
      </div>

      {/* PESTAÑAS ADMINISTRATIVAS */}
      <nav className="admin-nav" style={{ marginBottom: '20px' }}>
        <button
          className={`btn-tab ${tab === 'activas' ? 'activo' : ''}`}
          onClick={() => setTab('activas')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          🔥 Comandas Activas ({ordenesActivas.length})
        </button>
        <button
          className={`btn-tab ${tab === 'pagos' ? 'activo' : ''}`}
          onClick={() => setTab('pagos')}
        >
          💳 Validar Pagos ({pagos.length})
        </button>
        <button
          className={`btn-tab ${tab === 'cortes' ? 'activo' : ''}`}
          onClick={() => setTab('cortes')}
        >
          💰 Liquidaciones y Cortes ({cortes.length})
        </button>
        <button
          className={`btn-tab ${tab === 'locales' ? 'activo' : ''}`}
          onClick={() => setTab('locales')}
        >
          🏪 Restaurantes ({locales.length})
        </button>
        <button
          className={`btn-tab ${tab === 'drivers' ? 'activo' : ''}`}
          onClick={() => setTab('drivers')}
        >
          🛵 Repartidores ({drivers.length})
        </button>
        <button
          className={`btn-tab ${tab === 'ordenes' ? 'activo' : ''}`}
          onClick={() => setTab('ordenes')}
        >
          📋 Todas las Órdenes ({ordenes.length})
        </button>
      </nav>

      {/* 1. COMANDAS ACTIVAS (CIERRE EN CUALQUIER MOMENTO) */}
      {tab === 'activas' && (
        <div className="card" style={{ background: '#ffffff', borderRadius: '18px', padding: '22px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.2rem' }}>
                🔥 Comandas en Curso (Control y Cierre Inmediato)
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: '#6b7280' }}>
                Como administrador puedes forzar el cierre de cualquier orden activa en cualquier momento (marcar como Entregada o Cancelar con reposición de inventario).
              </p>
            </div>
            <button
              onClick={recargarTodoAdmin}
              className="btn-secundario"
              style={{ fontSize: '0.8rem', padding: '6px 12px', borderRadius: '8px' }}
            >
              🔄 Actualizar
            </button>
          </div>

          {ordenesActivas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px', background: '#fdfbf7', borderRadius: '14px', border: '1px dashed #d6cbbe' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎉</div>
              <strong style={{ color: '#374151' }}>No hay comandas activas pendientes en este momento.</strong>
              <p style={{ color: '#9ca3af', margin: '4px 0 0 0', fontSize: '0.85rem' }}>Todas las órdenes han sido completadas o cerradas.</p>
            </div>
          ) : (
            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Local</th>
                    <th>Cliente / Teléfono</th>
                    <th>Modalidad</th>
                    <th>Monto Total</th>
                    <th>Estado Actual</th>
                    <th style={{ textAlign: 'center' }}>Acciones de Cierre de Comanda</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenesActivas.map(o => (
                    <tr key={o.id}>
                      <td>
                        <strong style={{ color: 'var(--dark-amaranth)' }}>#ORD-{o.id.slice(0, 8)}</strong>
                      </td>
                      <td><strong>{o.businesses?.name || 'Local'}</strong></td>
                      <td>
                        <div>{o.customer_name || 'Cliente'}</div>
                        <small style={{ color: '#78716c' }}>{o.customer_phone || 'S/N'}</small>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem' }}>
                          {o.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: '#10b981', fontSize: '0.95rem' }}>{formatUsd(o.total)}</strong>
                      </td>
                      <td>
                        <span className={`badge badge-${o.status}`}>
                          {o.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => abrirNotificacionWhatsApp(o, o.status, o.businesses)}
                            className="btn-secundario"
                            style={{
                              padding: '6px 10px',
                              fontSize: '0.78rem',
                              background: '#25D366',
                              color: '#000',
                              border: 'none',
                              fontWeight: 700,
                              borderRadius: '8px',
                              cursor: 'pointer'
                            }}
                            title="Abrir WhatsApp directo hacia el cliente con resumen preformateado"
                          >
                            💬 WhatsApp
                          </button>
                          <button
                            type="button"
                            onClick={() => forzarCierreEntregada(o.id)}
                            className="btn-primario"
                            style={{
                              padding: '6px 12px',
                              fontSize: '0.78rem',
                              background: 'linear-gradient(135deg, #10b981, #059669)',
                              color: '#fff',
                              fontWeight: 800,
                              borderRadius: '8px'
                            }}
                            title="Forzar cierre marcando como entregada"
                          >
                            ✓ Cerrar (Entregada)
                          </button>
                          <button
                            type="button"
                            onClick={() => forzarCierreCancelada(o.id)}
                            className="btn-secundario"
                            style={{
                              padding: '6px 12px',
                              fontSize: '0.78rem',
                              borderColor: '#ef4444',
                              color: '#dc2626',
                              fontWeight: 700,
                              borderRadius: '8px'
                            }}
                            title="Forzar cierre cancelando con devolución de stock"
                          >
                            ✕ Cerrar (Cancelar)
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 2. VALIDAR PAGOS DIGITALES */}
      {tab === 'pagos' && (
        <div className="card" style={{ background: '#ffffff', borderRadius: '18px', padding: '22px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--dark-amaranth)' }}>Pagos Digitales en Verificación</h3>
          {pagos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', background: '#fdfbf7', borderRadius: '12px' }}>
              <p style={{ color: '#78716c', margin: 0 }}>✅ No hay pagos pendientes por conciliar.</p>
            </div>
          ) : (
            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Cliente</th>
                    <th>Restaurante</th>
                    <th>Método / Monto</th>
                    <th>Referencia</th>
                    <th>Comprobante</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map(ord => (
                    <tr key={ord.id}>
                      <td>
                        <strong>#ORD-{ord.id.slice(0, 8)}</strong>
                      </td>
                      <td>
                        <strong>{ord.customer_name || 'Cliente'}</strong><br />
                        <small style={{ color: '#888' }}>{ord.customer_phone}</small>
                      </td>
                      <td>{ord.businesses?.name || 'Local'}</td>
                      <td>
                        <span className="badge badge-pending">
                          {(ord.payment_method || 'Digital').toUpperCase()}
                        </span><br />
                        <strong style={{ color: '#10b981' }}>{formatUsd(ord.total)}</strong>
                      </td>
                      <td>
                        <span style={{ background: '#f3f4f6', padding: '3px 8px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700 }}>
                          {ord.payment_reference || 'S/R'}
                        </span>
                      </td>
                      <td>
                        {ord.payment_receipt_url ? (
                          <a href={ord.payment_receipt_url} target="_blank" rel="noreferrer" className="btn-secundario" style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px' }}>
                            🔍 Ver Capture
                          </a>
                        ) : (
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>Sin capture</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => aprobarPago(ord.id)} className="btn-primario" style={{ padding: '6px 12px', fontSize: '0.78rem', background: '#10b981', color: '#fff', borderRadius: '6px' }}>
                            ✓ Aprobar
                          </button>
                          <button onClick={() => rechazarPago(ord.id)} className="btn-secundario" style={{ padding: '6px 12px', fontSize: '0.78rem', borderColor: '#ef4444', color: '#dc2626', borderRadius: '6px' }}>
                            ✕ Rechazar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. CORTES Y LIQUIDACIONES A RESTAURANTES */}
      {tab === 'cortes' && (
        <div className="card" style={{ background: '#ffffff', borderRadius: '18px', padding: '22px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--dark-amaranth)' }}>Liquidaciones Solicitadas por Restaurantes</h3>
          {cortes.length === 0 ? (
            <p style={{ color: '#78716c', margin: 0 }}>No hay solicitudes de corte de turno pendientes.</p>
          ) : (
            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Restaurante</th>
                    <th>Ventas Brutas</th>
                    <th>Comisión App (10%)</th>
                    <th>Neto a Transferir</th>
                    <th>Estado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {cortes.map(c => {
                    const f = new Date(c.created_at);
                    const fechaStr = `${f.toLocaleDateString()} ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    const esPendiente = c.status === 'pending_settlement';
                    return (
                      <tr key={c.id}>
                        <td>{fechaStr}</td>
                        <td><strong>{c.businesses?.name || 'Local'}</strong></td>
                        <td>{formatUsd(c.gross_amount)}</td>
                        <td style={{ color: '#ef4444' }}>-{formatUsd(c.commission_amount)}</td>
                        <td>
                          <strong style={{ color: '#10b981', fontSize: '1.05rem' }}>{formatUsd(c.net_amount)}</strong>
                        </td>
                        <td>
                          <span className={`badge ${esPendiente ? 'badge-pending' : 'badge-on_the_way'}`}>
                            {esPendiente ? 'Pendiente Transferencia' : 'Liquidado'}
                          </span>
                        </td>
                        <td>
                          {esPendiente ? (
                            <button
                              onClick={() => liquidarCorte(c.id)}
                              className="btn-primario"
                              style={{ padding: '5px 12px', fontSize: '0.78rem', background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', borderRadius: '6px' }}
                            >
                              ✓ Marcar Transferido
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Procesado</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. RESTAURANTES */}
      {tab === 'locales' && (
        <div className="card" style={{ background: '#ffffff', borderRadius: '18px', padding: '22px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--dark-amaranth)' }}>Restaurantes en Plataforma</h3>
          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {locales.map(l => (
                  <tr key={l.id}>
                    <td><strong>{l.name}</strong></td>
                    <td>{l.category || 'Gastronomía'}</td>
                    <td>{l.phone || 'S/N'}</td>
                    <td>
                      <span className={`badge ${l.is_active ? 'badge-on_the_way' : 'badge-cancelled'}`}>
                        {l.is_active ? 'Abierto' : 'Pausado'}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => toggleLocal(l)}
                        className={`btn-toggle ${l.is_active ? 'pausado' : 'activo'}`}
                        style={{ padding: '4px 12px', borderRadius: '8px' }}
                      >
                        {l.is_active ? 'Pausar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. REPARTIDORES */}
      {tab === 'drivers' && (
        <div className="card" style={{ background: '#ffffff', borderRadius: '18px', padding: '22px', border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--dark-amaranth)' }}>Flota de Repartidores & Control de Deuda</h3>
          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Repartidor</th>
                  <th>Vehículo / Placa</th>
                  <th>Teléfono</th>
                  <th>Saldo a Favor</th>
                  <th>Deuda Efectivo (Tope $25)</th>
                  <th>Estado</th>
                  <th>Acciones de Caja</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => {
                  const w = d.delivery_wallets?.[0] || d.delivery_wallets;
                  const saldo = parseFloat(w?.prepaid_balance || 0);
                  const deuda = parseFloat(w?.cash_debt || 0);
                  const bloqueado = deuda >= 25.00;
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.full_name}</strong></td>
                      <td>{d.vehicle_type?.toUpperCase()} • {d.vehicle_plate || 'S/P'}</td>
                      <td>{d.phone || 'S/N'}</td>
                      <td style={{ color: '#10b981', fontWeight: 'bold' }}>{formatUsd(saldo)}</td>
                      <td style={{ color: bloqueado ? '#ef4444' : 'var(--golden-orange)', fontWeight: 'bold' }}>
                        {formatUsd(deuda)} {bloqueado && '⚠️ (Bloqueado)'}
                      </td>
                      <td>
                        <span className={`badge ${d.is_online ? 'badge-on_the_way' : 'badge-delivered'}`}>
                          {d.is_online ? 'En Línea' : 'Desconectado'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleRecibirEfectivoDriver(d.id, d.full_name, deuda)}
                          disabled={deuda <= 0}
                          className="btn-primario"
                          style={{
                            padding: '5px 10px',
                            fontSize: '0.75rem',
                            background: deuda > 0 ? '#10b981' : '#9ca3af',
                            cursor: deuda > 0 ? 'pointer' : 'not-allowed',
                            color: '#fff',
                            borderRadius: '6px',
                            fontWeight: 700
                          }}
                          title="Registrar recepción de efectivo para rebajar deuda en calle"
                        >
                          💵 Recibir Efectivo
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. TODAS LAS ÓRDENES */}
      {tab === 'ordenes' && (
        <div className="card" style={{ background: '#ffffff', borderRadius: '18px', padding: '22px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>Auditoría de Órdenes</h3>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setFiltroEstadoOrdenes('todas')}
                className={`preset-pill-btn ${filtroEstadoOrdenes === 'todas' ? 'active' : ''}`}
              >
                Todas ({ordenes.length})
              </button>
              <button
                type="button"
                onClick={() => setFiltroEstadoOrdenes('activas')}
                className={`preset-pill-btn ${filtroEstadoOrdenes === 'activas' ? 'active' : ''}`}
              >
                Activas ({ordenesActivas.length})
              </button>
              <button
                type="button"
                onClick={() => setFiltroEstadoOrdenes('delivered')}
                className={`preset-pill-btn ${filtroEstadoOrdenes === 'delivered' ? 'active' : ''}`}
              >
                Entregadas
              </button>
              <button
                type="button"
                onClick={() => setFiltroEstadoOrdenes('cancelled')}
                className={`preset-pill-btn ${filtroEstadoOrdenes === 'cancelled' ? 'active' : ''}`}
              >
                Canceladas
              </button>
            </div>
          </div>

          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Local</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Método</th>
                  <th>Estado</th>
                  <th>Acciones de Cierre</th>
                </tr>
              </thead>
              <tbody>
                {ordenes
                  .filter(o => {
                    if (filtroEstadoOrdenes === 'activas') return !['delivered', 'cancelled', 'rejected'].includes(o.status);
                    if (filtroEstadoOrdenes === 'delivered') return o.status === 'delivered';
                    if (filtroEstadoOrdenes === 'cancelled') return o.status === 'cancelled';
                    return true;
                  })
                  .map(o => {
                    const esActiva = !['delivered', 'cancelled', 'rejected'].includes(o.status);
                    return (
                      <tr key={o.id}>
                        <td><strong>#ORD-{o.id.slice(0, 8)}</strong></td>
                        <td>{o.businesses?.name || 'Local'}</td>
                        <td>{o.customer_name}</td>
                        <td style={{ color: '#10b981', fontWeight: 'bold' }}>{formatUsd(o.total)}</td>
                        <td>{(o.payment_method || 'Digital').toUpperCase()}</td>
                        <td>
                          <span className={`badge badge-${o.status}`}>
                            {o.status.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {esActiva ? (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                onClick={() => forzarCierreEntregada(o.id)}
                                style={{
                                  background: '#ecfdf5',
                                  color: '#065f46',
                                  border: '1px solid #a7f3d0',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                ✓ Entregar
                              </button>
                              <button
                                type="button"
                                onClick={() => forzarCierreCancelada(o.id)}
                                style={{
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  border: '1px solid #fca5a5',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                ✕ Cancelar
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Cerrada</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
