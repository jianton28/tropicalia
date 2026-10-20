import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';
import { descontarStockDeOrden, cancelarOrdenConReversion } from '../services/inventoryService';
import { abrirNotificacionWhatsApp } from '../services/whatsappService';

function playBeepSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.warn('AudioContext no soportado o bloqueado', e);
  }
}

export default function Cocina() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [local, setLocal] = useState(null);
  const [comandas, setComandas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Tab interna
  const [tab, setTab] = useState('comandas'); // 'comandas', 'inventario', 'menu', 'salon'

  // Formulario nuevo insumo
  const [nombreInsumo, setNombreInsumo] = useState('');
  const [cantInsumo, setCantInsumo] = useState('');
  const [unidadInsumo, setUnidadInsumo] = useState('unidades');
  const [minInsumo, setMinInsumo] = useState('5');
  const [mostrarFormInsumo, setMostrarFormInsumo] = useState(false);

  // Venta en salón
  const [salonProdId, setSalonProdId] = useState('');
  const [salonCant, setSalonCant] = useState(1);

  // Notificación de acción
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    if (!user) return;
    initCocina();

    // Suscripción Realtime
    const channel = supabase.channel('cocina-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        playBeepSound();
        cargarComandas(local?.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        cargarComandas(local?.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => {
        cargarInventario(local?.id);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user, local?.id]);

  async function initCocina() {
    setLoading(true);
    let { data: neg } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (!neg) {
      const { data: lista } = await supabase.from('businesses').select('*').order('created_at', { ascending: true });
      if (lista && lista.length > 0) {
        neg = lista[0];
      }
    }

    if (!neg) {
      alert('No se encontró un restaurante asociado a tu cuenta.');
      setLoading(false);
      return;
    }

    setLocal(neg);
    await Promise.all([
      cargarComandas(neg.id),
      cargarInventario(neg.id),
      cargarProductosYRecetas(neg.id)
    ]);
    setLoading(false);
  }

  async function cargarComandas(businessId) {
    if (!businessId) return;
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    setComandas(data || []);
  }

  async function cargarInventario(businessId) {
    if (!businessId) return;
    const { data } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('business_id', businessId)
      .order('name', { ascending: true });

    setInsumos(data || []);
  }

  async function cargarProductosYRecetas(businessId) {
    if (!businessId) return;
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .order('name', { ascending: true });

    setProductos(prods || []);
    if (prods && prods.length > 0 && !salonProdId) {
      setSalonProdId(prods[0].id);
    }

    const prodIds = (prods || []).map(p => p.id);
    if (prodIds.length > 0) {
      const { data: recs } = await supabase
        .from('product_recipes')
        .select('*')
        .in('product_id', prodIds);
      setRecetas(recs || []);
    }
  }

  function showNotification(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3500);
  }

  async function toggleEstadoLocal() {
    if (!local) return;
    const nuevo = !local.is_active;
    const { error } = await supabase
      .from('businesses')
      .update({ is_active: nuevo })
      .eq('id', local.id);

    if (!error) {
      setLocal({ ...local, is_active: nuevo });
      showNotification(`Local ${nuevo ? 'abierto para pedidos' : 'pausado temporalmente'}`);
    }
  }

  /**
   * Cambia el estado de una orden, descontando stock en 'cooking', notificando por WhatsApp
   * y manejando transiciones para Pickup y Delivery.
   */
  async function cambiarEstadoComanda(ordenId, nuevoEstado) {
    const orden = comandas.find(o => o.id === ordenId);
    if (!orden) return;

    const payload = { status: nuevoEstado };
    if (nuevoEstado === 'on_the_way') {
      payload.delivery_status = 'on_the_way';
    }

    // 1. Al pasar a 'cooking': descontar insumos de recetas e inventario
    if (nuevoEstado === 'cooking') {
      await descontarStockDeOrden(orden);
      await cargarInventario(local.id);

      // Disparador automático de WhatsApp al cliente
      abrirNotificacionWhatsApp(orden, 'cooking', local);
      showNotification(`👨‍🍳 Comanda en preparación. Notificación enviada por WhatsApp.`);
    }

    // 2. Al pasar a 'ready': avisar al cliente para retiro en barra o repartidor
    if (nuevoEstado === 'ready') {
      abrirNotificacionWhatsApp(orden, 'ready', local);
      showNotification(orden.delivery_type === 'pickup'
        ? '🥡 Pedido listo en barra. WhatsApp enviado al cliente.'
        : '📦 Pedido empacado. Repartidores notificados.'
      );
    }

    // 3. Al entregar en barra directamente
    if (nuevoEstado === 'delivered') {
      showNotification('🎉 ¡Pedido completado y entregado al cliente!');
    }

    await supabase.from('orders').update(payload).eq('id', ordenId);
    await cargarComandas(local.id);
  }

  /**
   * Cancelación de comanda por la cocina con reversión automática de stock
   */
  async function handleCancelarComanda(orden) {
    const motivo = window.prompt(
      `¿Seguro que deseas cancelar la comanda #${orden.id.slice(0, 8)}?\nLos insumos serán revertidos automáticamente al inventario.\n\nIngresa el motivo:`,
      'Agotamiento imprevisto de insumos / Cancelado por cocina'
    );

    if (!motivo) return;

    try {
      const res = await cancelarOrdenConReversion(orden.id, motivo, 'cocina');
      showNotification(`❌ Comanda cancelada. Se reintegraron ${res.reversionCount || 0} artículos al stock.`);

      // Disparar mensaje de aviso de cancelación
      abrirNotificacionWhatsApp(orden, 'cancelled', local);

      await Promise.all([
        cargarComandas(local.id),
        cargarInventario(local.id)
      ]);
    } catch (err) {
      alert('Error al cancelar comanda: ' + err.message);
    }
  }

  async function ajustarInsumo(id, actual, delta) {
    const nuevaCant = Math.max(0, parseFloat(actual) + delta);
    await supabase.from('inventory_items').update({ quantity: nuevaCant }).eq('id', id);
    await cargarInventario(local.id);
  }

  async function handleCrearInsumo(e) {
    e.preventDefault();
    if (!local) return;
    const { error } = await supabase.from('inventory_items').insert([{
      business_id: local.id,
      name: nombreInsumo.trim(),
      quantity: parseFloat(cantInsumo || '0'),
      unit: unidadInsumo.trim(),
      min_threshold: parseFloat(minInsumo || '5'),
    }]);

    if (!error) {
      setNombreInsumo('');
      setCantInsumo('');
      setMostrarFormInsumo(false);
      showNotification('Insumo registrado correctamente');
      await cargarInventario(local.id);
    } else {
      alert('Error registrando insumo: ' + error.message);
    }
  }

  async function handleTogglePlato(p) {
    await supabase
      .from('products')
      .update({ is_available: !p.is_available })
      .eq('id', p.id);

    await cargarProductosYRecetas(local.id);
  }

  async function handleVentaSalon(e) {
    e.preventDefault();
    const prod = productos.find(p => p.id === salonProdId);
    if (!prod) return;

    const cant = parseInt(salonCant || 1);
    await descontarStockDeOrden({
      business_id: local.id,
      items: [{ product_id: prod.id, name: prod.name, quantity: cant }]
    });

    await supabase.from('kitchen_logs').insert([{
      business_id: local.id,
      log_type: 'venta_salon',
      item_name: prod.name,
      quantity: cant,
      amount_usd: parseFloat(prod.price) * cant,
      notes: 'Venta presencial en mostrador'
    }]);

    showNotification(`✅ Venta registrada: ${cant}x ${prod.name}`);
    await cargarInventario(local.id);
  }

  async function solicitarCorteCaja() {
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);
    const entregadasHoy = comandas.filter(o => o.status === 'delivered' && new Date(o.created_at) >= hoyInicio);
    const bruto = entregadasHoy.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);

    if (bruto <= 0) {
      alert('No tienes órdenes entregadas hoy pendientes por liquidar.');
      return;
    }

    const comision = bruto * 0.10;
    const neto = bruto - comision;

    const { error } = await supabase.from('cash_closures').insert([{
      business_id: local.id,
      gross_amount: bruto,
      commission_amount: comision,
      net_amount: neto,
      status: 'pending_settlement'
    }]);

    if (!error) {
      alert(`✅ Solicitud de liquidación enviada por ${formatUsd(neto)}. Administración procesará tu transferencia.`);
    } else {
      alert('Error al enviar corte: ' + error.message);
    }
  }

  // Comandas activas en cocina
  const comandasEnCurso = comandas.filter(o => !['delivered', 'cancelled', 'rejected'].includes(o.status));

  // Cálculo de caja de hoy
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  const entregadasHoy = comandas.filter(o => o.status === 'delivered' && new Date(o.created_at) >= hoyInicio);
  const brutoHoy = entregadasHoy.reduce((acc, o) => acc + parseFloat(o.subtotal_food || o.total || 0), 0);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#f8f9fb', paddingBottom: '90px' }}>
      
      {/* TOAST DE FEEDBACK */}
      {toastMsg && (
        <div className="toast-feedback">
          {toastMsg}
        </div>
      )}

      {/* CABECERA OFICIAL TROPICALIA KDS */}
      <header className="figma-header" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>
              KDS • Centro de Operaciones
            </span>
            <h1 style={{ fontSize: '1.6rem', margin: '2px 0 0 0', color: '#ffffff' }}>
              {local ? local.name : 'Panel de Cocina'}
            </h1>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {local && (
              <button
                type="button"
                onClick={toggleEstadoLocal}
                style={{
                  background: local.is_active ? '#10b981' : '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '999px',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
              >
                {local.is_active ? '🟢 Abierto' : '🔴 Pausado'}
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate('/portal');
              }}
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '8px 16px',
                borderRadius: '999px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <div style={{ padding: '0 20px' }}>

        {/* MÉTRICA RÁPIDA DE CAJA */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '18px',
          padding: '16px 20px',
          boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <span style={{ fontSize: '0.78rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>
                Caja de Hoy (Órdenes Entregadas)
              </span>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--dark-amaranth)', marginTop: '2px' }}>
                Bruto: {formatUsd(brutoHoy)} • <span style={{ color: '#10b981' }}>Neto (90%): {formatUsd(brutoHoy * 0.90)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={solicitarCorteCaja}
              className="btn-primario"
              style={{ fontSize: '0.84rem', padding: '8px 16px' }}
            >
              💰 Solicitar Liquidación
            </button>
          </div>
        </div>

        {/* PESTAÑAS DE CONTROL */}
        <nav style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '16px', scrollbarWidth: 'none' }}>
          {[
            { id: 'comandas', label: `📋 Comandas Activas (${comandasEnCurso.length})` },
            { id: 'inventario', label: `📦 Inventario (${insumos.length})` },
            { id: 'menu', label: `🍔 Platos (${productos.length})` },
            { id: 'salon', label: `🏪 Venta Salón` }
          ].map(tabItem => (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setTab(tabItem.id)}
              style={{
                background: tab === tabItem.id ? 'var(--dark-amaranth)' : '#ffffff',
                color: tab === tabItem.id ? '#ffffff' : '#4b5563',
                border: tab === tabItem.id ? '1px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                padding: '8px 16px',
                borderRadius: '999px',
                fontWeight: 700,
                fontSize: '0.84rem',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {tabItem.label}
            </button>
          ))}
        </nav>

        {/* 1. VISTA DE COMANDAS ACTIVAS */}
        {tab === 'comandas' && (
          <div>
            {loading ? (
              <p style={{ color: 'var(--text-muted)' }}>Cargando comandas...</p>
            ) : comandasEnCurso.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', background: '#ffffff', borderRadius: '20px', border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: '2.5rem' }}>👨‍🍳</span>
                <p style={{ color: '#6b7280', margin: '8px 0 0 0', fontWeight: 600 }}>No hay pedidos pendientes en cocina en este momento.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                {comandasEnCurso.map(ord => {
                  const itemsLista = Array.isArray(ord.items) ? ord.items : [];
                  const esPickup = ord.delivery_type === 'pickup';

                  return (
                    <div
                      key={ord.id}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderLeft: `5px solid ${esPickup ? 'var(--golden-orange)' : 'var(--dark-amaranth)'}`,
                        borderRadius: '18px',
                        padding: '16px',
                        boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div>
                        {/* ENCABEZADO DE TARJETA */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <strong style={{ fontSize: '1rem', color: 'var(--dark-amaranth)' }}>
                            #ORD-{(ord.id || '').slice(0, 8).toUpperCase()}
                          </strong>
                          
                          {/* BADGE DE MODALIDAD (RETIRO VS DELIVERY) */}
                          <span style={{
                            background: esPickup ? '#fef3c7' : '#ede9fe',
                            color: esPickup ? '#92400e' : '#5b21b6',
                            border: `1px solid ${esPickup ? '#fde68a' : '#ddd6fe'}`,
                            fontSize: '0.74rem',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontWeight: 800
                          }}>
                            {esPickup ? '🥡 RETIRO EN BARRA' : '🛵 DELIVERY'}
                          </span>
                        </div>

                        {/* LISTA DE PLATOS */}
                        <div style={{ fontSize: '0.9rem', borderBottom: '1px dashed #e5e7eb', paddingBottom: '10px', marginBottom: '10px' }}>
                          {itemsLista.map((it, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                              <strong>{it.quantity || 1}x {it.name}</strong>
                              <span style={{ color: '#6b7280' }}>{formatUsd(it.price || 0)}</span>
                            </div>
                          ))}
                        </div>

                        {/* DATOS DEL CLIENTE */}
                        <div style={{ fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.5 }}>
                          <div><strong>Cliente:</strong> {ord.customer_name || 'Cliente'}</div>
                          <div><strong>Teléfono:</strong> {ord.customer_phone || 'Sin número'}</div>
                          <div><strong>Pago:</strong> {(ord.payment_method || 'Digital').toUpperCase()} • <strong>Total:</strong> {formatUsd(ord.total || 0)}</div>
                          {ord.notes && (
                            <div style={{ marginTop: '6px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '6px 10px', borderRadius: '8px' }}>
                              <strong>Nota de Cocina:</strong> {ord.notes}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* BOTONES DE ACCIÓN */}
                      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {['pending', 'confirmed', 'paid', 'pending_payment_verification'].includes(ord.status) && (
                            <button
                              type="button"
                              onClick={() => cambiarEstadoComanda(ord.id, 'cooking')}
                              className="btn-primario"
                              style={{ flex: 1, padding: '10px', fontSize: '0.85rem' }}
                            >
                              👨‍🍳 Iniciar Preparación
                            </button>
                          )}

                          {ord.status === 'cooking' && (
                            <button
                              type="button"
                              onClick={() => cambiarEstadoComanda(ord.id, esPickup ? 'ready' : 'ready')}
                              style={{
                                flex: 1,
                                background: '#10b981',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '999px',
                                fontWeight: 800,
                                fontSize: '0.85rem',
                                padding: '10px',
                                cursor: 'pointer'
                              }}
                            >
                              {esPickup ? '🥡 ¡Listo en Barra!' : '📦 ¡Listo para Despacho!'}
                            </button>
                          )}

                          {ord.status === 'ready' && esPickup && (
                            <button
                              type="button"
                              onClick={() => cambiarEstadoComanda(ord.id, 'delivered')}
                              style={{
                                flex: 1,
                                background: '#059669',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '999px',
                                fontWeight: 800,
                                fontSize: '0.85rem',
                                padding: '10px',
                                cursor: 'pointer'
                              }}
                            >
                              🎉 Entregar a Cliente en Mostrador
                            </button>
                          )}
                        </div>

                        {/* ACCIONES SECUNDARIAS: WHATSAPP Y CANCELACIÓN CON REVERSIÓN */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => abrirNotificacionWhatsApp(ord, ord.status, local)}
                            style={{
                              flex: 1,
                              background: '#25D366',
                              color: '#ffffff',
                              border: 'none',
                              padding: '8px 12px',
                              borderRadius: '999px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px'
                            }}
                            title={`Enviar mensaje WhatsApp al ${ord.customer_phone}`}
                          >
                            💬 WhatsApp Cliente
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCancelarComanda(ord)}
                            style={{
                              background: '#fee2e2',
                              color: '#b91c1c',
                              border: '1px solid #fca5a5',
                              padding: '8px 12px',
                              borderRadius: '999px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                            title="Cancela la comanda y revierte el stock"
                          >
                            ✕ Cancelar
                          </button>
                        </div>

                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. VISTA DE INVENTARIO */}
        {tab === 'inventario' && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '20px', boxShadow: '0 4px 14px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>Control de Insumos</h3>
              <button
                type="button"
                onClick={() => setMostrarFormInsumo(!mostrarFormInsumo)}
                className="btn-secundario"
                style={{ fontSize: '0.8rem' }}
              >
                {mostrarFormInsumo ? 'Cerrar' : '+ Nuevo Insumo'}
              </button>
            </div>

            {mostrarFormInsumo && (
              <form onSubmit={handleCrearInsumo} style={{ background: '#f8f9fb', padding: '16px', borderRadius: '12px', marginBottom: '16px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <label>Nombre:</label>
                    <input type="text" className="form-input-figma" value={nombreInsumo} onChange={e => setNombreInsumo(e.target.value)} required placeholder="Ej: Pan de Hamburguesa" />
                  </div>
                  <div>
                    <label>Cantidad Inicial:</label>
                    <input type="number" step="any" className="form-input-figma" value={cantInsumo} onChange={e => setCantInsumo(e.target.value)} required placeholder="Ej: 50" />
                  </div>
                  <div>
                    <label>Unidad:</label>
                    <input type="text" className="form-input-figma" value={unidadInsumo} onChange={e => setUnidadInsumo(e.target.value)} placeholder="unidades / kg / g" />
                  </div>
                  <div>
                    <label>Mínimo Crítico:</label>
                    <input type="number" step="any" className="form-input-figma" value={minInsumo} onChange={e => setMinInsumo(e.target.value)} placeholder="Ej: 10" />
                  </div>
                </div>
                <button type="submit" className="btn-primario" style={{ marginTop: '8px' }}>Guardar Insumo</button>
              </form>
            )}

            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th>Stock Actual</th>
                    <th>Mínimo</th>
                    <th>Ajuste Rápido</th>
                  </tr>
                </thead>
                <tbody>
                  {insumos.map(ins => {
                    const cant = parseFloat(ins.quantity || 0);
                    const min = parseFloat(ins.min_threshold || 0);
                    const bajo = cant <= min;
                    return (
                      <tr key={ins.id}>
                        <td style={{ fontWeight: 600, color: bajo ? '#b91c1c' : '#1f2937' }}>
                          {bajo ? '⚠️ ' : ''}{ins.name}
                        </td>
                        <td>{cant} {ins.unit}</td>
                        <td>{min} {ins.unit}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" onClick={() => ajustarInsumo(ins.id, cant, 10)} className="btn-secundario" style={{ padding: '2px 8px', color: '#10b981' }}>+10</button>
                            <button type="button" onClick={() => ajustarInsumo(ins.id, cant, -10)} className="btn-secundario" style={{ padding: '2px 8px', color: '#b91c1c' }}>-10</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. VISTA DE MENÚ */}
        {tab === 'menu' && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '20px', boxShadow: '0 4px 14px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 14px 0', color: 'var(--dark-amaranth)' }}>Platos del Menú</h3>
            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Nombre del Plato</th>
                    <th>Precio USD</th>
                    <th>Estado en Tienda</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td>{formatUsd(p.price)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleTogglePlato(p)}
                          style={{
                            background: p.is_available ? '#ecfdf5' : '#fef2f2',
                            color: p.is_available ? '#065f46' : '#b91c1c',
                            border: `1px solid ${p.is_available ? '#a7f3d0' : '#fca5a5'}`,
                            padding: '4px 12px',
                            borderRadius: '999px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer'
                          }}
                        >
                          {p.is_available ? '🟢 Disponible' : '🔴 Pausado'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. VENTA EN SALÓN */}
        {tab === 'salon' && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '20px', boxShadow: '0 4px 14px rgba(0,0,0,0.04)', maxWidth: '520px' }}>
            <h3 style={{ margin: '0 0 14px 0', color: 'var(--dark-amaranth)' }}>Registrar Venta Presencial (Salón)</h3>
            <form onSubmit={handleVentaSalon}>
              <label>Selecciona el Plato:</label>
              <select value={salonProdId} onChange={e => setSalonProdId(e.target.value)} className="form-input-figma">
                {productos.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatUsd(p.price)})
                  </option>
                ))}
              </select>

              <label>Cantidad:</label>
              <input
                type="number"
                min={1}
                className="form-input-figma"
                value={salonCant}
                onChange={e => setSalonCant(parseInt(e.target.value) || 1)}
              />

              <button type="submit" className="btn-primario" style={{ width: '100%', marginTop: '8px' }}>
                Registrar y Descontar Receta
              </button>
            </form>
          </div>
        )}

      </div>

    </div>
  );
}
