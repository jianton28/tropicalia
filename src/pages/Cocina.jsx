import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';
import { descontarStockDeOrden, cancelarOrdenConReversion } from '../services/inventoryService';
import { abrirNotificacionWhatsApp } from '../services/whatsappService';
import { procesarBalanceCompletado } from '../services/paymentService';

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

function getIngredientEmoji(name = '') {
  const n = name.toLowerCase();
  if (n.includes('tomate')) return '🍅';
  if (n.includes('queso') || n.includes('mozzarella') || n.includes('cheddar')) return '🧀';
  if (n.includes('carne') || n.includes('res') || n.includes('pollo') || n.includes('tocineta')) return '🥩';
  if (n.includes('leche') || n.includes('crema') || n.includes('lacteo')) return '🥛';
  if (n.includes('pan') || n.includes('harina') || n.includes('masa')) return '🥖';
  if (n.includes('papa') || n.includes('papas')) return '🥔';
  if (n.includes('jamon') || n.includes('jamón') || n.includes('embutido')) return '🥓';
  if (n.includes('cebolla')) return '🧅';
  if (n.includes('lechuga') || n.includes('vegetal') || n.includes('cilantro')) return '🥬';
  if (n.includes('salsa') || n.includes('ketchup') || n.includes('mayo')) return '🥫';
  if (n.includes('azucar') || n.includes('azúcar') || n.includes('dulce')) return '🍬';
  if (n.includes('aceite') || n.includes('vinagre')) return '🍾';
  if (n.includes('huevo')) return '🥚';
  if (n.includes('envase') || n.includes('bandeja') || n.includes('caja')) return '📦';
  if (n.includes('cubierto') || n.includes('tenedor') || n.includes('cuchill') || n.includes('servilleta')) return '🍴';
  return '🛒';
}

export default function Cocina() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [local, setLocal] = useState(null);
  const [comandas, setComandas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [mermas, setMermas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Tabs internas
  const [tab, setTab] = useState('comandas'); // 'comandas', 'inventario', 'merma', 'ganancias', 'menu', 'salon'

  // Búsqueda en despensa / inventario
  const [busquedaInsumo, setBusquedaInsumo] = useState('');

  // Modal Teclado Numérico para añadir stock
  const [keypadItem, setKeypadItem] = useState(null);
  const [keypadValue, setKeypadValue] = useState('');

  // Modal Confirmación de Eliminación de Insumo
  const [itemToDelete, setItemToDelete] = useState(null);
  const [deletingItem, setDeletingItem] = useState(false);

  // Formulario nuevo insumo
  const [nombreInsumo, setNombreInsumo] = useState('');
  const [cantInsumo, setCantInsumo] = useState('');
  const [unidadInsumo, setUnidadInsumo] = useState('unidades');
  const [minInsumo, setMinInsumo] = useState('5');
  const [mostrarFormInsumo, setMostrarFormInsumo] = useState(false);

  // Formulario Control de Merma
  const [mermaItemId, setMermaItemId] = useState('');
  const [mermaCantidad, setMermaCantidad] = useState('');
  const [mermaMotivo, setMermaMotivo] = useState('Vencimiento / Caducidad');
  const [mermaNotas, setMermaNotas] = useState('');
  const [registrandoMerma, setRegistrandoMerma] = useState(false);

  // Gráficos de ganancias
  const [chartPeriodo, setChartPeriodo] = useState('semana'); // 'dia', 'semana', 'mes', 'anio'
  const chartCanvasRef = useRef(null);
  const chartInstanceRef = useRef(null);

  // Venta en salón
  const [salonProdId, setSalonProdId] = useState('');
  const [salonCant, setSalonCant] = useState(1);

  // Libro de Menú (Platos & Recetas)
  const [busquedaMenu, setBusquedaMenu] = useState('');
  const [nuevoPlatoNombre, setNuevoPlatoNombre] = useState('');
  const [nuevoPlatoPrecio, setNuevoPlatoPrecio] = useState('');
  const [nuevoPlatoFoto, setNuevoPlatoFoto] = useState('');
  const [nuevoPlatoStock, setNuevoPlatoStock] = useState('50');
  const [nuevoPlatoIngredientes, setNuevoPlatoIngredientes] = useState([]);
  const [selectedIngredienteId, setSelectedIngredienteId] = useState('');
  const [selectedIngredienteCant, setSelectedIngredienteCant] = useState('');
  const [guardandoPlato, setGuardandoPlato] = useState(false);

  // Notificación toast de acción
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
      cargarProductosYRecetas(neg.id),
      cargarMermas(neg.id)
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
    if (data && data.length > 0 && !mermaItemId) {
      setMermaItemId(data[0].id);
    }
  }

  async function cargarMermas(businessId) {
    if (!businessId) return;
    const { data } = await supabase
      .from('kitchen_logs')
      .select('*')
      .eq('business_id', businessId)
      .eq('log_type', 'merma')
      .order('created_at', { ascending: false })
      .limit(15);

    setMermas(data || []);
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

  // ==============================================================================
  // GESTIÓN DE INVENTARIO: AGREGAR CON TECLADO NUMÉRICO Y ELIMINAR CON CASCADA
  // ==============================================================================
  function abrirTecladoNumerico(item) {
    setKeypadItem(item);
    setKeypadValue('');
  }

  function cerrarTecladoNumerico() {
    setKeypadItem(null);
    setKeypadValue('');
  }

  function handleKeypadPress(val) {
    if (val === 'DEL') {
      setKeypadValue(prev => prev.slice(0, -1));
    } else if (val === '.') {
      if (!keypadValue.includes('.')) {
        setKeypadValue(prev => (prev === '' ? '0.' : prev + '.'));
      }
    } else {
      setKeypadValue(prev => prev + val);
    }
  }

  function handleAddPreset(delta) {
    const current = parseFloat(keypadValue) || 0;
    setKeypadValue((current + delta).toString());
  }

  async function handleConfirmarSumaStock(e) {
    if (e) e.preventDefault();
    if (!keypadItem) return;

    const delta = parseFloat(keypadValue);
    if (isNaN(delta) || delta <= 0) {
      alert('Por favor ingresa una cantidad válida mayor a 0');
      return;
    }

    const nuevaCant = parseFloat(keypadItem.quantity || 0) + delta;
    const { error } = await supabase
      .from('inventory_items')
      .update({ quantity: nuevaCant })
      .eq('id', keypadItem.id);

    if (!error) {
      showNotification(`✅ Se sumaron +${delta} ${keypadItem.unit} a ${keypadItem.name}`);
      cerrarTecladoNumerico();
      await cargarInventario(local.id);
    } else {
      alert('Error actualizando stock: ' + error.message);
    }
  }

  // Confirmar y eliminar ingrediente con borrado en cascada de platos/recetas
  async function handleConfirmarEliminarIngrediente() {
    if (!itemToDelete) return;
    setDeletingItem(true);

    try {
      // 1. Eliminar de product_recipes (remueve el ingrediente de todos los platos)
      await supabase
        .from('product_recipes')
        .delete()
        .eq('inventory_item_id', itemToDelete.id);

      // 2. Eliminar de inventory_items
      const { error: delErr } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', itemToDelete.id);

      if (delErr) throw delErr;

      showNotification(`🗑️ Ingrediente "${itemToDelete.name}" eliminado del inventario y de sus platos asociados.`);
      setItemToDelete(null);
      setDeletingItem(false);

      await Promise.all([
        cargarInventario(local.id),
        cargarProductosYRecetas(local.id)
      ]);
    } catch (err) {
      setDeletingItem(false);
      alert('Error eliminando ingrediente: ' + err.message);
    }
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
      showNotification('Insumo registrado correctamente en la lista de compras');
      await cargarInventario(local.id);
    } else {
      alert('Error registrando insumo: ' + error.message);
    }
  }

  // ==============================================================================
  // CONTROL DE MERMA (DESPERDICIO DE MATERIAL)
  // ==============================================================================
  async function handleRegistrarMerma(e) {
    e.preventDefault();
    const ins = insumos.find(i => i.id === mermaItemId);
    if (!ins) {
      alert('Selecciona un ingrediente válido');
      return;
    }

    const cantidadPerdida = parseFloat(mermaCantidad);
    if (isNaN(cantidadPerdida) || cantidadPerdida <= 0) {
      alert('Ingresa una cantidad de merma válida mayor a 0');
      return;
    }

    setRegistrandoMerma(true);

    try {
      // 1. Descontar la cantidad del inventario
      const nuevaCant = Math.max(0, parseFloat(ins.quantity || 0) - cantidadPerdida);
      await supabase
        .from('inventory_items')
        .update({ quantity: nuevaCant })
        .eq('id', ins.id);

      // 2. Asentar en kitchen_logs como merma
      const detalleNotas = mermaNotas.trim() ? `${mermaMotivo} (${mermaNotas.trim()})` : mermaMotivo;
      await supabase.from('kitchen_logs').insert([{
        business_id: local.id,
        log_type: 'merma',
        item_name: `${ins.name} (${ins.unit})`,
        quantity: cantidadPerdida,
        amount_usd: 0,
        notes: detalleNotas
      }]);

      showNotification(`🗑️ Merma asentada: -${cantidadPerdida} ${ins.unit} de ${ins.name}`);
      setMermaCantidad('');
      setMermaNotas('');
      setRegistrandoMerma(false);

      await Promise.all([
        cargarInventario(local.id),
        cargarMermas(local.id)
      ]);
    } catch (err) {
      setRegistrandoMerma(false);
      alert('Error registrando merma: ' + err.message);
    }
  }

  // ==============================================================================
  // GESTIÓN DE COMANDAS & WHATSAPP
  // ==============================================================================
  async function cambiarEstadoComanda(ordenId, nuevoEstado) {
    const orden = comandas.find(o => o.id === ordenId);
    if (!orden) return;

    const payload = { status: nuevoEstado };
    if (nuevoEstado === 'on_the_way') {
      payload.delivery_status = 'on_the_way';
    }

    if (nuevoEstado === 'cooking') {
      await descontarStockDeOrden(orden);
      await cargarInventario(local.id);
      abrirNotificacionWhatsApp(orden, 'cooking', local);
      showNotification(`👨‍🍳 Comanda en preparación. Notificación enviada por WhatsApp.`);
    }

    if (nuevoEstado === 'ready') {
      abrirNotificacionWhatsApp(orden, 'ready', local);
      showNotification(orden.delivery_type === 'pickup'
        ? '🥡 Pedido listo en barra. WhatsApp enviado al cliente.'
        : '📦 Pedido empacado. Repartidores notificados.'
      );
    }

    if (nuevoEstado === 'delivered') {
      try {
        await procesarBalanceCompletado({ orden, driverId: orden.driver_id || null });
      } catch (e) {
        console.warn('Balance en cocina:', e);
      }
      abrirNotificacionWhatsApp(orden, 'delivered', local);
      showNotification('🎉 ¡Pedido completado y entregado al cliente! Notificación de WhatsApp enviada.');
    }

    await supabase.from('orders').update(payload).eq('id', ordenId);
    await cargarComandas(local.id);
  }

  async function handleCancelarComanda(orden) {
    const motivo = window.prompt(
      `¿Seguro que deseas cancelar la comanda #${orden.id.slice(0, 8)}?\nLos insumos serán devueltos automáticamente al inventario.\n\nIngresa el motivo:`,
      'Agotamiento imprevisto de insumos / Cancelado por cocina'
    );

    if (!motivo) return;

    try {
      const res = await cancelarOrdenConReversion(orden.id, motivo, 'cocina');
      showNotification(`❌ Comanda cancelada. Se reintegraron ${res.reversionCount || 0} artículos al stock.`);
      abrirNotificacionWhatsApp(orden, 'cancelled', local);

      await Promise.all([
        cargarComandas(local.id),
        cargarInventario(local.id)
      ]);
    } catch (err) {
      alert('Error al cancelar comanda: ' + err.message);
    }
  }

  async function handleTogglePlato(p) {
    await supabase
      .from('products')
      .update({ is_available: !p.is_available })
      .eq('id', p.id);

    await cargarProductosYRecetas(local.id);
  }

  // ==============================================================================
  // GESTIÓN DEL LIBRO DE MENÚ: AGREGAR PLATO CON RECETA Y ELIMINAR
  // ==============================================================================
  function handleAgregarIngredienteAReceta() {
    const ingId = selectedIngredienteId || (insumos[0]?.id ?? '');
    const ing = insumos.find(i => i.id === ingId);
    if (!ing) {
      alert('Selecciona un ingrediente de la lista desplegable.');
      return;
    }
    const qty = parseFloat(selectedIngredienteCant);
    if (isNaN(qty) || qty <= 0) {
      alert('Ingresa una cantidad mayor a 0 para el ingrediente.');
      return;
    }

    setNuevoPlatoIngredientes(prev => {
      const sinEste = prev.filter(p => p.ingredientId !== ing.id);
      return [...sinEste, {
        ingredientId: ing.id,
        ingredientName: ing.name,
        quantity: qty,
        unit: ing.unit || 'unidades'
      }];
    });

    setSelectedIngredienteCant('');
  }

  function handleQuitarIngredienteDeReceta(ingId) {
    setNuevoPlatoIngredientes(prev => prev.filter(p => p.ingredientId !== ingId));
  }

  async function handleCrearPlatoConReceta(e) {
    e.preventDefault();
    if (!local) return;
    const precioNum = parseFloat(nuevoPlatoPrecio);
    if (isNaN(precioNum) || precioNum <= 0) {
      alert('Por favor ingresa un precio válido mayor a 0');
      return;
    }

    setGuardandoPlato(true);
    try {
      // 1. Insertar el producto
      const { data: newProd, error: prodErr } = await supabase
        .from('products')
        .insert([{
          business_id: local.id,
          name: nuevoPlatoNombre.trim(),
          price: precioNum,
          stock: parseInt(nuevoPlatoStock) || 50,
          image_url: nuevoPlatoFoto.trim() || null,
          is_available: true
        }])
        .select()
        .single();

      if (prodErr) throw prodErr;

      // 2. Insertar ingredientes en la receta
      if (nuevoPlatoIngredientes.length > 0 && newProd) {
        const recipesPayload = nuevoPlatoIngredientes.map(ing => ({
          product_id: newProd.id,
          inventory_item_id: ing.ingredientId,
          quantity_required: parseFloat(ing.quantity)
        }));

        const { error: recErr } = await supabase
          .from('product_recipes')
          .insert(recipesPayload);

        if (recErr) console.warn('Error asociando receta:', recErr);
      }

      showNotification(`📖 Plato "${nuevoPlatoNombre}" agregado exitosamente a la carta.`);
      setNuevoPlatoNombre('');
      setNuevoPlatoPrecio('');
      setNuevoPlatoFoto('');
      setNuevoPlatoIngredientes([]);
      setSelectedIngredienteCant('');

      await cargarProductosYRecetas(local.id);
    } catch (err) {
      console.error('Error creando plato:', err);
      alert('Error al crear plato: ' + err.message);
    } finally {
      setGuardandoPlato(false);
    }
  }

  async function handleEliminarPlato(plato) {
    if (!window.confirm(`¿Seguro que deseas eliminar "${plato.name}" de la carta?\nSe eliminará de la base de datos y se borrarán sus recetas asociadas.`)) {
      return;
    }

    try {
      await supabase.from('product_recipes').delete().eq('product_id', plato.id);
      const { error } = await supabase.from('products').delete().eq('id', plato.id);
      if (error) throw error;

      showNotification(`🗑️ Plato "${plato.name}" eliminado de la carta.`);
      await cargarProductosYRecetas(local.id);
    } catch (err) {
      console.error('Error eliminando plato:', err);
      alert('Error eliminando plato: ' + err.message);
    }
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

  // ==============================================================================
  // CÁLCULOS FINANCIEROS Y GRÁFICOS (DÍA, SEMANA, MES, AÑO)
  // ==============================================================================
  const ahora = new Date();
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();

  const primerDiaSemana = new Date(ahora);
  primerDiaSemana.setDate(ahora.getDate() - ahora.getDay());
  primerDiaSemana.setHours(0, 0, 0, 0);

  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
  const inicioAnio = new Date(ahora.getFullYear(), 0, 1).getTime();

  const comandasEntregadas = comandas.filter(o => o.status === 'delivered');

  let gananciaDia = 0;
  let gananciaSemana = 0;
  let gananciaMes = 0;
  let gananciaAnio = 0;

  comandasEntregadas.forEach(o => {
    const tiempo = new Date(o.created_at).getTime();
    const monto = parseFloat(o.subtotal_food || o.total || 0);
    if (tiempo >= hoyInicio) gananciaDia += monto;
    if (tiempo >= primerDiaSemana.getTime()) gananciaSemana += monto;
    if (tiempo >= inicioMes) gananciaMes += monto;
    if (tiempo >= inicioAnio) gananciaAnio += monto;
  });

  // Renderizar o actualizar gráfico Chart.js
  useEffect(() => {
    if (tab !== 'ganancias' || !chartCanvasRef.current) return;

    let labels = [];
    let valores = [];

    if (chartPeriodo === 'dia') {
      labels = ['00-03h', '03-06h', '06-09h', '09-12h', '12-15h', '15-18h', '18-21h', '21-24h'];
      valores = new Array(8).fill(0);
      comandasEntregadas.forEach(o => {
        const d = new Date(o.created_at);
        if (d.getTime() >= hoyInicio) {
          const idx = Math.min(7, Math.floor(d.getHours() / 3));
          valores[idx] += parseFloat(o.subtotal_food || o.total || 0);
        }
      });
    } else if (chartPeriodo === 'semana') {
      const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      labels = [];
      valores = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(ahora.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const diaNombre = dias[d.getDay()];
        labels.push(`${diaNombre} ${d.getDate()}/${d.getMonth() + 1}`);

        const prox = new Date(d);
        prox.setDate(d.getDate() + 1);

        const suma = comandasEntregadas.reduce((acc, o) => {
          const t = new Date(o.created_at).getTime();
          return t >= d.getTime() && t < prox.getTime() ? acc + parseFloat(o.subtotal_food || o.total || 0) : acc;
        }, 0);
        valores.push(suma);
      }
    } else if (chartPeriodo === 'mes') {
      labels = ['Semana 1 (1-7)', 'Semana 2 (8-14)', 'Semana 3 (15-21)', 'Semana 4 (22+)'];
      valores = [0, 0, 0, 0];
      comandasEntregadas.forEach(o => {
        const d = new Date(o.created_at);
        if (d.getTime() >= inicioMes) {
          const dia = d.getDate();
          const idx = Math.min(3, Math.floor((dia - 1) / 7));
          valores[idx] += parseFloat(o.subtotal_food || o.total || 0);
        }
      });
    } else if (chartPeriodo === 'anio') {
      labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      valores = new Array(12).fill(0);
      const anioActual = ahora.getFullYear();
      comandasEntregadas.forEach(o => {
        const d = new Date(o.created_at);
        if (d.getFullYear() === anioActual) {
          valores[d.getMonth()] += parseFloat(o.subtotal_food || o.total || 0);
        }
      });
    }

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const ctx = chartCanvasRef.current.getContext('2d');
    chartInstanceRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ganancias Brutas (USD)',
            data: valores,
            backgroundColor: 'rgba(130, 19, 58, 0.85)', // Dark Amaranth oficial
            hoverBackgroundColor: 'rgba(239, 157, 36, 0.95)', // Golden Orange oficial
            borderRadius: 8,
            borderSkipped: false,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context => ` Venta: $${context.raw.toFixed(2)} USD`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: value => `$${value}`
            },
            grid: { color: '#f3f4f6' }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [tab, chartPeriodo, comandasEntregadas.length]);

  // Filtrado de lista de compras animada
  const insumosFiltrados = insumos.filter(i =>
    (i.name || '').toLowerCase().includes(busquedaInsumo.toLowerCase().trim())
  );

  const comandasEnCurso = comandas.filter(o => !['delivered', 'cancelled', 'rejected'].includes(o.status));

  // Platos afectados por el insumo a borrar
  const platosAfectados = itemToDelete
    ? productos.filter(p => recetas.some(r => r.product_id === p.id && r.inventory_item_id === itemToDelete.id))
    : [];

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
              KDS • Centro de Operaciones & Despensa
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

        {/* PESTAÑAS DE CONTROL DE COCINA */}
        <nav style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '16px', scrollbarWidth: 'none' }}>
          {[
            { id: 'comandas', label: `📋 Comandas (${comandasEnCurso.length})` },
            { id: 'inventario', label: `🛒 Lista de Compras (${insumos.length})` },
            { id: 'merma', label: `🗑️ Control de Merma` },
            { id: 'ganancias', label: `📈 Ganancias & Reportes` },
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
                transition: 'all 0.15s ease',
                boxShadow: tab === tabItem.id ? '0 4px 12px rgba(130, 19, 58, 0.25)' : 'none'
              }}
            >
              {tabItem.label}
            </button>
          ))}
        </nav>

        {/* ==============================================================================
            1. COMANDAS ACTIVAS
           ============================================================================== */}
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <strong style={{ fontSize: '1rem', color: 'var(--dark-amaranth)' }}>
                            #ORD-{(ord.id || '').slice(0, 8).toUpperCase()}
                          </strong>
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

                        <div style={{ fontSize: '0.9rem', borderBottom: '1px dashed #e5e7eb', paddingBottom: '10px', marginBottom: '10px' }}>
                          {itemsLista.map((it, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                              <strong>{it.quantity || 1}x {it.name}</strong>
                              <span style={{ color: '#6b7280' }}>{formatUsd(it.price || 0)}</span>
                            </div>
                          ))}
                        </div>

                        <div style={{ fontSize: '0.82rem', color: '#4b5563', lineHeight: 1.5 }}>
                          <div><strong>Cliente:</strong> {ord.customer_name || 'Cliente'}</div>
                          <div><strong>Teléfono:</strong> {ord.customer_phone || 'Sin número'}</div>
                          <div><strong>Pago:</strong> {(ord.payment_method || 'Digital').toUpperCase()} • <strong>Total:</strong> {formatUsd(ord.total || 0)}</div>
                          {ord.notes && (
                            <div style={{ marginTop: '6px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '6px 10px', borderRadius: '8px' }}>
                              <strong>Nota:</strong> {ord.notes}
                            </div>
                          )}
                        </div>
                      </div>

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

        {/* ==============================================================================
            2. LISTA DE COMPRAS / INVENTARIO ANIMADA
           ============================================================================== */}
        {tab === 'inventario' && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '20px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
            
            {/* BARRA SUPERIOR DE DESPENSA */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
                  🛒 Lista de Compras y Despensa
                </h3>
                <small style={{ color: '#6b7280' }}>
                  Toca el botón <strong>+</strong> para abrir el teclado numérico y reabastecer stock.
                </small>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="🔍 Buscar ingrediente..."
                  value={busquedaInsumo}
                  onChange={e => setBusquedaInsumo(e.target.value)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '999px',
                    border: '1px solid #d1d5db',
                    fontSize: '0.84rem',
                    outline: 'none',
                    minWidth: '180px'
                  }}
                />

                <button
                  type="button"
                  onClick={() => setMostrarFormInsumo(!mostrarFormInsumo)}
                  className="btn-primario"
                  style={{ fontSize: '0.82rem', padding: '8px 16px' }}
                >
                  {mostrarFormInsumo ? 'Cerrar' : '+ Nuevo Ingrediente'}
                </button>
              </div>
            </div>

            {/* FORMULARIO AGREGAR NUEVO INGREDIENTE */}
            {mostrarFormInsumo && (
              <form onSubmit={handleCrearInsumo} style={{ background: '#f8f9fb', padding: '16px', borderRadius: '16px', marginBottom: '20px', border: '1px solid #e5e7eb' }}>
                <h4 style={{ margin: '0 0 10px 0', color: 'var(--dark-amaranth)' }}>Registrar Nuevo Ingrediente</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700 }}>Nombre del Ingrediente:</label>
                    <input type="text" className="form-input-figma" value={nombreInsumo} onChange={e => setNombreInsumo(e.target.value)} required placeholder="Ej: Pan Brioche" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700 }}>Cantidad Inicial:</label>
                    <input type="number" step="any" className="form-input-figma" value={cantInsumo} onChange={e => setCantInsumo(e.target.value)} required placeholder="Ej: 50" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700 }}>Unidad de Medida:</label>
                    <input type="text" className="form-input-figma" value={unidadInsumo} onChange={e => setUnidadInsumo(e.target.value)} placeholder="unidades / g / ml / kg" />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700 }}>Mínimo Crítico:</label>
                    <input type="number" step="any" className="form-input-figma" value={minInsumo} onChange={e => setMinInsumo(e.target.value)} placeholder="Ej: 10" />
                  </div>
                </div>
                <button type="submit" className="btn-primario" style={{ marginTop: '4px' }}>Guardar en Lista de Compras</button>
              </form>
            )}

            {/* GRILLA DE ITEMS DE COMPRA / INGREDIENTES */}
            {insumosFiltrados.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                <p>No se encontraron ingredientes con el término "{busquedaInsumo}".</p>
              </div>
            ) : (
              <div className="shopping-list-grid">
                {insumosFiltrados.map((ins, index) => {
                  const cant = parseFloat(ins.quantity || 0);
                  const min = parseFloat(ins.min_threshold || 0);
                  const bajo = cant <= min;
                  const emoji = getIngredientEmoji(ins.name);

                  return (
                    <div
                      key={ins.id}
                      className="shopping-card-item"
                      style={{ animationDelay: `${index * 35}ms` }}
                    >
                      <div className="shopping-card-icon">
                        {emoji}
                      </div>

                      <div className="shopping-card-info">
                        <h4 className="shopping-card-name">{ins.name}</h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="shopping-card-qty">
                            {cant} {ins.unit}
                          </span>
                          <span style={{
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: bajo ? '#fef2f2' : '#ecfdf5',
                            color: bajo ? '#dc2626' : '#059669',
                            border: `1px solid ${bajo ? '#fca5a5' : '#a7f3d0'}`
                          }}>
                            {bajo ? '⚠️ Crítico' : '✓ Óptimo'}
                          </span>
                        </div>
                      </div>

                      <div className="shopping-card-actions">
                        {/* BOTÓN + (ABRE TECLADO NUMÉRICO TÁCTIL) */}
                        <button
                          type="button"
                          className="btn-add-stock"
                          onClick={() => abrirTecladoNumerico(ins)}
                          title={`Sumar stock a ${ins.name}`}
                          aria-label={`Agregar stock a ${ins.name}`}
                        >
                          +
                        </button>

                        {/* BOTÓN ELIMINAR (BORRA EN BASE DE DATOS Y EN CADA PLATO) */}
                        <button
                          type="button"
                          className="btn-delete-item"
                          onClick={() => setItemToDelete(ins)}
                          title={`Eliminar ${ins.name} de la base de datos y recetas`}
                          aria-label={`Eliminar ${ins.name}`}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ==============================================================================
            3. CONTROL DE MERMA (DESPERDICIO)
           ============================================================================== */}
        {tab === 'merma' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            
            {/* FORMULARIO DE REGISTRO DE MERMA */}
            <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '20px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>🗑️</span>
                <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
                  Registrar Merma / Pérdida
                </h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 16px 0' }}>
                Selecciona el ingrediente y anota cuánto material se perdió para descontarlo del inventario real.
              </p>

              <form onSubmit={handleRegistrarMerma}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>Ingrediente afectado:</label>
                <select
                  value={mermaItemId}
                  onChange={e => setMermaItemId(e.target.value)}
                  className="form-input-figma"
                  required
                >
                  {insumos.map(ins => (
                    <option key={ins.id} value={ins.id}>
                      {ins.name} (Stock: {ins.quantity} {ins.unit})
                    </option>
                  ))}
                </select>

                <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                  Cantidad perdida por merma ({insumos.find(i => i.id === mermaItemId)?.unit || 'unidad'}):
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  className="form-input-figma"
                  placeholder="Ej: 250 o 2"
                  value={mermaCantidad}
                  onChange={e => setMermaCantidad(e.target.value)}
                  required
                />

                <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>Motivo de la merma:</label>
                <select
                  value={mermaMotivo}
                  onChange={e => setMermaMotivo(e.target.value)}
                  className="form-input-figma"
                  required
                >
                  <option value="Vencimiento / Caducidad">Vencimiento / Caducidad de fecha</option>
                  <option value="Quemado / Error de cocina">Quemado / Error en cocción</option>
                  <option value="Caído al piso / Contaminado">Caído al piso / Contaminado</option>
                  <option value="Mala refrigeración / Daño térmico">Mala refrigeración / Daño térmico</option>
                  <option value="Empaque roto o derrame">Empaque roto o derrame</option>
                  <option value="Otro motivo">Otro motivo operativo</option>
                </select>

                <label style={{ fontSize: '0.82rem', fontWeight: 700 }}>Detalles adicionales (Opcional):</label>
                <input
                  type="text"
                  className="form-input-figma"
                  placeholder="Ej: Se dañó por corte eléctrico en nevera 2"
                  value={mermaNotas}
                  onChange={e => setMermaNotas(e.target.value)}
                />

                <button
                  type="submit"
                  disabled={registrandoMerma}
                  style={{
                    width: '100%',
                    background: '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 20px',
                    borderRadius: '999px',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    marginTop: '8px'
                  }}
                >
                  {registrandoMerma ? 'Asentando merma...' : 'Descontar y Asentar Merma'}
                </button>
              </form>
            </div>

            {/* HISTORIAL RECIENTE DE MERMAS ASENTADAS */}
            <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '20px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
              <h3 style={{ margin: '0 0 12px 0', color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
                📋 Historial de Mermas Registradas
              </h3>

              {mermas.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: '0.88rem' }}>No hay mermas registradas recientemente en tu local.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto' }}>
                  {mermas.map(m => (
                    <div
                      key={m.id}
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '12px',
                        padding: '10px 14px',
                        fontSize: '0.84rem'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#991b1b' }}>
                        <span>{m.item_name}</span>
                        <span>-{m.quantity}</span>
                      </div>
                      <div style={{ color: '#7f1d1d', fontSize: '0.78rem', marginTop: '2px' }}>
                        {m.notes || 'Merma reportada'} • {new Date(m.created_at).toLocaleDateString('es-VE')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ==============================================================================
            4. GRÁFICOS DE GANANCIAS (DÍA, SEMANA, MES Y AÑO)
           ============================================================================== */}
        {tab === 'ganancias' && (
          <div>
            
            {/* TARJETAS KPI DE GANANCIAS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Ganancias Hoy</div>
                <div className="kpi-stat-value">{formatUsd(gananciaDia)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (90%): {formatUsd(gananciaDia * 0.9)}</small>
              </div>

              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Esta Semana</div>
                <div className="kpi-stat-value">{formatUsd(gananciaSemana)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (90%): {formatUsd(gananciaSemana * 0.9)}</small>
              </div>

              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Este Mes</div>
                <div className="kpi-stat-value">{formatUsd(gananciaMes)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (90%): {formatUsd(gananciaMes * 0.9)}</small>
              </div>

              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Este Año</div>
                <div className="kpi-stat-value">{formatUsd(gananciaAnio)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (90%): {formatUsd(gananciaAnio * 0.9)}</small>
              </div>
            </div>

            {/* SELECCIÓN DE PERIODO Y CANVAS DEL GRÁFICO */}
            <div className="chart-box-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
                    📊 Rendimiento de Ventas
                  </h3>
                  <small style={{ color: '#6b7280' }}>
                    Visualiza la curva de ingresos brutos por comensales y pedidos despachados.
                  </small>
                </div>

                {/* BOTONES SELECTORES DE PERIODO (DÍA / SEMANA / MES / AÑO) */}
                <div style={{ display: 'flex', gap: '6px', background: '#f3f4f6', padding: '4px', borderRadius: '999px' }}>
                  {[
                    { id: 'dia', label: 'Día' },
                    { id: 'semana', label: 'Semana' },
                    { id: 'mes', label: 'Mes' },
                    { id: 'anio', label: 'Año' }
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setChartPeriodo(p.id)}
                      style={{
                        background: chartPeriodo === p.id ? 'var(--dark-amaranth)' : 'transparent',
                        color: chartPeriodo === p.id ? '#ffffff' : '#4b5563',
                        border: 'none',
                        padding: '6px 14px',
                        borderRadius: '999px',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* CONTENEDOR CANVAS CON CHART.JS */}
              <div style={{ position: 'relative', height: '320px', width: '100%' }}>
                <canvas ref={chartCanvasRef} />
              </div>

              {/* BOTÓN DE SOLICITUD DE LIQUIDACIÓN / CORTE */}
              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '16px', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <span style={{ fontSize: '0.85rem', color: '#4b5563' }}>
                  ¿Deseas cerrar caja y transferir tus ingresos disponibles?
                </span>
                <button
                  type="button"
                  onClick={solicitarCorteCaja}
                  className="btn-primario"
                  style={{ fontSize: '0.85rem', padding: '10px 18px' }}
                >
                  💰 Solicitar Liquidación Bancaria
                </button>
              </div>

            </div>

          </div>
        )}

        {/* ==============================================================================
            5. MENÚ DE PLATOS (LIBRO DE CARTA & ALTA DE PLATOS)
           ============================================================================== */}
        {tab === 'menu' && (
          <div className="menu-book-container">
            {/* Espina central del libro abierto */}
            <div className="menu-book-spine" />

            {/* PÁGINA IZQUIERDA: CARTA DEL RESTAURANTE */}
            <div className="menu-book-page page-left">
              <div className="menu-book-header">
                <h3 className="menu-book-title">📖 Nuestra Carta</h3>
                <div className="menu-book-subtitle">Tropicalia CRB • Menú Principal</div>
              </div>

              {/* Buscador de platos */}
              <div style={{ marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="🔍 Buscar plato en la carta..."
                  value={busquedaMenu}
                  onChange={e => setBusquedaMenu(e.target.value)}
                  className="form-input-figma"
                  style={{ margin: 0, padding: '8px 12px', fontSize: '0.85rem' }}
                />
                <span style={{ fontSize: '0.78rem', color: '#78716c', whiteSpace: 'nowrap', fontWeight: 700 }}>
                  {productos.filter(p => p.name.toLowerCase().includes(busquedaMenu.toLowerCase())).length} platos
                </span>
              </div>

              {/* Lista compacta con scroll interior para no alargar la página */}
              <div className="menu-dishes-scroll">
                {productos.filter(p => p.name.toLowerCase().includes(busquedaMenu.toLowerCase())).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '36px 14px', color: '#a8a29e' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🍽️</div>
                    <p style={{ margin: 0, fontSize: '0.9rem' }}>No hay platos que coincidan con la búsqueda.</p>
                  </div>
                ) : (
                  productos
                    .filter(p => p.name.toLowerCase().includes(busquedaMenu.toLowerCase()))
                    .map(p => {
                      const recsDelPlato = recetas.filter(r => r.product_id === p.id);
                      const ingredientesTexto = recsDelPlato.map(r => {
                        const ins = insumos.find(i => i.id === r.inventory_item_id);
                        return ins ? `${ins.name} (${r.quantity_required} ${ins.unit})` : null;
                      }).filter(Boolean).join(' • ');

                      return (
                        <div key={p.id} className="menu-dish-item">
                          {/* Miniatura / Foto */}
                          <div className="menu-dish-thumb">
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt={p.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                            ) : (
                              getIngredientEmoji(p.name)
                            )}
                          </div>

                          {/* Detalles del Plato */}
                          <div className="menu-dish-details">
                            <div className="menu-dish-heading">
                              <span className="menu-dish-name">{p.name}</span>
                              <span className="menu-dish-leader" />
                              <span className="menu-dish-price">{formatUsd(p.price)}</span>
                            </div>

                            {/* Ingredientes de la receta */}
                            <div className="menu-dish-recipe">
                              {ingredientesTexto ? (
                                <span>📋 <em>{ingredientesTexto}</em></span>
                              ) : (
                                <span style={{ color: '#a8a29e', fontStyle: 'italic' }}>Sin receta de insumos asociada</span>
                              )}
                            </div>

                            {/* Acciones */}
                            <div className="menu-dish-actions">
                              <button
                                type="button"
                                onClick={() => handleTogglePlato(p)}
                                style={{
                                  background: p.is_available ? '#ecfdf5' : '#fef2f2',
                                  color: p.is_available ? '#065f46' : '#b91c1c',
                                  border: `1px solid ${p.is_available ? '#a7f3d0' : '#fca5a5'}`,
                                  padding: '3px 10px',
                                  borderRadius: '999px',
                                  fontWeight: 700,
                                  fontSize: '0.74rem',
                                  cursor: 'pointer'
                                }}
                              >
                                {p.is_available ? '🟢 Disponible' : '🔴 Pausado'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleEliminarPlato(p)}
                                style={{
                                  background: '#fee2e2',
                                  color: '#dc2626',
                                  border: '1px solid #fca5a5',
                                  padding: '3px 8px',
                                  borderRadius: '999px',
                                  fontWeight: 700,
                                  fontSize: '0.74rem',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Eliminar plato de la carta"
                              >
                                🗑️ Eliminar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* PÁGINA DERECHA: PANEL PARA AGREGAR NUEVOS PLATOS */}
            <div className="menu-book-page page-right">
              <div className="menu-book-header">
                <h3 className="menu-book-title" style={{ color: 'var(--golden-orange)' }}>✨ Nuevo Plato</h3>
                <div className="menu-book-subtitle">Panel de Creación & Receta de Insumos</div>
              </div>

              <form onSubmit={handleCrearPlatoConReceta} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* 1. Nombre y Precio */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '3px' }}>
                      Nombre del Plato *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Hamburguesa Tropical Suprema"
                      value={nuevoPlatoNombre}
                      onChange={e => setNuevoPlatoNombre(e.target.value)}
                      className="form-input-figma"
                      style={{ margin: 0, padding: '8px 10px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '3px' }}>
                      Precio ($ USD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="8.50"
                      value={nuevoPlatoPrecio}
                      onChange={e => setNuevoPlatoPrecio(e.target.value)}
                      className="form-input-figma"
                      style={{ margin: 0, padding: '8px 10px', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>

                {/* 2. Foto del Plato (URL con presets rápidos) */}
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '3px' }}>
                    Foto del Plato (URL)
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="url"
                      placeholder="https://images.unsplash.com/... o pega enlace"
                      value={nuevoPlatoFoto}
                      onChange={e => setNuevoPlatoFoto(e.target.value)}
                      className="form-input-figma"
                      style={{ margin: 0, padding: '8px 10px', fontSize: '0.85rem', flex: 1 }}
                    />
                    {nuevoPlatoFoto && (
                      <div style={{ width: '38px', height: '38px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb', flexShrink: 0 }}>
                        <img src={nuevoPlatoFoto} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} />
                      </div>
                    )}
                  </div>
                  {/* Píldoras de presets rápidos */}
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {[
                      { label: '🍔 Burger', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&auto=format&fit=crop&q=80' },
                      { label: '🍕 Pizza', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&auto=format&fit=crop&q=80' },
                      { label: '🥗 Ensalada', url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&auto=format&fit=crop&q=80' },
                      { label: '🍟 Papas', url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=500&auto=format&fit=crop&q=80' },
                      { label: '🥤 Bebida', url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&auto=format&fit=crop&q=80' },
                      { label: '🍰 Postre', url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&auto=format&fit=crop&q=80' }
                    ].map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setNuevoPlatoFoto(p.url)}
                        style={{
                          background: '#f3f4f6',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          padding: '2px 8px',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          color: '#374151'
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Ingredientes y Cantidades (Receta) */}
                <div style={{ background: '#fdfbf7', border: '1px dashed #d6cbbe', borderRadius: '12px', padding: '12px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--dark-amaranth)', display: 'block', marginBottom: '2px' }}>
                    📦 Ingredientes de la Receta
                  </label>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.72rem', color: '#78716c' }}>
                    Selecciona los ingredientes registrados y anota cuánto consume 1 plato:
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '6px', alignItems: 'center' }}>
                    <select
                      value={selectedIngredienteId || (insumos[0]?.id ?? '')}
                      onChange={e => setSelectedIngredienteId(e.target.value)}
                      className="form-input-figma"
                      style={{ margin: 0, padding: '7px 8px', fontSize: '0.82rem' }}
                    >
                      {insumos.length === 0 ? (
                        <option value="">No hay insumos registrados</option>
                      ) : (
                        insumos.map(i => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.unit})
                          </option>
                        ))
                      )}
                    </select>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Cant."
                        value={selectedIngredienteCant}
                        onChange={e => setSelectedIngredienteCant(e.target.value)}
                        className="form-input-figma"
                        style={{ margin: 0, padding: '7px 8px', fontSize: '0.82rem', width: '100%' }}
                      />
                      <span style={{ fontSize: '0.74rem', color: '#78716c', fontWeight: 700, minWidth: '22px' }}>
                        {insumos.find(i => i.id === (selectedIngredienteId || (insumos[0]?.id ?? '')))?.unit || ''}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleAgregarIngredienteAReceta}
                      className="btn-primario"
                      style={{ padding: '7px 12px', fontSize: '0.8rem', background: '#10b981', color: '#fff', borderRadius: '8px' }}
                    >
                      + Añadir
                    </button>
                  </div>

                  {/* Chips de ingredientes agregados */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                    {nuevoPlatoIngredientes.length === 0 ? (
                      <span style={{ fontSize: '0.74rem', color: '#a8a29e', fontStyle: 'italic' }}>
                        Aún no has añadido ingredientes a la receta.
                      </span>
                    ) : (
                      nuevoPlatoIngredientes.map((ing) => (
                        <span key={ing.ingredientId} className="recipe-chip-tag">
                          {ing.ingredientName}: {ing.quantity} {ing.unit}
                          <button
                            type="button"
                            onClick={() => handleQuitarIngredienteDeReceta(ing.ingredientId)}
                            className="recipe-chip-remove"
                            title="Quitar de la receta"
                          >
                            ✕
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* 4. Botón Guardar Plato */}
                <button
                  type="submit"
                  disabled={guardandoPlato}
                  className="btn-primario"
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    borderRadius: '10px',
                    marginTop: '4px',
                    boxShadow: '0 4px 14px rgba(239, 157, 36, 0.3)'
                  }}
                >
                  {guardandoPlato ? 'Guardando en Carta...' : '📖 Guardar Plato en la Carta'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ==============================================================================
            6. VENTA EN SALÓN / MOSTRADOR
           ============================================================================== */}
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

      {/* ==============================================================================
          MODAL TECLADO NUMÉRICO TÁCTIL (SUMAR STOCK CON UN TOQUE)
         ============================================================================== */}
      {keypadItem && (
        <div className="modal-figma-overlay" onClick={cerrarTecladoNumerico}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', margin: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 700 }}>
                  Reabastecer Despensa
                </span>
                <h3 style={{ margin: '2px 0 0 0', color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
                  {keypadItem.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={cerrarTecladoNumerico}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', fontSize: '1rem' }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#4b5563' }}>
              Stock actual: <strong>{keypadItem.quantity} {keypadItem.unit}</strong>
            </p>

            {/* PANTALLA DE ENTRADA NUMÉRICA */}
            <div style={{
              background: '#f8f9fb',
              border: '2px solid var(--dark-amaranth)',
              borderRadius: '16px',
              padding: '14px 18px',
              textAlign: 'center',
              marginBottom: '12px'
            }}>
              <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 700, display: 'block' }}>
                CANTIDAD A SUMAR:
              </span>
              <div style={{
                fontSize: '2.2rem',
                fontWeight: 900,
                color: 'var(--dark-amaranth)',
                fontFamily: 'var(--font-display)',
                margin: '2px 0'
              }}>
                +{keypadValue || '0'} <span style={{ fontSize: '1rem', color: '#6b7280', fontWeight: 600 }}>{keypadItem.unit}</span>
              </div>
            </div>

            {/* PRESETS RÁPIDOS (+5, +10, +50, +100) */}
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              {[1, 5, 10, 50, 100].map(val => (
                <button
                  key={val}
                  type="button"
                  className="preset-pill-btn"
                  onClick={() => handleAddPreset(val)}
                >
                  +{val}
                </button>
              ))}
              <button
                type="button"
                className="preset-pill-btn"
                style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#dc2626' }}
                onClick={() => setKeypadValue('')}
              >
                Limpiar
              </button>
            </div>

            {/* TECLADO NUMÉRICO TÁCTIL 3x4 */}
            <div className="keypad-grid">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'DEL'].map(btn => (
                <button
                  key={btn}
                  type="button"
                  className={`keypad-btn ${btn === 'DEL' ? 'action-btn' : ''}`}
                  onClick={() => handleKeypadPress(btn)}
                >
                  {btn === 'DEL' ? '⌫' : btn}
                </button>
              ))}
            </div>

            {/* BOTÓN CONFIRMAR */}
            <button
              type="button"
              onClick={handleConfirmarSumaStock}
              className="btn-primario"
              style={{ width: '100%', padding: '14px', fontSize: '1rem', marginTop: '16px' }}
            >
              ✓ Confirmar y Sumar al Stock
            </button>

          </div>
        </div>
      )}

      {/* ==============================================================================
          MODAL CONFIRMAR ELIMINACIÓN DE INGREDIENTE (EN BASE DE DATOS Y RECETAS)
         ============================================================================== */}
      {itemToDelete && (
        <div className="modal-figma-overlay" onClick={() => setItemToDelete(null)}>
          <div className="modal-figma-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', margin: 'auto' }}>
            
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '2.5rem' }}>🗑️</span>
              <h3 style={{ margin: '8px 0 4px 0', color: '#b91c1c', fontSize: '1.3rem' }}>
                ¿Eliminar {itemToDelete.name}?
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#4b5563' }}>
                Esta acción eliminará el ingrediente del inventario de Supabase y <strong>lo removerá de todas las recetas de platos asociadas</strong>.
              </p>
            </div>

            {platosAfectados.length > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '12px', marginBottom: '16px' }}>
                <strong style={{ color: '#991b1b', fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>
                  ⚠️ Se removerá de las recetas de los siguientes {platosAfectados.length} platos:
                </strong>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: '#7f1d1d' }}>
                  {platosAfectados.map(p => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="btn-secundario"
                style={{ flex: 1 }}
                disabled={deletingItem}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEliminarIngrediente}
                style={{
                  flex: 1,
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '999px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: 'pointer'
                }}
                disabled={deletingItem}
              >
                {deletingItem ? 'Eliminando...' : 'Sí, Eliminar de Todo'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
