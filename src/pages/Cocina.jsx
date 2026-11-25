import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatUsd } from '../services/bcvService';
import { descontarStockDeOrden, cancelarOrdenConReversion } from '../services/inventoryService';
import { abrirNotificacionWhatsApp, abrirNotificacionWhatsAppSiCorresponde } from '../services/whatsappService';
import { procesarBalanceCompletado, COMISION_COCINA_PCT } from '../services/paymentService';
import {
  calcularCostoYMargenPlato,
  procesarImagenFacturaOCR,
  aplicarActualizacionCostosInventario,
  calcularAnaliticaPlatos,
  calcularTicketPromedioYCrossSelling,
  registrarLoteStock,
  actualizarPlatoConBOM
} from '../services/kitchenAnalyticsService';
import { uploadDishPhoto, getProductImageUrl } from '../services/imageService';
import {
  Camera,
  FileSpreadsheet,
  Layers,
  Award,
  ArrowDownRight,
  Scale,
  Plus,
  Pencil,
  Upload
} from 'lucide-react';
import {
  ChefHat,
  ShoppingBag,
  Bike,
  KeyRound,
  WhatsAppIcon,
  TrashVinoIcon,
  X,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  ClipboardList,
  Store,
  Clock,
  Lock,
  Package,
  Sparkles,
  DollarSign
} from '../components/common/Icons';

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

function getIngredientEmoji() {
  return null;
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
  const [cierrePendiente, setCierrePendiente] = useState(null);
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

  // Gráficos de ganancias & subpestañas analíticas
  const [chartPeriodo, setChartPeriodo] = useState('semana'); // 'dia', 'semana', 'mes', 'anio'
  const [gananciasSubTab, setGananciasSubTab] = useState('resumen'); // 'resumen' | 'platos' | 'ticket'
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
  const [todosLosLocales, setTodosLosLocales] = useState([]);

  // Actualización Inteligente de Costos (OCR / Manual)
  const [mostrarActualizadorCostos, setMostrarActualizadorCostos] = useState(false);
  const [modoCostos, setModoCostos] = useState('ocr'); // 'ocr' | 'manual'
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrTextoRespaldo, setOcrTextoRespaldo] = useState('');
  const [ocrPreview, setOcrPreview] = useState(null); // { actualizables, ignorados, origen }
  const [manualCostEdits, setManualCostEdits] = useState({});
  const [guardandoCostos, setGuardandoCostos] = useState(false);

  // Trazabilidad BOM independiente
  const [bomSelectedProductId, setBomSelectedProductId] = useState('');
  const [bomAddIngId, setBomAddIngId] = useState('');
  const [bomAddQty, setBomAddQty] = useState('');

  // Dualidad de Producción (Stock vs Por Encargo)
  const [loteCantidades, setLoteCantidades] = useState({});
  const [produciendoLoteId, setProduciendoLoteId] = useState(null);

  // Modal de Edición Completa de Plato y BOM
  const [editingDish, setEditingDish] = useState(null);
  const [editDishForm, setEditDishForm] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
    image_url: '',
    is_available: true,
    production_mode: 'on_demand',
    ready_stock: 0,
    stock: 50
  });
  const [editDishBom, setEditDishBom] = useState([]);
  const [editBomIngId, setEditBomIngId] = useState('');
  const [editBomQty, setEditBomQty] = useState('');
  const [uploadingDishPhoto, setUploadingDishPhoto] = useState(false);
  const [savingDishEdit, setSavingDishEdit] = useState(false);
  const localRef = useRef(local);

  useEffect(() => {
    localRef.current = local;
  }, [local]);

  useEffect(() => {
    if (!user) return;
    initCocina();

    // Suscripción Realtime blindada por negocio (evita alertas cruzadas de otras cocinas)
    const channel = supabase.channel('cocina-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const curId = localRef.current?.id || local?.id;
        if (curId && (!payload?.new?.business_id || payload.new.business_id === curId)) {
          playBeepSound();
          cargarComandas(curId);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const curId = localRef.current?.id || local?.id;
        const bizId = payload?.new?.business_id || payload?.old?.business_id;
        if (curId && (!bizId || bizId === curId)) {
          cargarComandas(curId);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, (payload) => {
        const curId = localRef.current?.id || local?.id;
        const bizId = payload?.new?.business_id || payload?.old?.business_id;
        if (curId && (!bizId || bizId === curId)) {
          cargarInventario(curId);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  async function cambiarLocal(nuevoLocal) {
    if (!nuevoLocal) return;
    setLoading(true);
    setLocal(nuevoLocal);
    localRef.current = nuevoLocal;
    await Promise.all([
      cargarComandas(nuevoLocal.id),
      cargarInventario(nuevoLocal.id),
      cargarProductosYRecetas(nuevoLocal.id),
      cargarMermas(nuevoLocal.id)
    ]);
    setLoading(false);
  }

  async function cargarEstadoCierre(businessId) {
    if (!businessId) return;
    try {
      const { data } = await supabase
        .from('cash_closures')
        .select('*')
        .eq('business_id', businessId)
        .in('status', ['pending', 'pending_settlement'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setCierrePendiente(data[0]);
      } else {
        setCierrePendiente(null);
      }
    } catch (e) {
      console.warn('Verificando estado de cierre:', e);
    }
  }

  async function initCocina() {
    setLoading(true);

    let neg = null;
    if (user) {
      // 1. Aislamiento Estricto: Buscar exclusivamente el restaurante donde el usuario sea owner_id
      const { data: userNeg } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)
        .maybeSingle();
      neg = userNeg;

      // 2. Si no es owner directo, verificar vinculación en kitchen_profiles
      if (!neg) {
        const { data: kp } = await supabase
          .from('kitchen_profiles')
          .select('business_id, businesses(*)')
          .eq('id', user.id)
          .maybeSingle();

        if (kp?.businesses) {
          neg = kp.businesses;
        }
      }
    }

    // 3. Fallback administrativo: Exclusivo para administradores corporativos (@tropicalia.lat)
    if (!neg && user?.email?.toLowerCase().endsWith('@tropicalia.lat')) {
      const { data: primerNeg } = await supabase
        .from('businesses')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      neg = primerNeg;
    }

    if (!neg) {
      setLocal(null);
      localRef.current = null;
      setTodosLosLocales([]);
      setLoading(false);
      return;
    }

    // Aislamiento completo: Solo se mantiene en memoria el local asignado
    setLocal(neg);
    localRef.current = neg;
    setTodosLosLocales([neg]);

    await Promise.all([
      cargarComandas(neg.id),
      cargarInventario(neg.id),
      cargarProductosYRecetas(neg.id),
      cargarMermas(neg.id),
      cargarEstadoCierre(neg.id)
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
      showNotification(`Se sumaron +${delta} ${keypadItem.unit} a ${keypadItem.name}`);
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

      showNotification(`Ingrediente "${itemToDelete.name}" eliminado del inventario y de sus platos asociados.`);
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

      showNotification(`Merma asentada: -${cantidadPerdida} ${ins.unit} de ${ins.name}`);
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

    if (orden.status === 'pending_payment_verification' && ['cooking', 'ready', 'delivered'].includes(nuevoEstado)) {
      alert('Este pedido digital aún requiere validación del comprobante por Administración antes de iniciar preparación.');
      return;
    }

    const payload = { status: nuevoEstado };
    if (nuevoEstado === 'on_the_way') {
      payload.delivery_status = 'on_the_way';
    }
    if (nuevoEstado === 'delivered') {
      payload.delivered_at = orden.delivered_at || new Date().toISOString();
    }

    if (nuevoEstado === 'cooking') {
      await descontarStockDeOrden(orden);
      await cargarInventario(local.id);
      await cargarProductosYRecetas(local.id);
      showNotification('Comanda en preparación. El cliente sigue el avance en vivo.');
    }

    if (nuevoEstado === 'ready') {
      const resWa = abrirNotificacionWhatsAppSiCorresponde(orden, 'ready', local);
      showNotification(orden.delivery_type === 'pickup' && !resWa?.skipped
        ? 'Pedido listo en barra. Aviso único enviado por WhatsApp.'
        : 'Pedido empacado. Repartidores notificados en vivo.'
      );
    }

    if (nuevoEstado === 'delivered') {
      try {
        await procesarBalanceCompletado({ orden, driverId: orden.driver_id || null });
      } catch (e) {
        console.warn('Balance en cocina:', e);
      }
      showNotification('Pedido completado y entregado.');
    }

    await supabase.from('orders').update(payload).eq('id', ordenId);
    await cargarComandas(local.id);
  }

  async function handleConfirmarEntregaPickup(orden) {
    if (!orden) return;
    const codigoEsperado = (orden.delivery_code || (orden.id || '').slice(0, 4)).toUpperCase();
    const codigoIngresado = prompt(`ENTREGA SEGURA EN MOSTRADOR (PICK UP)\nPor favor, verifica el código de retiro presentado por el cliente:\n(Código del sistema: ${codigoEsperado})`, codigoEsperado);
    if (!codigoIngresado) return;

    if (codigoIngresado.trim().toUpperCase() !== codigoEsperado) {
      alert(`Código incorrecto. El cliente debe mostrarte el código de retiro: ${codigoEsperado}`);
      return;
    }

    await cambiarEstadoComanda(orden.id, 'delivered');
  }

  async function handleCancelarComanda(orden) {
    const motivo = window.prompt(
      `¿Seguro que deseas cancelar la comanda #${orden.id.slice(0, 8)}?\nLos insumos serán devueltos automáticamente al inventario.\n\nIngresa el motivo:`,
      'Agotamiento imprevisto de insumos / Cancelado por cocina'
    );

    if (!motivo) return;

    try {
      const res = await cancelarOrdenConReversion(orden.id, motivo, 'cocina');
      showNotification(`Comanda cancelada. Se reintegraron ${res.reversionCount || 0} artículos al stock.`);
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

      showNotification(`Plato "${nuevoPlatoNombre}" agregado exitosamente a la carta.`);
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

      showNotification(`Plato "${plato.name}" eliminado de la carta.`);
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

    showNotification(`Venta registrada: ${cant}x ${prod.name}`);
    await cargarInventario(local.id);
  }

  async function solicitarCorteCaja() {
    if (cierrePendiente) {
      alert(`Ya existe una solicitud de cierre pendiente de aprobación por ${formatUsd(cierrePendiente.net_amount)}. Por control contable, no puedes solicitar un nuevo corte hasta que la administración confirme la transferencia previa.`);
      return;
    }

    // Doble validación en tiempo real contra Supabase para evitar cierres duplicados
    const { data: existePendiente } = await supabase
      .from('cash_closures')
      .select('id, net_amount, status')
      .eq('business_id', local.id)
      .in('status', ['pending', 'pending_settlement'])
      .maybeSingle();

    if (existePendiente) {
      setCierrePendiente(existePendiente);
      alert(`Ya existe una liquidación pendiente por ${formatUsd(existePendiente.net_amount)}. La administración debe marcarla como completada antes de generar un nuevo corte.`);
      return;
    }

    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);

    // Prevenir doble conteo si ya existió otro cierre liquidado en el mismo día
    const { data: ultimoLiquidado } = await supabase
      .from('cash_closures')
      .select('id, created_at, settled_at')
      .eq('business_id', local.id)
      .eq('status', 'settled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const fechaCortePrevio = ultimoLiquidado?.created_at ? new Date(ultimoLiquidado.created_at) : null;
    const tieneCorteHoy = Boolean(fechaCortePrevio && fechaCortePrevio > hoyInicio);

    const entregadasHoy = comandas.filter(o => {
      if (o.status !== 'delivered') return false;
      const fechaOrden = new Date(o.delivered_at || o.created_at);
      return tieneCorteHoy ? fechaOrden > fechaCortePrevio : fechaOrden >= hoyInicio;
    });

    const bruto = parseFloat(entregadasHoy.reduce((acc, o) => {
      if (o.subtotal_food !== null && o.subtotal_food !== undefined) {
        return acc + parseFloat(o.subtotal_food);
      }
      const total = parseFloat(o.total || 0);
      const fee = o.delivery_type === 'delivery' ? parseFloat(o.delivery_fee || 0) : 0;
      const tip = parseFloat(o.driver_tip || 0);
      return acc + Math.max(0, total - fee - tip);
    }, 0).toFixed(2));

    if (bruto <= 0) {
      alert('No tienes órdenes entregadas pendientes por liquidar en este turno.');
      return;
    }

    const comision = parseFloat((bruto * COMISION_COCINA_PCT).toFixed(2));
    const neto = parseFloat((bruto - comision).toFixed(2));

    const { data: nuevoCorte, error } = await supabase.from('cash_closures').insert([{
      business_id: local.id,
      gross_amount: bruto,
      commission_amount: comision,
      net_amount: neto,
      status: 'pending_settlement'
    }]).select().single();

    if (!error && nuevoCorte) {
      setCierrePendiente(nuevoCorte);
      alert(`Solicitud de liquidación enviada por ${formatUsd(neto)}. Administración procesará tu transferencia.`);
    } else {
      alert('Error al enviar corte: ' + (error?.message || 'Intente de nuevo.'));
    }
  }

  // ==============================================================================
  // ACTUALIZACIÓN INTELIGENTE DE COSTOS (OCR FACTURA / MANUAL)
  // ==============================================================================
  function abrirActualizadorCostos(modo = 'ocr') {
    setModoCostos(modo);
    const mapa = {};
    insumos.forEach(i => {
      mapa[i.id] = {
        unitCost: parseFloat(i.unit_cost || 0).toString(),
        addQty: ''
      };
    });
    setManualCostEdits(mapa);
    setMostrarActualizadorCostos(prev => !prev);
  }

  async function handleProcesarFotoFactura(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    try {
      const res = await procesarImagenFacturaOCR(file, insumos, '');
      setOcrPreview(res);
      showNotification(`Factura analizada: ${res.actualizables.length} insumos mapeados, ${res.ignorados.length} ajenos ignorados.`);
    } catch (err) {
      alert('Error analizando la factura: ' + err.message);
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleProcesarTextoFactura() {
    if (!ocrTextoRespaldo.trim()) return;
    setOcrLoading(true);
    try {
      const res = await procesarImagenFacturaOCR(null, insumos, ocrTextoRespaldo);
      setOcrPreview(res);
      showNotification(`Texto procesado: ${res.actualizables.length} insumos válidos, ${res.ignorados.length} ignorados.`);
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleAplicarCostosOCR(sumarStock = true) {
    if (!ocrPreview || ocrPreview.actualizables.length === 0) return;
    setGuardandoCostos(true);
    try {
      const payload = ocrPreview.actualizables.map(it => ({
        ...it,
        sumarCantidad: sumarStock
      }));
      const res = await aplicarActualizacionCostosInventario(payload);
      await cargarInventario(local.id);
      setOcrPreview(null);
      setOcrTextoRespaldo('');
      setMostrarActualizadorCostos(false);
      showNotification(`${res.actualizados} costos actualizados. Márgenes BOM recalculados automáticamente.`);
    } catch (err) {
      alert('Error aplicando costos: ' + err.message);
    } finally {
      setGuardandoCostos(false);
    }
  }

  async function handleGuardarCostosManuales(e) {
    e.preventDefault();
    setGuardandoCostos(true);
    try {
      const lista = insumos.map(ins => {
        const ed = manualCostEdits[ins.id] || {};
        const nuevoCosto = parseFloat(ed.unitCost);
        const cantSumar = parseFloat(ed.addQty || 0);
        return {
          insumoId: ins.id,
          nuevoCostoUnitario: isNaN(nuevoCosto) ? 0 : nuevoCosto,
          cantidadComprada: isNaN(cantSumar) ? 0 : cantSumar,
          sumarCantidad: cantSumar > 0
        };
      }).filter(x => x.nuevoCostoUnitario > 0);

      const res = await aplicarActualizacionCostosInventario(lista);
      await cargarInventario(local.id);
      setMostrarActualizadorCostos(false);
      showNotification(`${res.actualizados} costos unitarios guardados. Módulo BOM actualizado.`);
    } catch (err) {
      alert('Error guardando costos manuales: ' + err.message);
    } finally {
      setGuardandoCostos(false);
    }
  }

  // ==============================================================================
  // TRAZABILIDAD DE RECETAS (BOM) INDEPENDIENTE
  // ==============================================================================
  async function handleBomAgregarIngrediente(e) {
    e.preventDefault();
    const prodId = bomSelectedProductId || (productos[0]?.id ?? '');
    const ingId = bomAddIngId || (insumos[0]?.id ?? '');
    const qty = parseFloat(bomAddQty);

    if (!prodId || !ingId || isNaN(qty) || qty <= 0) {
      alert('Selecciona un plato, un ingrediente y una cantidad mayor a 0.');
      return;
    }

    const existente = recetas.find(r => r.product_id === prodId && r.inventory_item_id === ingId);
    if (existente) {
      await supabase
        .from('product_recipes')
        .update({ quantity_required: qty })
        .eq('id', existente.id);
    } else {
      await supabase
        .from('product_recipes')
        .insert([{ product_id: prodId, inventory_item_id: ingId, quantity_required: qty }]);
    }

    setBomAddQty('');
    await cargarProductosYRecetas(local.id);
    showNotification('Ingrediente asociado a la receta BOM. Costo recalculado.');
  }

  async function handleBomEliminarIngrediente(recipeId) {
    await supabase.from('product_recipes').delete().eq('id', recipeId);
    await cargarProductosYRecetas(local.id);
    showNotification('Ingrediente removido de la receta BOM.');
  }

  async function handleBomActualizarCantidadInline(recipeId, nuevaCantidad) {
    const qty = parseFloat(nuevaCantidad);
    if (isNaN(qty) || qty <= 0) return;
    await supabase
      .from('product_recipes')
      .update({ quantity_required: qty })
      .eq('id', recipeId);
    setRecetas(prev => prev.map(r => (r.id === recipeId ? { ...r, quantity_required: qty } : r)));
  }

  // ==============================================================================
  // EDICIÓN COMPLETA DE PLATO (DATOS, FOTO, MODO PRODUCCIÓN Y BOM)
  // ==============================================================================
  function abrirModalEditarPlato(plato) {
    if (!plato) return;
    setEditingDish(plato);
    setEditDishForm({
      name: plato.name || '',
      description: plato.description || '',
      price: plato.price !== undefined && plato.price !== null ? String(plato.price) : '',
      category: plato.category || '',
      image_url: plato.image_url || '',
      is_available: plato.is_available !== false,
      production_mode: plato.production_mode === 'stock' ? 'stock' : 'on_demand',
      ready_stock: parseInt(plato.ready_stock ?? 0, 10) || 0,
      stock: parseInt(plato.stock ?? 50, 10) || 50
    });
    const recsPlato = recetas
      .filter(r => r.product_id === plato.id)
      .map(r => ({
        inventory_item_id: r.inventory_item_id,
        quantity_required: parseFloat(r.quantity_required || 0)
      }));
    setEditDishBom(recsPlato);
    setEditBomIngId(insumos[0]?.id ?? '');
    setEditBomQty('');
  }

  async function handleSubirFotoPlatoEdit(e) {
    const file = e.target.files?.[0];
    if (!file || !local) return;
    setUploadingDishPhoto(true);
    try {
      const { url, storageMode } = await uploadDishPhoto(file, local.id);
      setEditDishForm(prev => ({ ...prev, image_url: url }));
      showNotification(
        storageMode === 'supabase'
          ? 'Fotografía subida a la nube con vista previa lista.'
          : 'Fotografía optimizada con respaldo local listo para guardar.'
      );
    } catch (err) {
      alert('Error cargando fotografía: ' + err.message);
    } finally {
      setUploadingDishPhoto(false);
    }
  }

  function handleEditBomAgregarIngrediente() {
    const ingId = editBomIngId || (insumos[0]?.id ?? '');
    const qty = parseFloat(editBomQty);
    if (!ingId || isNaN(qty) || qty <= 0) {
      alert('Selecciona un ingrediente e ingresa una cantidad mayor a 0.');
      return;
    }
    setEditDishBom(prev => {
      const sinEste = prev.filter(r => r.inventory_item_id !== ingId);
      return [...sinEste, { inventory_item_id: ingId, quantity_required: qty }];
    });
    setEditBomQty('');
  }

  function handleEditBomCambiarCantidad(ingId, val) {
    const qty = parseFloat(val);
    setEditDishBom(prev =>
      prev.map(r => (r.inventory_item_id === ingId ? { ...r, quantity_required: isNaN(qty) ? 0 : qty } : r))
    );
  }

  function handleEditBomQuitarIngrediente(ingId) {
    setEditDishBom(prev => prev.filter(r => r.inventory_item_id !== ingId));
  }

  async function handleGuardarEdicionPlato(e) {
    e.preventDefault();
    if (!editingDish || !local) return;
    if (!editDishForm.name.trim()) {
      alert('El nombre del plato es obligatorio.');
      return;
    }
    const precioNum = parseFloat(editDishForm.price);
    if (isNaN(precioNum) || precioNum <= 0) {
      alert('El precio de venta debe ser mayor a 0.');
      return;
    }

    setSavingDishEdit(true);
    try {
      const res = await actualizarPlatoConBOM({
        productId: editingDish.id,
        datosPlato: {
          ...editDishForm,
          price: precioNum
        },
        ingredientesBOM: editDishBom
      });

      // Actualización inmediata del estado local
      if (res.producto) {
        setProductos(prev => prev.map(p => (p.id === res.producto.id ? res.producto : p)));
      }
      setRecetas(prev => [
        ...prev.filter(r => r.product_id !== editingDish.id),
        ...(res.recetas || [])
      ]);
      await cargarProductosYRecetas(local.id);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tropicalia:catalogo_actualizado', { detail: res.producto }));
      }

      showNotification(`Plato "${editDishForm.name}" y su receta BOM actualizados.`);
      setEditingDish(null);
    } catch (err) {
      alert('Error guardando cambios del plato: ' + err.message);
    } finally {
      setSavingDishEdit(false);
    }
  }

  // ==============================================================================
  // DUALIDAD DE PRODUCCIÓN: STOCK (LOTES ANTICIPADOS) VS POR ENCARGO
  // ==============================================================================
  async function handleCambiarModoProduccion(producto, nuevoModo) {
    const { error } = await supabase
      .from('products')
      .update({ production_mode: nuevoModo })
      .eq('id', producto.id);

    if (!error) {
      await cargarProductosYRecetas(local.id);
      showNotification(`"${producto.name}" configurado en modo ${nuevoModo === 'stock' ? 'Stock (Lotes Anticipados)' : 'Por Encargo (Bajo Pedido)'}.`);
    } else {
      alert('Error cambiando modo de producción: ' + error.message);
    }
  }

  async function handleRegistrarLoteStock(producto) {
    const cant = parseInt(loteCantidades[producto.id] || '0', 10);
    if (isNaN(cant) || cant <= 0) {
      alert('Ingresa la cantidad de porciones preparadas para el lote.');
      return;
    }
    setProduciendoLoteId(producto.id);
    try {
      const recsPlato = recetas.filter(r => r.product_id === producto.id);
      const res = await registrarLoteStock({
        producto,
        cantidadLote: cant,
        recetasDelPlato: recsPlato,
        insumos
      });
      setLoteCantidades(prev => ({ ...prev, [producto.id]: '' }));
      await Promise.all([
        cargarInventario(local.id),
        cargarProductosYRecetas(local.id)
      ]);
      showNotification(`Lote de +${cant} "${producto.name}" registrado (Stock listo: ${res.readyStock}). Ingredientes descontados del inventario.`);
    } catch (err) {
      alert('Error registrando lote: ' + err.message);
    } finally {
      setProduciendoLoteId(null);
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
            {local && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                <span style={{
                  background: 'rgba(255, 255, 255, 0.22)',
                  color: '#ffffff',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  ⭐ {parseFloat(local.rating || 4.90).toFixed(1)} ({local.rating_count || 128} calificaciones)
                </span>
                <span style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: '0.78rem', fontWeight: 600 }}>
                  • {local.category || 'Cocina Gourmet'}
                </span>
              </div>
            )}
            {local && (
              <div style={{ marginTop: '8px' }}>
                <span style={{
                  background: 'rgba(255, 255, 255, 0.16)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: '999px',
                  padding: '4px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <Lock size={12} color="#ffffff" /> Cocina Oficial Exclusiva • {local.name}
                </span>
              </div>
            )}
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
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffffff', display: 'inline-block' }} />
                {local.is_active ? 'Abierto' : 'Pausado'}
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

        {/* PESTAÑAS DE CONTROL DE COCINA (OPERACIÓN EN VIVO vs GESTIÓN Y ANÁLISIS) */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', alignItems: 'center', scrollbarWidth: 'none' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--dark-amaranth)', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
              Operación:
            </span>
            {[
              { id: 'comandas', label: `Comandas (${comandasEnCurso.length})`, icon: ClipboardList },
              { id: 'produccion', label: 'Stock vs. Encargo', icon: Layers },
              { id: 'salon', label: 'Venta Salón', icon: Store }
            ].map(tabItem => {
              const TabIcon = tabItem.icon;
              const isCurrent = tab === tabItem.id;
              return (
                <button
                  key={tabItem.id}
                  type="button"
                  onClick={() => setTab(tabItem.id)}
                  style={{
                    background: isCurrent ? 'var(--dark-amaranth)' : '#ffffff',
                    color: isCurrent ? '#ffffff' : '#4b5563',
                    border: isCurrent ? '1px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                    padding: '7px 14px',
                    borderRadius: '999px',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isCurrent ? '0 4px 12px rgba(130, 19, 58, 0.25)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <TabIcon size={14} color={isCurrent ? '#ffffff' : 'var(--dark-amaranth)'} />
                  <span>{tabItem.label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', alignItems: 'center', paddingBottom: '4px', scrollbarWidth: 'none' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--crimson-violet)', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
              Gestión:
            </span>
            {[
              { id: 'menu', label: `Platos (${productos.length})`, icon: ChefHat },
              { id: 'bom', label: 'Trazabilidad BOM', icon: Scale },
              { id: 'inventario', label: `Compras (${insumos.length})`, icon: ShoppingBag },
              { id: 'merma', label: 'Merma', icon: TrashVinoIcon },
              { id: 'ganancias', label: 'Ganancias y Reportes', icon: TrendingUp }
            ].map(tabItem => {
              const TabIcon = tabItem.icon;
              const isCurrent = tab === tabItem.id;
              return (
                <button
                  key={tabItem.id}
                  type="button"
                  onClick={() => setTab(tabItem.id)}
                  style={{
                    background: isCurrent ? 'var(--crimson-violet)' : '#fdfbf7',
                    color: isCurrent ? '#ffffff' : '#4b5563',
                    border: isCurrent ? '1px solid var(--crimson-violet)' : '1px solid #e5e7eb',
                    padding: '7px 14px',
                    borderRadius: '999px',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isCurrent ? '0 4px 12px rgba(87, 24, 70, 0.22)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <TabIcon size={14} color={isCurrent ? '#ffffff' : 'var(--crimson-violet)'} />
                  <span>{tabItem.label}</span>
                </button>
              );
            })}
          </div>
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
                <ChefHat size={48} color="var(--dark-amaranth)" />
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
                            {esPickup ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <ShoppingBag size={12} /> RETIRO EN BARRA
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Bike size={12} /> DELIVERY
                              </span>
                            )}
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

                          {/* CÓDIGO SEGURO DE VERIFICACIÓN PARA RETIRO EN BARRA (PICK UP) */}
                          {esPickup && (
                            <div style={{
                              marginTop: '8px',
                              background: '#fffbeb',
                              border: '2px dashed var(--golden-orange)',
                              borderRadius: '12px',
                              padding: '8px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <div>
                                <span style={{ fontSize: '0.72rem', color: '#92400e', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <KeyRound size={13} /> CÓDIGO DE RETIRO MOSTRADOR
                                </span>
                                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--dark-amaranth)', letterSpacing: '3px' }}>
                                  {ord.delivery_code || (ord.id || '').slice(0, 4).toUpperCase()}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '0.74rem', color: '#78350f', fontWeight: 700, display: 'block' }}>
                                  Validar con cliente
                                </span>
                                <small style={{ color: '#92400e', fontSize: '0.68rem' }}>
                                  al entregar comanda
                                </small>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {ord.status === 'pending_payment_verification' && (
                            <div
                              style={{
                                flex: 1,
                                padding: '10px 12px',
                                borderRadius: '8px',
                                background: 'rgba(239, 157, 36, 0.14)',
                                border: '1px solid rgba(239, 157, 36, 0.35)',
                                color: '#ef9d24',
                                fontSize: '0.82rem',
                                fontWeight: 700,
                                textAlign: 'center',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px'
                              }}
                            >
                              <Clock size={14} /> Esperando verificación de pago por Administración
                            </div>
                          )}

                          {['pending', 'confirmed', 'paid'].includes(ord.status) && (
                            <button
                              type="button"
                              onClick={() => cambiarEstadoComanda(ord.id, 'cooking')}
                              className="btn-primario"
                              style={{ flex: 1, padding: '10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                            >
                              <ChefHat size={16} /> Iniciar Preparación
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
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px'
                              }}
                            >
                              {esPickup ? '¡Listo en Barra!' : '¡Listo para Despacho!'}
                            </button>
                          )}

                          {ord.status === 'ready' && esPickup && (
                            <button
                              type="button"
                              onClick={() => handleConfirmarEntregaPickup(ord)}
                              style={{
                                flex: 1,
                                background: '#059669',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '999px',
                                fontWeight: 800,
                                fontSize: '0.85rem',
                                padding: '10px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px'
                              }}
                            >
                              <CheckCircle2 size={16} /> Entregar a Cliente en Mostrador
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
                              gap: '6px'
                            }}
                          >
                            <WhatsAppIcon size={16} color="#ffffff" /> WhatsApp Cliente
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
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px'
                            }}
                          >
                            <X size={14} /> Cancelar
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
                <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShoppingBag size={20} color="var(--dark-amaranth)" /> Lista de Compras y Despensa
                </h3>
                <small style={{ color: '#6b7280' }}>
                  Toca el botón <strong>+</strong> para abrir el teclado numérico y reabastecer stock.
                </small>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Buscar ingrediente..."
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
                  onClick={() => abrirActualizadorCostos('ocr')}
                  className="btn-secundario"
                  style={{
                    fontSize: '0.82rem',
                    padding: '8px 14px',
                    borderRadius: '999px',
                    borderColor: 'var(--golden-orange)',
                    color: '#92400e',
                    background: '#fffbeb',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 700
                  }}
                >
                  <Camera size={14} color="#b45309" /> Factura (OCR / Manual)
                </button>

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

            {/* PANEL INTELIGENTE DE ACTUALIZACIÓN DE COSTOS (OPCIÓN A: OCR FACTURA / OPCIÓN B: TABLA MANUAL) */}
            {mostrarActualizadorCostos && (
              <div style={{
                background: '#fdfbf7',
                border: '1.5px solid var(--golden-orange)',
                borderRadius: '16px',
                padding: '18px',
                marginBottom: '20px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.02rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileSpreadsheet size={18} color="var(--dark-amaranth)" /> Actualización Inteligente de Costos ante Inflación
                    </h4>
                    <small style={{ color: '#6b7280' }}>
                      Impacta automáticamente el costo por porción en el módulo BOM.
                    </small>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setModoCostos('ocr')}
                      style={{
                        background: modoCostos === 'ocr' ? 'var(--dark-amaranth)' : '#ffffff',
                        color: modoCostos === 'ocr' ? '#ffffff' : '#374151',
                        border: '1px solid #d1d5db',
                        borderRadius: '999px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      <Camera size={13} /> Opción A: Foto Factura (IA OCR)
                    </button>
                    <button
                      type="button"
                      onClick={() => setModoCostos('manual')}
                      style={{
                        background: modoCostos === 'manual' ? 'var(--dark-amaranth)' : '#ffffff',
                        color: modoCostos === 'manual' ? '#ffffff' : '#374151',
                        border: '1px solid #d1d5db',
                        borderRadius: '999px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      <FileSpreadsheet size={13} /> Opción B: Tabla Manual Rápida
                    </button>
                  </div>
                </div>

                {modoCostos === 'ocr' && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                      <div style={{ background: '#ffffff', padding: '12px', borderRadius: '12px', border: '1px dashed #d1d5db' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark-amaranth)', display: 'block', marginBottom: '6px' }}>
                          Subir Foto de Factura o Ticket de Proveedor
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleProcesarFotoFactura}
                          style={{ fontSize: '0.8rem', width: '100%' }}
                        />
                        {ocrLoading && <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--dark-amaranth)', fontWeight: 700 }}>Extrayendo y filtrando productos...</p>}
                      </div>

                      <div style={{ background: '#ffffff', padding: '12px', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: '4px' }}>
                          O pegar líneas del ticket (Nombre | Cant | Precio Unit.)
                        </label>
                        <textarea
                          rows={2}
                          value={ocrTextoRespaldo}
                          onChange={e => setOcrTextoRespaldo(e.target.value)}
                          placeholder="Ej: Carne Molida | 10 | 6.50&#10;Desodorante | 1 | 4.50"
                          style={{ width: '100%', fontSize: '0.78rem', padding: '6px', borderRadius: '8px', border: '1px solid #d1d5db', resize: 'vertical' }}
                        />
                        <button
                          type="button"
                          onClick={handleProcesarTextoFactura}
                          className="btn-secundario"
                          style={{ marginTop: '6px', padding: '4px 10px', fontSize: '0.76rem' }}
                        >
                          Analizar con Filtro Inteligente
                        </button>
                      </div>
                    </div>

                    {ocrPreview && (
                      <div style={{ background: '#ffffff', borderRadius: '12px', padding: '14px', border: '1px solid #e5e7eb' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                          <strong style={{ color: '#065f46', fontSize: '0.86rem' }}>
                            Insumos Mapeados al Inventario ({ocrPreview.actualizables.length})
                          </strong>
                          <span style={{ fontSize: '0.74rem', color: '#6b7280' }}>
                            Gastos ajenos ignorados automáticamente: {ocrPreview.ignorados.length}
                          </span>
                        </div>

                        {ocrPreview.actualizables.length > 0 && (
                          <div className="tabla-container" style={{ marginBottom: '12px' }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>Insumo Inventario</th>
                                  <th>Concepto Factura</th>
                                  <th>Costo Ant.</th>
                                  <th>Nuevo Costo Unit. ($)</th>
                                  <th>Cant. Comprada</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ocrPreview.actualizables.map((row, idx) => (
                                  <tr key={row.insumoId}>
                                    <td><strong>{row.insumoNombre}</strong> ({row.unit})</td>
                                    <td style={{ fontSize: '0.78rem', color: '#6b7280' }}>{row.conceptoFactura}</td>
                                    <td>{formatUsd(row.costoAnterior)}</td>
                                    <td>
                                      <input
                                        type="number"
                                        step="0.0001"
                                        value={row.nuevoCostoUnitario}
                                        onChange={e => {
                                          const val = parseFloat(e.target.value) || 0;
                                          setOcrPreview(prev => {
                                            const copy = [...prev.actualizables];
                                            copy[idx] = { ...copy[idx], nuevoCostoUnitario: val };
                                            return { ...prev, actualizables: copy };
                                          });
                                        }}
                                        style={{ width: '90px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={row.cantidadComprada}
                                        onChange={e => {
                                          const val = parseFloat(e.target.value) || 0;
                                          setOcrPreview(prev => {
                                            const copy = [...prev.actualizables];
                                            copy[idx] = { ...copy[idx], cantidadComprada: val };
                                            return { ...prev, actualizables: copy };
                                          });
                                        }}
                                        style={{ width: '75px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {ocrPreview.ignorados.length > 0 && (
                          <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '0.76rem', color: '#991b1b' }}>
                            <strong>Filtro Inteligente (Ignorados automáticamente):</strong>
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                              {ocrPreview.ignorados.map((ig, i) => (
                                <li key={i}>{ig.concepto} ({formatUsd(ig.precioUnitario)}) — {ig.motivo}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            disabled={guardandoCostos || ocrPreview.actualizables.length === 0}
                            onClick={() => handleAplicarCostosOCR(true)}
                            className="btn-primario"
                            style={{ fontSize: '0.82rem', padding: '8px 16px' }}
                          >
                            {guardandoCostos ? 'Aplicando...' : 'Aplicar Costos y Sumar Stock'}
                          </button>
                          <button
                            type="button"
                            disabled={guardandoCostos || ocrPreview.actualizables.length === 0}
                            onClick={() => handleAplicarCostosOCR(false)}
                            className="btn-secundario"
                            style={{ fontSize: '0.82rem', padding: '8px 16px' }}
                          >
                            Solo Actualizar Precios Unitarios
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {modoCostos === 'manual' && (
                  <form onSubmit={handleGuardarCostosManuales}>
                    <div className="tabla-container" style={{ background: '#ffffff', borderRadius: '12px', marginBottom: '12px' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Insumo</th>
                            <th>Stock Actual</th>
                            <th>Costo Unitario ($)</th>
                            <th>Sumar Compra (Opcional)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {insumos.map(ins => {
                            const ed = manualCostEdits[ins.id] || { unitCost: ins.unit_cost || 0, addQty: '' };
                            return (
                              <tr key={ins.id}>
                                <td><strong>{ins.name}</strong> ({ins.unit})</td>
                                <td>{ins.quantity} {ins.unit}</td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    value={ed.unitCost}
                                    onChange={e => setManualCostEdits(prev => ({
                                      ...prev,
                                      [ins.id]: { ...ed, unitCost: e.target.value }
                                    }))}
                                    style={{ width: '100px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="+0"
                                    value={ed.addQty}
                                    onChange={e => setManualCostEdits(prev => ({
                                      ...prev,
                                      [ins.id]: { ...ed, addQty: e.target.value }
                                    }))}
                                    style={{ width: '85px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button type="submit" disabled={guardandoCostos} className="btn-primario" style={{ fontSize: '0.84rem', padding: '9px 18px' }}>
                      {guardandoCostos ? 'Guardando...' : 'Guardar Costos e Impactar BOM'}
                    </button>
                  </form>
                )}
              </div>
            )}

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

                  return (
                    <div
                      key={ins.id}
                      className="shopping-card-item"
                      style={{ animationDelay: `${index * 35}ms` }}
                    >
                      <div className="shopping-card-icon">
                        <Package size={22} color="var(--dark-amaranth)" />
                      </div>

                      <div className="shopping-card-info">
                        <h4 className="shopping-card-name">{ins.name}</h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="shopping-card-qty">
                            {cant} {ins.unit}
                          </span>
                          <span style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: '#fdfbf7',
                            color: 'var(--crimson-violet)',
                            border: '1px solid #e5e7eb'
                          }}>
                            Costo: {formatUsd(ins.unit_cost || 0)}/{ins.unit}
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
                            {bajo ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <AlertTriangle size={11} /> Crítico
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <CheckCircle2 size={11} /> Óptimo
                              </span>
                            )}
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
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <TrashVinoIcon size={18} />
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
            2B. TRAZABILIDAD DE RECETAS (BOM - BILL OF MATERIALS) INDEPENDIENTE
           ============================================================================== */}
        {tab === 'bom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '20px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Scale size={20} color="var(--dark-amaranth)" /> Trazabilidad de Recetas (BOM) y Costos por Porción
                  </h3>
                  <small style={{ color: '#6b7280' }}>
                    Asocia ingredientes exactos a cada plato para calcular costo de producción y margen neto (descontando 3% comisión cocina).
                  </small>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={bomSelectedProductId || (productos[0]?.id ?? '')}
                    onChange={e => setBomSelectedProductId(e.target.value)}
                    className="form-input-figma"
                    style={{ margin: 0, minWidth: '240px', fontWeight: 700 }}
                  >
                    {productos.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — PVP {formatUsd(p.price)}
                      </option>
                    ))}
                  </select>
                  {productos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => abrirModalEditarPlato(productos.find(p => p.id === (bomSelectedProductId || productos[0]?.id)))}
                      className="btn-primario"
                      style={{ padding: '8px 14px', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Pencil size={14} /> Editar Plato y BOM
                    </button>
                  )}
                </div>
              </div>

              {(() => {
                const platoActivo = productos.find(p => p.id === (bomSelectedProductId || productos[0]?.id));
                if (!platoActivo) return <p style={{ color: '#6b7280' }}>No hay platos registrados en el menú.</p>;
                const recsPlato = recetas.filter(r => r.product_id === platoActivo.id);
                const bom = calcularCostoYMargenPlato(platoActivo, recsPlato, insumos);

                return (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
                      <div className="kpi-stat-card">
                        <div className="kpi-stat-title">Precio de Venta (PVP)</div>
                        <div className="kpi-stat-value">{formatUsd(bom.precioVenta)}</div>
                      </div>
                      <div className="kpi-stat-card">
                        <div className="kpi-stat-title">Costo Producción (BOM)</div>
                        <div className="kpi-stat-value" style={{ color: 'var(--crimson-violet)' }}>{formatUsd(bom.costoProduccion)}</div>
                      </div>
                      <div className="kpi-stat-card">
                        <div className="kpi-stat-title">Comisión Cocina (3%)</div>
                        <div className="kpi-stat-value" style={{ color: '#b45309' }}>-{formatUsd(bom.comisionCocina)}</div>
                      </div>
                      <div className="kpi-stat-card">
                        <div className="kpi-stat-title">Margen Neto / Porción</div>
                        <div className="kpi-stat-value" style={{ color: bom.gananciaNeta >= 0 ? '#059669' : '#dc2626' }}>
                          {formatUsd(bom.gananciaNeta)} ({bom.margenPct}%)
                        </div>
                      </div>
                    </div>

                    <form onSubmit={handleBomAgregarIngrediente} style={{ background: '#fdfbf7', border: '1px dashed #d6cbbe', borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '10px', alignItems: 'center' }}>
                        <select
                          value={bomAddIngId || (insumos[0]?.id ?? '')}
                          onChange={e => setBomAddIngId(e.target.value)}
                          className="form-input-figma"
                          style={{ margin: 0 }}
                        >
                          {insumos.map(i => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.unit}) — Costo {formatUsd(i.unit_cost || 0)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Cantidad por porción"
                          value={bomAddQty}
                          onChange={e => setBomAddQty(e.target.value)}
                          className="form-input-figma"
                          style={{ margin: 0 }}
                          required
                        />
                        <button type="submit" className="btn-primario" style={{ padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <Plus size={14} /> Asociar a Receta
                        </button>
                      </div>
                    </form>

                    {bom.detalleIngredientes.length === 0 ? (
                      <p style={{ color: '#6b7280', fontStyle: 'italic' }}>Este plato aún no tiene ingredientes asociados en su BOM.</p>
                    ) : (
                      <div className="tabla-container">
                        <table>
                          <thead>
                            <tr>
                              <th>Ingrediente</th>
                              <th>Cantidad / Porción</th>
                              <th>Costo Unitario</th>
                              <th>Costo en Plato</th>
                              <th>Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recsPlato.map(r => {
                              const ins = insumos.find(i => i.id === r.inventory_item_id);
                              if (!ins) return null;
                              const sub = parseFloat(r.quantity_required || 0) * parseFloat(ins.unit_cost || 0);
                              return (
                                <tr key={r.id}>
                                  <td><strong>{ins.name}</strong></td>
                                  <td>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        defaultValue={r.quantity_required}
                                        onBlur={e => handleBomActualizarCantidadInline(r.id, e.target.value)}
                                        style={{ width: '80px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #d1d5db', fontWeight: 700 }}
                                      />
                                      <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{ins.unit}</span>
                                    </div>
                                  </td>
                                  <td>{formatUsd(ins.unit_cost || 0)}</td>
                                  <td><strong style={{ color: 'var(--dark-amaranth)' }}>{formatUsd(sub)}</strong></td>
                                  <td>
                                    <button
                                      type="button"
                                      onClick={() => handleBomEliminarIngrediente(r.id)}
                                      style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <TrashVinoIcon size={13} /> Quitar
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ==============================================================================
            2C. DUALIDAD DE PRODUCCIÓN: STOCK (LOTES ANTICIPADOS) VS POR ENCARGO
           ============================================================================== */}
        {tab === 'produccion' && (
          <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '20px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={20} color="var(--dark-amaranth)" /> Dualidad de Producción: Modo Stock vs. Por Encargo
              </h3>
              <small style={{ color: '#6b7280' }}>
                Elige por plato si se produce por adelantado en lotes (descuenta insumos al crear el lote y cada venta descuenta solo del stock listo) o bajo pedido (descuenta ingredientes al confirmarse la orden).
              </small>
            </div>

            <div className="tabla-container">
              <table>
                <thead>
                  <tr>
                    <th>Plato</th>
                    <th>Modelo Operativo</th>
                    <th>Stock Listo / Lote</th>
                    <th>Producir Lote Anticipado</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map(p => {
                    const esStock = p.production_mode === 'stock';
                    return (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong><br />
                          <small style={{ color: '#6b7280' }}>{formatUsd(p.price)}</small>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => handleCambiarModoProduccion(p, 'stock')}
                              style={{
                                background: esStock ? 'var(--dark-amaranth)' : '#f3f4f6',
                                color: esStock ? '#ffffff' : '#374151',
                                border: 'none',
                                borderRadius: '999px',
                                padding: '5px 12px',
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              Modo Stock (Lotes)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCambiarModoProduccion(p, 'on_demand')}
                              style={{
                                background: !esStock ? 'var(--crimson-violet)' : '#f3f4f6',
                                color: !esStock ? '#ffffff' : '#374151',
                                border: 'none',
                                borderRadius: '999px',
                                padding: '5px 12px',
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              Por Encargo (Bajo Pedido)
                            </button>
                          </div>
                        </td>
                        <td>
                          {esStock ? (
                            <span style={{ background: '#ecfdf5', color: '#065f46', padding: '4px 10px', borderRadius: '999px', fontWeight: 800, fontSize: '0.8rem' }}>
                              {parseInt(p.ready_stock || 0, 10)} porciones listas
                            </span>
                          ) : (
                            <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>Según inventario de insumos</span>
                          )}
                        </td>
                        <td>
                          {esStock ? (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <input
                                type="number"
                                min="1"
                                placeholder="Cant."
                                value={loteCantidades[p.id] || ''}
                                onChange={e => setLoteCantidades(prev => ({ ...prev, [p.id]: e.target.value }))}
                                style={{ width: '75px', padding: '5px 8px', borderRadius: '8px', border: '1px solid #d1d5db' }}
                              />
                              <button
                                type="button"
                                disabled={produciendoLoteId === p.id}
                                onClick={() => handleRegistrarLoteStock(p)}
                                className="btn-primario"
                                style={{ padding: '6px 12px', fontSize: '0.76rem', background: 'var(--golden-orange)', color: '#fff' }}
                              >
                                {produciendoLoteId === p.id ? 'Procesando...' : '+ Producir Lote'}
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: '#9ca3af', fontSize: '0.76rem' }}>Activa Modo Stock para lotes</span>
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

        {/* ==============================================================================
            3. CONTROL DE MERMA (DESPERDICIO)
           ============================================================================== */}
        {tab === 'merma' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            
            {/* FORMULARIO DE REGISTRO DE MERMA */}
            <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '20px', padding: '20px', boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <TrashVinoIcon size={20} />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <ClipboardList size={20} color="var(--dark-amaranth)" />
                <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem' }}>
                  Historial de Mermas Registradas
                </h3>
              </div>

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
            {/* SUBPESTAÑAS COMPACTAS DE GANANCIAS Y REPORTES */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {[
                { id: 'resumen', label: 'Resumen y Liquidación', icon: TrendingUp },
                { id: 'platos', label: 'Platos Estrella y Baja Rotación', icon: Award },
                { id: 'ticket', label: 'Ticket Promedio y Venta Cruzada', icon: DollarSign }
              ].map(st => {
                const StIcon = st.icon;
                const active = gananciasSubTab === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setGananciasSubTab(st.id)}
                    style={{
                      background: active ? 'var(--golden-orange)' : '#ffffff',
                      color: active ? '#1f2937' : '#4b5563',
                      border: active ? '1px solid var(--golden-orange)' : '1px solid #e5e7eb',
                      borderRadius: '999px',
                      padding: '7px 14px',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <StIcon size={14} color={active ? '#1f2937' : 'var(--dark-amaranth)'} />
                    {st.label}
                  </button>
                );
              })}
            </div>

            {gananciasSubTab === 'resumen' && (
              <div>
            {/* TARJETAS KPI DE GANANCIAS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Ganancias Hoy</div>
                <div className="kpi-stat-value">{formatUsd(gananciaDia)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (97%): {formatUsd(gananciaDia * 0.97)}</small>
              </div>

              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Esta Semana</div>
                <div className="kpi-stat-value">{formatUsd(gananciaSemana)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (97%): {formatUsd(gananciaSemana * 0.97)}</small>
              </div>

              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Este Mes</div>
                <div className="kpi-stat-value">{formatUsd(gananciaMes)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (97%): {formatUsd(gananciaMes * 0.97)}</small>
              </div>

              <div className="kpi-stat-card">
                <div className="kpi-stat-title">Este Año</div>
                <div className="kpi-stat-value">{formatUsd(gananciaAnio)}</div>
                <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.75rem' }}>Neto (97%): {formatUsd(gananciaAnio * 0.97)}</small>
              </div>
            </div>

            {/* SELECCIÓN DE PERIODO Y CANVAS DEL GRÁFICO */}
            <div className="chart-box-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp size={20} color="var(--dark-amaranth)" /> Rendimiento de Ventas
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

              {/* AVISO DE CIERRE PENDIENTE DE APROBACIÓN */}
              {cierrePendiente && (
                <div style={{
                  background: '#fffbeb',
                  border: '1.5px solid #f59e0b',
                  borderRadius: '14px',
                  padding: '14px 18px',
                  marginTop: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  boxShadow: '0 2px 8px rgba(245, 158, 11, 0.1)'
                }}>
                  <Clock size={24} color="#f59e0b" />
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: '#92400e', fontSize: '0.9rem', display: 'block', marginBottom: '2px' }}>
                      Cierre de Caja en Proceso de Liquidación ({formatUsd(cierrePendiente.net_amount)})
                    </strong>
                    <span style={{ color: '#b45309', fontSize: '0.8rem', lineHeight: 1.4 }}>
                      Tienes una solicitud de liquidación pendiente de pago por parte de administración. Por control contable, el envío de nuevos cortes se encuentra bloqueado hasta que el administrador confirme la transferencia anterior.
                    </span>
                  </div>
                </div>
              )}

              {/* BOTÓN DE SOLICITUD DE LIQUIDACIÓN / CORTE */}
              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '16px', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', color: '#4b5563', display: 'block', fontWeight: 600 }}>
                    {cierrePendiente ? 'Liquidación actual bloqueada por corte previo en curso.' : '¿Deseas cerrar caja y transferir tus ingresos disponibles?'}
                  </span>
                  <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>
                    {cierrePendiente ? 'Estado: Esperando confirmación bancaria del administrador.' : 'Se aplicará la comisión estándar del 3% para cocina y el neto (97%) irá a tu cuenta bancaria.'}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={solicitarCorteCaja}
                  className="btn-primario"
                  disabled={Boolean(cierrePendiente)}
                  style={{
                    fontSize: '0.85rem',
                    padding: '10px 20px',
                    opacity: cierrePendiente ? 0.55 : 1,
                    cursor: cierrePendiente ? 'not-allowed' : 'pointer',
                    background: cierrePendiente ? '#6b7280' : 'var(--dark-amaranth)',
                    boxShadow: cierrePendiente ? 'none' : '0 4px 12px rgba(130, 19, 58, 0.25)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {cierrePendiente ? (
                    <>
                      <Lock size={14} /> Liquidación en Proceso
                    </>
                  ) : (
                    <>
                      <DollarSign size={14} /> Solicitar Liquidación Bancaria
                    </>
                  )}
                </button>
              </div>

            </div>
              </div>
            )}

            {/* ANALÍTICA AVANZADA: TICKET PROMEDIO, VENTA CRUZADA, PLATOS ESTRELLA Y BAJA ROTACIÓN */}
            {gananciasSubTab !== 'resumen' && (() => {
              const { platosEstrella, platosBajaRotacion } = calcularAnaliticaPlatos(comandasEntregadas, productos, recetas, insumos);
              const ticketData = calcularTicketPromedioYCrossSelling(comandasEntregadas, productos);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  {/* 1. TICKET PROMEDIO Y VENTA CRUZADA */}
                  {gananciasSubTab === 'ticket' && (
                  <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '20px', boxShadow: '0 4px 14px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                      <div>
                        <h4 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <DollarSign size={18} color="var(--golden-orange)" /> Ticket Promedio y Venta Cruzada (Cross-Selling)
                        </h4>
                        <small style={{ color: '#6b7280' }}>
                          Métrica en tiempo real del gasto promedio por orden y oportunidades para elevarlo.
                        </small>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ background: '#fdfbf7', border: '1px solid #fde68a', borderRadius: '12px', padding: '8px 14px' }}>
                          <small style={{ color: '#6b7280', display: 'block', fontSize: '0.72rem' }}>Ticket Promedio Actual</small>
                          <strong style={{ color: 'var(--dark-amaranth)', fontSize: '1.15rem' }}>{formatUsd(ticketData.ticketPromedio)}</strong>
                          <span style={{ fontSize: '0.72rem', color: '#6b7280', marginLeft: '6px' }}>({ticketData.promedioItems} ítems/orden)</span>
                        </div>
                        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '12px', padding: '8px 14px' }}>
                          <small style={{ color: '#065f46', display: 'block', fontSize: '0.72rem' }}>Meta con Venta Cruzada (+20%)</small>
                          <strong style={{ color: '#059669', fontSize: '1.15rem' }}>{formatUsd(ticketData.potencialTicket)}</strong>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                      {ticketData.sugerencias.map(sug => (
                        <div key={sug.categoria} style={{ background: '#f9fafb', borderRadius: '12px', padding: '12px', border: '1px solid #e5e7eb' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <strong style={{ color: 'var(--crimson-violet)', fontSize: '0.88rem' }}>{sug.categoria}</strong>
                            <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '999px', fontWeight: 700 }}>
                              {sug.objetivo}
                            </span>
                          </div>
                          <p style={{ margin: '0 0 6px 0', fontSize: '0.78rem', color: '#4b5563' }}>{sug.recomendacion}</p>
                          {sug.productosDisponibles.length > 0 && (
                            <small style={{ color: '#059669', fontWeight: 700, fontSize: '0.72rem' }}>
                              Activos: {sug.productosDisponibles.join(' • ')}
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  )}

                  {/* 2. PLATOS ESTRELLA Y BAJA ROTACIÓN */}
                  {gananciasSubTab === 'platos' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '18px' }}>
                      <h4 style={{ margin: '0 0 12px 0', color: 'var(--dark-amaranth)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Award size={18} color="var(--golden-orange)" /> Platos Estrella (Mayor Volumen y Margen)
                      </h4>
                      {platosEstrella.length === 0 ? (
                        <p style={{ color: '#6b7280', fontSize: '0.84rem' }}>Aún no hay ventas entregadas para clasificar platos estrella.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {platosEstrella.map((pl, idx) => (
                            <div key={pl.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fdfbf7', borderRadius: '10px', border: '1px solid #fde68a' }}>
                              <div>
                                <strong style={{ color: '#1f2937', fontSize: '0.86rem' }}>#{idx + 1} {pl.name}</strong>
                                <div style={{ fontSize: '0.74rem', color: '#6b7280' }}>
                                  {pl.unidadesVendidas} vendidos • Margen BOM {pl.margenPct}%
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <strong style={{ color: '#059669', fontSize: '0.9rem' }}>{formatUsd(pl.ingresosBrutos)}</strong>
                                <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Neto: {formatUsd(pl.gananciaNetaEstimada)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '18px' }}>
                      <h4 style={{ margin: '0 0 12px 0', color: 'var(--crimson-violet)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ArrowDownRight size={18} color="#dc2626" /> Platos de Baja Rotación
                      </h4>
                      {platosBajaRotacion.length === 0 ? (
                        <p style={{ color: '#6b7280', fontSize: '0.84rem' }}>No hay platos registrados en el menú.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {platosBajaRotacion.map(pl => (
                            <div key={pl.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fef2f2', borderRadius: '10px', border: '1px solid #fecaca' }}>
                              <div>
                                <strong style={{ color: '#1f2937', fontSize: '0.86rem' }}>{pl.name}</strong>
                                <div style={{ fontSize: '0.74rem', color: '#991b1b' }}>
                                  {pl.unidadesVendidas} vendidos • PVP {formatUsd(pl.price)}
                                </div>
                              </div>
                              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#dc2626', background: '#ffffff', padding: '3px 8px', borderRadius: '999px', border: '1px solid #fca5a5' }}>
                                Baja rotación
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </div>
              );
            })()}

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
                <h3 className="menu-book-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ChefHat size={18} color="var(--dark-amaranth)" /> Nuestra Carta
                </h3>
                <div className="menu-book-subtitle">Tropicalia CRB • Menú Principal</div>
              </div>

              {/* Buscador de platos */}
              <div style={{ marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Buscar plato en la carta..."
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
                    <div style={{ marginBottom: '8px' }}>
                      <ShoppingBag size={32} color="#a8a29e" />
                    </div>
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
                          <div className="menu-dish-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt={p.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                            ) : (
                              <ShoppingBag size={22} color="var(--dark-amaranth)" />
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
                                <span><em>{ingredientesTexto}</em></span>
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
                                {p.is_available ? 'Disponible' : 'Pausado'}
                              </button>

                              <button
                                type="button"
                                onClick={() => abrirModalEditarPlato(p)}
                                style={{
                                  background: '#fffbeb',
                                  color: '#92400e',
                                  border: '1px solid var(--golden-orange)',
                                  padding: '3px 10px',
                                  borderRadius: '999px',
                                  fontWeight: 700,
                                  fontSize: '0.74rem',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Editar plato, foto, modo de producción y receta BOM"
                              >
                                <Pencil size={13} color="#b45309" /> Editar
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
                                <TrashVinoIcon size={14} /> Eliminar
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
                <h3 className="menu-book-title" style={{ color: 'var(--golden-orange)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={18} color="var(--golden-orange)" /> Nuevo Plato
                </h3>
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
                      { label: 'Burger', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&auto=format&fit=crop&q=80' },
                      { label: 'Pizza', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&auto=format&fit=crop&q=80' },
                      { label: 'Ensalada', url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&auto=format&fit=crop&q=80' },
                      { label: 'Papas', url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=500&auto=format&fit=crop&q=80' },
                      { label: 'Bebida', url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&auto=format&fit=crop&q=80' },
                      { label: 'Postre', url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&auto=format&fit=crop&q=80' }
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
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--dark-amaranth)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <Package size={16} color="var(--dark-amaranth)" /> Ingredientes de la Receta
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
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <X size={12} />
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
                  {guardandoPlato ? 'Guardando en Carta...' : 'Guardar Plato en la Carta'}
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
                style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '34px', height: '34px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} color="#6b7280" />
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
              Confirmar y Sumar al Stock
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
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                <TrashVinoIcon size={44} />
              </div>
              <h3 style={{ margin: '8px 0 4px 0', color: '#b91c1c', fontSize: '1.3rem' }}>
                ¿Eliminar {itemToDelete.name}?
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#4b5563' }}>
                Esta acción eliminará el ingrediente del inventario de Supabase y <strong>lo removerá de todas las recetas de platos asociadas</strong>.
              </p>
            </div>

            {platosAfectados.length > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '12px', marginBottom: '16px' }}>
                <strong style={{ color: '#991b1b', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <AlertTriangle size={15} color="#b91c1c" />
                  Se removerá de las recetas de los siguientes {platosAfectados.length} platos:
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

      {/* ==============================================================================
          MODAL DE EDICIÓN COMPLETA DE PLATO, FOTOGRAFÍA Y BOM
         ============================================================================== */}
      {editingDish && (() => {
        const bomLive = calcularCostoYMargenPlato(
          { price: parseFloat(editDishForm.price) || 0 },
          editDishBom,
          insumos
        );
        const previewSrc = editDishForm.image_url || getProductImageUrl({ name: editDishForm.name });

        return (
          <div className="modal-figma-overlay" onClick={() => !savingDishEdit && setEditingDish(null)}>
            <div
              className="modal-figma-sheet"
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: '680px', width: '95%', margin: 'auto', maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #e5e7eb', paddingBottom: '10px' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--dark-amaranth)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Pencil size={18} color="var(--dark-amaranth)" /> Editar Plato y Trazabilidad BOM
                  </h3>
                  <small style={{ color: '#6b7280' }}>Los cambios se guardan en Supabase y se reflejan de inmediato en menú, BOM y reportes.</small>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingDish(null)}
                  style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <X size={16} color="#374151" />
                </button>
              </div>

              <form onSubmit={handleGuardarEdicionPlato} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Fotografía con vista previa inmediata y subida directa */}
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', background: '#fdfbf7', padding: '12px', borderRadius: '14px', border: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
                  <div style={{ width: '88px', height: '88px', borderRadius: '12px', overflow: 'hidden', border: '2px solid var(--golden-orange)', flexShrink: 0, background: '#fff' }}>
                    <img src={previewSrc} alt={editDishForm.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--dark-amaranth)', display: 'block', marginBottom: '4px' }}>
                      Fotografía del Plato (Subir archivo o URL)
                    </label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <label style={{
                        background: 'var(--dark-amaranth)',
                        color: '#ffffff',
                        padding: '6px 12px',
                        borderRadius: '999px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}>
                        <Upload size={13} /> {uploadingDishPhoto ? 'Subiendo...' : 'Subir Foto'}
                        <input type="file" accept="image/*" onChange={handleSubirFotoPlatoEdit} style={{ display: 'none' }} />
                      </label>
                      <input
                        type="text"
                        placeholder="https://... o foto cargada"
                        value={editDishForm.image_url}
                        onChange={e => setEditDishForm(prev => ({ ...prev, image_url: e.target.value }))}
                        className="form-input-figma"
                        style={{ margin: 0, padding: '6px 10px', fontSize: '0.8rem', flex: 1 }}
                      />
                    </div>
                  </div>
                </div>

                {/* Datos principales del plato */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Nombre del Plato *</label>
                    <input
                      type="text"
                      required
                      value={editDishForm.name}
                      onChange={e => setEditDishForm(prev => ({ ...prev, name: e.target.value }))}
                      className="form-input-figma"
                      style={{ margin: 0 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Precio de Venta ($ USD) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={editDishForm.price}
                      onChange={e => setEditDishForm(prev => ({ ...prev, price: e.target.value }))}
                      className="form-input-figma"
                      style={{ margin: 0 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Categoría</label>
                    <input
                      type="text"
                      placeholder="Ej: Hamburguesas, Bebidas, Postres"
                      value={editDishForm.category}
                      onChange={e => setEditDishForm(prev => ({ ...prev, category: e.target.value }))}
                      className="form-input-figma"
                      style={{ margin: 0 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700 }}>Descripción</label>
                  <textarea
                    rows={2}
                    placeholder="Descripción visible en el catálogo del cliente..."
                    value={editDishForm.description}
                    onChange={e => setEditDishForm(prev => ({ ...prev, description: e.target.value }))}
                    className="form-input-figma"
                    style={{ margin: 0, resize: 'vertical' }}
                  />
                </div>

                {/* Disponibilidad y Modelo Operativo (Stock vs Por Encargo) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', background: '#f9fafb', padding: '12px', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Estado en Menú</label>
                    <select
                      value={editDishForm.is_available ? 'true' : 'false'}
                      onChange={e => setEditDishForm(prev => ({ ...prev, is_available: e.target.value === 'true' }))}
                      className="form-input-figma"
                      style={{ margin: 0 }}
                    >
                      <option value="true">Disponible para clientes</option>
                      <option value="false">Pausado / Agotado</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Modelo Operativo</label>
                    <select
                      value={editDishForm.production_mode}
                      onChange={e => setEditDishForm(prev => ({ ...prev, production_mode: e.target.value }))}
                      className="form-input-figma"
                      style={{ margin: 0 }}
                    >
                      <option value="on_demand">Por Encargo (Bajo Pedido)</option>
                      <option value="stock">Modo Stock (Lotes Anticipados)</option>
                    </select>
                  </div>
                  {editDishForm.production_mode === 'stock' && (
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Stock Listo (Porciones)</label>
                      <input
                        type="number"
                        min="0"
                        value={editDishForm.ready_stock}
                        onChange={e => setEditDishForm(prev => ({ ...prev, ready_stock: parseInt(e.target.value || '0', 10) }))}
                        className="form-input-figma"
                        style={{ margin: 0 }}
                      />
                    </div>
                  )}
                </div>

                {/* Receta e Ingredientes BOM con recálculo en vivo */}
                <div style={{ background: '#fdfbf7', border: '1.5px dashed #d6cbbe', borderRadius: '14px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    <strong style={{ color: 'var(--dark-amaranth)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Scale size={16} color="var(--dark-amaranth)" /> Ingredientes y Proporciones (BOM)
                    </strong>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.76rem', fontWeight: 700, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--crimson-violet)' }}>Costo BOM: {formatUsd(bomLive.costoProduccion)}</span>
                      <span style={{ color: '#b45309' }}>Com. 3%: -{formatUsd(bomLive.comisionCocina)}</span>
                      <span style={{ color: bomLive.gananciaNeta >= 0 ? '#059669' : '#dc2626' }}>
                        Ganancia Neta: {formatUsd(bomLive.gananciaNeta)} ({bomLive.margenPct}%)
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '8px', marginBottom: '10px' }}>
                    <select
                      value={editBomIngId || (insumos[0]?.id ?? '')}
                      onChange={e => setEditBomIngId(e.target.value)}
                      className="form-input-figma"
                      style={{ margin: 0, padding: '7px 8px', fontSize: '0.82rem' }}
                    >
                      {insumos.map(i => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unit}) — {formatUsd(i.unit_cost || 0)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Cant./porción"
                      value={editBomQty}
                      onChange={e => setEditBomQty(e.target.value)}
                      className="form-input-figma"
                      style={{ margin: 0, padding: '7px 8px', fontSize: '0.82rem' }}
                    />
                    <button
                      type="button"
                      onClick={handleEditBomAgregarIngrediente}
                      className="btn-primario"
                      style={{ padding: '7px 12px', fontSize: '0.8rem', background: 'var(--crimson-violet)', color: '#fff', borderRadius: '8px' }}
                    >
                      + Añadir
                    </button>
                  </div>

                  {editDishBom.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#78716c', fontStyle: 'italic' }}>
                      Sin ingredientes asociados en el BOM. Agrega los insumos arriba.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {editDishBom.map(item => {
                        const ins = insumos.find(i => i.id === item.inventory_item_id);
                        if (!ins) return null;
                        const sub = parseFloat(item.quantity_required || 0) * parseFloat(ins.unit_cost || 0);
                        return (
                          <div key={item.inventory_item_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e5e7eb', gap: '8px' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, flex: 1 }}>{ins.name}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={item.quantity_required}
                                onChange={e => handleEditBomCambiarCantidad(item.inventory_item_id, e.target.value)}
                                style={{ width: '74px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.8rem' }}
                              />
                              <span style={{ fontSize: '0.74rem', color: '#6b7280', minWidth: '30px' }}>{ins.unit}</span>
                            </div>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--dark-amaranth)', minWidth: '58px', textAlign: 'right' }}>
                              {formatUsd(sub)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleEditBomQuitarIngrediente(item.inventory_item_id)}
                              style={{ background: '#fee2e2', border: 'none', borderRadius: '6px', padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              title="Quitar ingrediente"
                            >
                              <TrashVinoIcon size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setEditingDish(null)}
                    className="btn-secundario"
                    style={{ flex: 1 }}
                    disabled={savingDishEdit}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn-primario"
                    style={{ flex: 2, background: 'var(--dark-amaranth)', color: '#fff', fontWeight: 800 }}
                    disabled={savingDishEdit}
                  >
                    {savingDishEdit ? 'Guardando Cambios...' : 'Guardar Cambios y Recalcular BOM'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
