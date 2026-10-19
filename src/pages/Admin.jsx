import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';

export default function Admin() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const [tab, setTab] = useState('pagos'); // 'pagos', 'locales', 'cortes', 'drivers', 'ordenes'
  const [pagos, setPagos] = useState([]);
  const [cortes, setCortes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [locales, setLocales] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);

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
      .limit(50);

    setOrdenes(data || []);
  }

  async function aprobarPago(ordenId) {
    if (!confirm('¿Aprobar pago y enviar orden directamente a cocina?')) return;
    const { error } = await supabase
      .from('orders')
      .update({ status: 'pending' })
      .eq('id', ordenId);

    if (!error) recargarTodoAdmin();
  }

  async function rechazarPago(ordenId) {
    const motivo = prompt('Motivo del rechazo de pago:');
    if (!motivo) return;

    const { error } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        notes: `Pago rechazado por administración: ${motivo}`
      })
      .eq('id', ordenId);

    if (!error) recargarTodoAdmin();
  }

  async function liquidarCorte(corteId) {
    if (!confirm('¿Confirmas que la transferencia fue realizada al restaurante?')) return;
    const { error } = await supabase
      .from('cash_closures')
      .update({ status: 'settled' })
      .eq('id', corteId);

    if (!error) cargarCortes();
  }

  async function toggleLocal(local) {
    const nuevo = !local.is_active;
    await supabase.from('businesses').update({ is_active: nuevo }).eq('id', local.id);
    cargarLocales();
  }

  const totalVentasEntregadas = ordenes
    .filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

  return (
    <div className="container" style={{ maxWidth: '1180px', marginTop: '26px', marginBottom: '80px' }}>
      
      {/* CABECERA ADMIN */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #333', paddingBottom: '14px', marginBottom: '22px' }}>
        <div>
          <h1 style={{ fontSize: '1.7rem', margin: 0, color: '#fff' }}>Consola Administrativa</h1>
          <small style={{ color: 'var(--text-muted)' }}>Supervisión general, pagos, liquidaciones y control de flota</small>
        </div>

        <button
          onClick={async () => {
            await signOut();
            navigate('/portal');
          }}
          className="btn-secundario"
          style={{ borderColor: 'var(--red)', color: '#fca5a5' }}
        >
          Cerrar Sesión
        </button>
      </div>

      {/* TARJETAS KPI */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <small>Pagos por Validar</small>
          <h3 style={{ color: pagos.length > 0 ? '#ef4444' : '#fff' }}>{pagos.length}</h3>
        </div>
        <div className="kpi-card">
          <small>Liquidaciones Pendientes</small>
          <h3 style={{ color: 'var(--gold)' }}>
            {cortes.filter(c => c.status === 'pending_settlement').length}
          </h3>
        </div>
        <div className="kpi-card">
          <small>Restaurantes Activos</small>
          <h3>{locales.filter(l => l.is_active).length} / {locales.length}</h3>
        </div>
        <div className="kpi-card">
          <small>Ventas Globales Entregadas</small>
          <h3 style={{ color: '#34d399' }}>{formatUsd(totalVentasEntregadas)}</h3>
        </div>
      </div>

      {/* PESTAÑAS */}
      <nav className="admin-nav">
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
          📋 Historial de Órdenes ({ordenes.length})
        </button>
      </nav>

      {/* 1. VALIDAR PAGOS */}
      {tab === 'pagos' && (
        <div className="card">
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Pagos Digitales en Verificación</h3>
          {pagos.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>✅ No hay pagos pendientes por conciliar.</p>
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
                        <strong style={{ color: '#34d399' }}>{formatUsd(ord.total)}</strong>
                      </td>
                      <td>
                        <span style={{ background: '#242424', padding: '3px 6px', borderRadius: '4px', fontSize: '0.85rem' }}>
                          {ord.payment_reference || 'S/R'}
                        </span>
                      </td>
                      <td>
                        {ord.payment_receipt_url ? (
                          <a href={ord.payment_receipt_url} target="_blank" rel="noreferrer" className="btn-secundario" style={{ fontSize: '0.75rem', padding: '3px 8px' }}>
                            🔍 Ver Imagen
                          </a>
                        ) : (
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>Sin capture</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => aprobarPago(ord.id)} className="btn-primario" style={{ padding: '4px 10px', fontSize: '0.78rem', background: 'var(--green)' }}>
                            ✓ Aprobar
                          </button>
                          <button onClick={() => rechazarPago(ord.id)} className="btn-secundario" style={{ padding: '4px 10px', fontSize: '0.78rem', borderColor: 'var(--red)', color: '#fca5a5' }}>
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

      {/* 2. CORTES Y LIQUIDACIONES */}
      {tab === 'cortes' && (
        <div className="card">
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Solicitudes de Corte de Caja (Restaurantes)</h3>
          {cortes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>No hay cortes registrados.</p>
          ) : (
            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Restaurante</th>
                    <th>Fecha</th>
                    <th>Venta Bruta</th>
                    <th>Comisión (10%)</th>
                    <th>Neto a Transferir</th>
                    <th>Estado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {cortes.map(c => {
                    const pendiente = c.status === 'pending_settlement';
                    return (
                      <tr key={c.id}>
                        <td><strong>{c.businesses?.name || 'Local'}</strong></td>
                        <td>{new Date(c.created_at).toLocaleDateString()}</td>
                        <td>{formatUsd(c.gross_amount)}</td>
                        <td style={{ color: 'var(--gold)' }}>{formatUsd(c.commission_amount)}</td>
                        <td style={{ color: '#34d399', fontWeight: 'bold' }}>{formatUsd(c.net_amount)}</td>
                        <td>
                          <span className={`badge ${pendiente ? 'badge-cooking' : 'badge-delivered'}`}>
                            {pendiente ? 'Por Liquidar' : 'Transferido'}
                          </span>
                        </td>
                        <td>
                          {pendiente ? (
                            <button
                              onClick={() => liquidarCorte(c.id)}
                              className="btn-primario"
                              style={{ padding: '4px 10px', fontSize: '0.78rem', background: 'var(--green)' }}
                            >
                              Marcar Pagado
                            </button>
                          ) : (
                            <span style={{ color: '#888', fontSize: '0.8rem' }}>Completado</span>
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

      {/* 3. RESTAURANTES */}
      {tab === 'locales' && (
        <div className="card">
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Gestión de Locales Gastronómicos</h3>
          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Restaurante</th>
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

      {/* 4. REPARTIDORES */}
      {tab === 'drivers' && (
        <div className="card">
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Flota de Repartidores</h3>
          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Repartidor</th>
                  <th>Vehículo / Placa</th>
                  <th>Teléfono</th>
                  <th>Deuda Efectivo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => {
                  const w = d.delivery_wallets?.[0] || d.delivery_wallets;
                  const deuda = parseFloat(w?.cash_debt || 0);
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.full_name}</strong></td>
                      <td>{d.vehicle_type?.toUpperCase()} • {d.vehicle_plate || 'S/P'}</td>
                      <td>{d.phone || 'S/N'}</td>
                      <td style={{ color: deuda >= 20 ? '#ef4444' : 'var(--gold)', fontWeight: 'bold' }}>
                        {formatUsd(deuda)}
                      </td>
                      <td>
                        <span className={`badge ${d.is_online ? 'badge-on_the_way' : 'badge-delivered'}`}>
                          {d.is_online ? 'En Línea' : 'Desconectado'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. HISTORIAL DE ÓRDENES */}
      {tab === 'ordenes' && (
        <div className="card">
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Últimas Órdenes en Plataforma</h3>
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
                </tr>
              </thead>
              <tbody>
                {ordenes.map(o => (
                  <tr key={o.id}>
                    <td><strong>#ORD-{o.id.slice(0, 8)}</strong></td>
                    <td>{o.businesses?.name || 'Local'}</td>
                    <td>{o.customer_name}</td>
                    <td style={{ color: '#34d399', fontWeight: 'bold' }}>{formatUsd(o.total)}</td>
                    <td>{(o.payment_method || 'Digital').toUpperCase()}</td>
                    <td>
                      <span className={`badge badge-${o.status}`}>
                        {o.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

