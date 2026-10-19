import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';

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
    console.warn('AudioContext not allowed or supported', e);
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

  useEffect(() => {
    if (!user) return;
    initCocina();

    // Suscripción Realtime
    const channel = supabase.channel('cocina-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
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

  async function toggleEstadoLocal() {
    if (!local) return;
    const nuevo = !local.is_active;
    const { error } = await supabase
      .from('businesses')
      .update({ is_active: nuevo })
      .eq('id', local.id);

    if (!error) {
      setLocal({ ...local, is_active: nuevo });
    }
  }

  async function descontarInsumosPorReceta(productId, cantidad) {
    const recs = recetas.filter(r => r.product_id === productId);
    for (const r of recs) {
      const ins = insumos.find(i => i.id === r.inventory_item_id);
      if (ins) {
        const desc = parseFloat(r.quantity_required || 0) * cantidad;
        const nuevaCant = Math.max(0, parseFloat(ins.quantity || 0) - desc);
        await supabase
          .from('inventory_items')
          .update({ quantity: nuevaCant })
          .eq('id', ins.id);
      }
    }
  }

  async function cambiarEstadoComanda(ordenId, nuevoEstado) {
    const payload = { status: nuevoEstado };
    if (nuevoEstado === 'on_the_way') {
      payload.delivery_status = 'on_the_way';
    }

    if (nuevoEstado === 'cooking') {
      const orden = comandas.find(o => o.id === ordenId);
      if (orden && Array.isArray(orden.items)) {
        for (const item of orden.items) {
          const cant = parseInt(item.quantity || 1);
          const prod = productos.find(p => p.id === item.id || p.name.toLowerCase() === (item.name || '').toLowerCase());
          if (prod) {
            const nuevoStock = Math.max(0, (prod.stock ?? 50) - cant);
            await supabase.from('products').update({ stock: nuevoStock }).eq('id', prod.id);
            await descontarInsumosPorReceta(prod.id, cant);
          }
        }
        await cargarInventario(local.id);
      }
    }

    await supabase.from('orders').update(payload).eq('id', ordenId);
    await cargarComandas(local.id);
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
    const nuevoStock = Math.max(0, (prod.stock ?? 50) - cant);

    await supabase.from('products').update({ stock: nuevoStock }).eq('id', prod.id);
    await descontarInsumosPorReceta(prod.id, cant);

    await supabase.from('kitchen_logs').insert([{
      business_id: local.id,
      log_type: 'venta_salon',
      item_name: prod.name,
      quantity: cant,
      amount_usd: parseFloat(prod.price) * cant,
      notes: 'Venta presencial en mostrador'
    }]);

    alert(`✅ Venta registrada: ${cant}x ${prod.name}.`);
    await cargarInventario(local.id);
    await cargarProductosYRecetas(local.id);
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
    <div className="container" style={{ maxWidth: '1080px', marginTop: '24px', marginBottom: '80px' }}>
      
      {/* CABECERA COCINA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #333', paddingBottom: '14px', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#fff' }}>
            {local ? `${local.name} - Operaciones` : 'Panel de Cocina'}
          </h1>
          <small style={{ color: 'var(--text-muted)' }}>Pantalla KDS de preparación, menú e inventario</small>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {local && (
            <button
              onClick={toggleEstadoLocal}
              className={`btn-toggle ${local.is_active ? 'activo' : 'pausado'}`}
            >
              {local.is_active ? '🟢 Local Abierto' : '🔴 Local Pausado'}
            </button>
          )}

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

      {/* MÉTRICA RÁPIDA DE CAJA */}
      <div className="card" style={{ marginBottom: '20px', background: '#161616' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Corte de Caja Hoy (Órdenes Entregadas)</span>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--gold)', marginTop: '2px' }}>
              Bruto: {formatUsd(brutoHoy)} • Neto Local (90%): {formatUsd(brutoHoy * 0.90)}
            </div>
          </div>
          <button
            onClick={solicitarCorteCaja}
            className="btn-primario"
            style={{ fontSize: '0.85rem', padding: '8px 14px' }}
          >
            💰 Solicitar Liquidación
          </button>
        </div>
      </div>

      {/* PESTAÑAS DE CONTROL */}
      <nav className="admin-nav">
        <button
          className={`btn-tab ${tab === 'comandas' ? 'activo' : ''}`}
          onClick={() => setTab('comandas')}
        >
          📋 Comandas Activas ({comandasEnCurso.length})
        </button>
        <button
          className={`btn-tab ${tab === 'inventario' ? 'activo' : ''}`}
          onClick={() => setTab('inventario')}
        >
          📦 Insumos e Inventario ({insumos.length})
        </button>
        <button
          className={`btn-tab ${tab === 'menu' ? 'activo' : ''}`}
          onClick={() => setTab('menu')}
        >
          🍔 Menú de Platos ({productos.length})
        </button>
        <button
          className={`btn-tab ${tab === 'salon' ? 'activo' : ''}`}
          onClick={() => setTab('salon')}
        >
          🏪 Venta Salón / Mostrador
        </button>
      </nav>

      {/* 1. VISTA DE COMANDAS ACTIVAS */}
      {tab === 'comandas' && (
        <div>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Cargando comandas...</p>
          ) : comandasEnCurso.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '36px' }}>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>No hay pedidos pendientes en cocina en este momento.</p>
            </div>
          ) : (
            <div className="grid-cards">
              {comandasEnCurso.map(ord => {
                const itemsLista = Array.isArray(ord.items) ? ord.items : [];
                return (
                  <div key={ord.id} className="card" style={{ borderLeft: '4px solid var(--gold)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong>#ORD-{ord.id.slice(0, 8)}</strong>
                      <span className={`badge badge-${ord.status}`}>{ord.status.toUpperCase()}</span>
                    </div>

                    <div style={{ fontSize: '0.9rem', borderBottom: '1px dashed #333', paddingBottom: '8px', marginBottom: '8px' }}>
                      {itemsLista.map((it, idx) => (
                        <div key={idx}>
                          <strong>{it.quantity || 1}x {it.name}</strong> ({formatUsd(it.price || 0)})
                        </div>
                      ))}
                    </div>

                    <div style={{ fontSize: '0.82rem', color: '#ccc' }}>
                      <div><strong>Cliente:</strong> {ord.customer_name || 'Cliente'} ({ord.customer_phone || 'S/N'})</div>
                      <div><strong>Tipo:</strong> {ord.delivery_type === 'delivery' ? '🛵 Delivery' : '🛍️ Pickup'} • <strong>Pago:</strong> {(ord.payment_method || 'Digital').toUpperCase()}</div>
                      {ord.notes && <div style={{ color: 'var(--gold)' }}><strong>Nota:</strong> {ord.notes}</div>}
                    </div>

                    {ord.delivery_type === 'delivery' && (
                      <div style={{ background: '#262626', padding: '6px 10px', borderRadius: '6px', fontSize: '0.8rem', color: '#fbbf24', marginTop: '8px' }}>
                        {!ord.driver_id ? '🛵 Buscando repartidor cercano...' : '🛵 Repartidor asignado en curso'}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      {['pending', 'confirmed', 'paid'].includes(ord.status) && (
                        <button
                          type="button"
                          onClick={() => cambiarEstadoComanda(ord.id, 'cooking')}
                          className="btn-primario"
                          style={{ flex: 1 }}
                        >
                          👨‍🍳 Pasar a Cocinando
                        </button>
                      )}

                      {ord.status === 'cooking' && (
                        <button
                          type="button"
                          onClick={() => cambiarEstadoComanda(ord.id, ord.delivery_type === 'pickup' ? 'delivered' : 'on_the_way')}
                          className="btn-primario"
                          style={{ flex: 1, background: 'var(--green)' }}
                        >
                          {ord.delivery_type === 'pickup' ? '🛍️ Entregar a Cliente' : '📦 Listo para Motorizado'}
                        </button>
                      )}
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
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, color: 'var(--gold)' }}>Control de Insumos</h3>
            <button
              onClick={() => setMostrarFormInsumo(!mostrarFormInsumo)}
              className="btn-secundario"
              style={{ fontSize: '0.8rem' }}
            >
              {mostrarFormInsumo ? 'Cerrar' : '+ Nuevo Insumo'}
            </button>
          </div>

          {mostrarFormInsumo && (
            <form onSubmit={handleCrearInsumo} style={{ background: '#141414', padding: '14px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #333' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                <div>
                  <label>Nombre:</label>
                  <input type="text" value={nombreInsumo} onChange={e => setNombreInsumo(e.target.value)} required placeholder="Ej: Pan de Hamburguesa" />
                </div>
                <div>
                  <label>Cantidad Inicial:</label>
                  <input type="number" step="any" value={cantInsumo} onChange={e => setCantInsumo(e.target.value)} required placeholder="Ej: 50" />
                </div>
                <div>
                  <label>Unidad:</label>
                  <input type="text" value={unidadInsumo} onChange={e => setUnidadInsumo(e.target.value)} placeholder="unidades / kg / g" />
                </div>
                <div>
                  <label>Mínimo Crítico:</label>
                  <input type="number" step="any" value={minInsumo} onChange={e => setMinInsumo(e.target.value)} placeholder="Ej: 10" />
                </div>
              </div>
              <button type="submit" className="btn-primario" style={{ marginTop: '10px' }}>Guardar Insumo</button>
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
                      <td style={{ fontWeight: 600, color: bajo ? '#fca5a5' : '#fff' }}>
                        {bajo ? '⚠️ ' : ''}{ins.name}
                      </td>
                      <td>{cant} {ins.unit}</td>
                      <td>{min} {ins.unit}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => ajustarInsumo(ins.id, cant, 10)} className="btn-secundario" style={{ padding: '2px 8px', color: '#34d399' }}>+10</button>
                          <button onClick={() => ajustarInsumo(ins.id, cant, -10)} className="btn-secundario" style={{ padding: '2px 8px', color: '#fca5a5' }}>-10</button>
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
        <div className="card">
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Platos del Menú</h3>
          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Nombre del Plato</th>
                  <th>Precio USD</th>
                  <th>Stock</th>
                  <th>Estado en Tienda</th>
                </tr>
              </thead>
              <tbody>
                {productos.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{formatUsd(p.price)}</td>
                    <td>{p.stock ?? 99}</td>
                    <td>
                      <button
                        onClick={() => handleTogglePlato(p)}
                        className={`btn-toggle ${p.is_available ? 'activo' : 'pausado'}`}
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
        <div className="card" style={{ maxWidth: '500px' }}>
          <h3 style={{ margin: '0 0 14px 0', color: 'var(--gold)' }}>Registrar Venta Presencial (Salón)</h3>
          <form onSubmit={handleVentaSalon}>
            <label>Selecciona el Plato:</label>
            <select value={salonProdId} onChange={e => setSalonProdId(e.target.value)}>
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
  );
}

