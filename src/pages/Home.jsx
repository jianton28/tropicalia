import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { fetchTasaBCV, toBs, formatUsd, formatBs } from '../services/bcvService';
import { getProductImageUrl } from '../services/imageService';
import { favoritesService } from '../services/favoritesService';
import { semanticSearchService } from '../services/semanticSearchService';
import GlobalSearchBar from '../components/common/GlobalSearchBar';

const CATEGORIAS_FIGMA = [
  'Todos',
  '❤️ Favoritos',
  'Platos Salados',
  'Platos Dulces',
  'Hamburguesas',
  'Pizzas',
  'Sushi',
  'Bebidas'
];

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 2.0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.2, parseFloat((R * c * 1.25).toFixed(1)));
}

export default function Home({ onTriggerSearch, searchOpen }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { cart, totalCount, subtotalUsd, addItem } = useCart();

  const [tasaBCV, setTasaBCV] = useState(875.65);
  const [negocios, setNegocios] = useState([]);
  const [negocioActivo, setNegocioActivo] = useState(null);
  const [productos, setProductos] = useState([]);
  const [todosLosProductos, setTodosLosProductos] = useState([]);
  const [loadingLocales, setLoadingLocales] = useState(true);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDualTab, setSearchDualTab] = useState('todo'); // 'todo' | 'restaurantes' | 'platos'
  const [localSearchOpen, setLocalSearchOpen] = useState(true);

  // Coordenadas del usuario para ordenamiento por cercanía geográfica
  const [userCoords, setUserCoords] = useState(() => {
    const lat = localStorage.getItem('tropicalia_user_lat');
    const lng = localStorage.getItem('tropicalia_user_lng');
    return lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : { lat: 10.4950, lng: -66.8480 };
  });

  // Modal de Detalle de Plato (Figma 'detalle')
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [modalQty, setModalQty] = useState(1);

  // Dirección de entrega
  const [direccion, setDireccion] = useState(() => {
    return localStorage.getItem('tropicalia_delivery_address') || 'Av. Las Delicias, Edif. Torre';
  });
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [tempDireccion, setTempDireccion] = useState('');

  // Notificación toast breve al agregar
  const [toastMsg, setToastMsg] = useState('');

  // Orden activa
  const [ultimaOrdenId, setUltimaOrdenId] = useState(null);

  // Sistema de Platos Favoritos
  const [favorites, setFavorites] = useState(() => favoritesService.getFavorites());

  useEffect(() => {
    // Sincronizar favoritos al montar
    const handleFavsChanged = (e) => {
      setFavorites(e.detail || favoritesService.getFavorites());
    };
    window.addEventListener('tropicalia:favorites_changed', handleFavsChanged);
    if (user?.id) {
      favoritesService.syncWithSupabase(user.id);
    }
    return () => {
      window.removeEventListener('tropicalia:favorites_changed', handleFavsChanged);
    };
  }, [user]);

  async function handleToggleFavorite(productId, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const isNowFav = await favoritesService.toggleFavorite(productId, user?.id);
    showToast(isNowFav ? '❤️ Agregado a tus favoritos' : '🤍 Eliminado de tus favoritos');
  }

  useEffect(() => {
    fetchTasaBCV().then(r => setTasaBCV(r));

    const lastId = localStorage.getItem('tropicalia_last_order_id');
    if (lastId) {
      supabase.from('orders').select('status').eq('id', lastId).maybeSingle().then(({ data }) => {
        if (data && !['delivered', 'cancelled', 'rejected'].includes(data.status)) {
          setUltimaOrdenId(lastId);
        } else {
          localStorage.removeItem('tropicalia_last_order_id');
          setUltimaOrdenId(null);
        }
      });
    }

    // Auto-detección de GPS del cliente para ordenamiento por cercanía
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserCoords(coords);
          localStorage.setItem('tropicalia_user_lat', coords.lat.toString());
          localStorage.setItem('tropicalia_user_lng', coords.lng.toString());
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }

    cargarRestaurantes();
  }, []);

  async function cargarRestaurantes() {
    setLoadingLocales(true);
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    setLoadingLocales(false);
    if (!error && data && data.length > 0) {
      setNegocios(data);
      const guardadoId = localStorage.getItem('tropicalia_business_id');
      const inicial = data.find(n => n.id === guardadoId) || data[0];
      seleccionarRestaurante(inicial);
    }

    // Cargar catálogo global de todos los platos para el Buscador Global
    try {
      const { data: todosProds } = await supabase
        .from('products')
        .select('*, businesses(id, name, lat, lng, rating, rating_count, is_active)')
        .eq('is_available', true);

      if (todosProds) {
        setTodosLosProductos(todosProds);
      }
    } catch (e) {
      console.warn('Carga de catálogo global:', e);
    }
  }

  async function seleccionarRestaurante(negocio) {
    if (!negocio) return;
    setNegocioActivo(negocio);
    localStorage.setItem('tropicalia_business_id', negocio.id);
    setLoadingMenu(true);

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', negocio.id)
      .eq('is_available', true)
      .order('name', { ascending: true });

    setLoadingMenu(false);
    if (!error && data) {
      setProductos(data);
    } else {
      setProductos([]);
    }
  }

  // ==============================================================================
  // 1. LISTADO GLOBAL DE RESTAURANTES ORDENADOS POR CALIFICACIÓN Y CERCANÍA
  // ==============================================================================
  const listaRestaurantesOrdenados = useMemo(() => {
    if (!negocios || negocios.length === 0) return [];

    const conMetricas = negocios.map(n => {
      const latBz = parseFloat(n.lat || 10.4880);
      const lngBz = parseFloat(n.lng || -66.8650);
      const distKm = calcularDistanciaKm(userCoords.lat, userCoords.lng, latBz, lngBz);
      const rating = parseFloat(n.rating || 4.90);
      const ratingCount = parseInt(n.rating_count || 120, 10);
      return {
        ...n,
        distanciaKm: distKm,
        rating: rating,
        ratingCount: ratingCount
      };
    });

    // Algoritmo de Priorización:
    // Criterio 1: Calificación del restaurante (estrellas)
    // Criterio 2: Cercanía geográfica respecto al cliente (distancia en km)
    conMetricas.sort((a, b) => {
      const difRating = b.rating - a.rating;
      if (Math.abs(difRating) >= 0.20) {
        return difRating;
      }
      const difDist = a.distanciaKm - b.distanciaKm;
      if (Math.abs(difDist) >= 0.3) {
        return difDist;
      }
      const scoreA = (a.rating * 25) - (a.distanciaKm * 3);
      const scoreB = (b.rating * 25) - (b.distanciaKm * 3);
      return scoreB - scoreA;
    });

    return conMetricas;
  }, [negocios, userCoords]);

  // ==============================================================================
  // 2. BUSCADOR GLOBAL INTELIGENTE (SINÓNIMOS CON IA, PLATOS Y RESTAURANTES CRUZADOS)
  // ==============================================================================
  const { restaurantesCoincidentes, platosIndependientes, interpretacion } = useMemo(() => {
    if (!searchQuery.trim()) {
      return {
        restaurantesCoincidentes: [],
        platosIndependientes: [],
        interpretacion: null,
        totalEncontrados: 0
      };
    }

    return semanticSearchService.buscarCatalogoLocal({
      query: searchQuery,
      productos: todosLosProductos,
      restaurantes: listaRestaurantesOrdenados,
      userCoords
    });
  }, [searchQuery, todosLosProductos, listaRestaurantesOrdenados, userCoords]);

  // Filtrado por categoría y búsqueda
  const productosFiltrados = useMemo(() => {
    const coleccionBase = (categoriaActiva === '❤️ Favoritos' && todosLosProductos.length > 0)
      ? todosLosProductos
      : productos;

    return coleccionBase.filter(p => {
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();

      // Filtro de búsqueda textual
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesQuery = name.includes(query) || desc.includes(query);
        if (!matchesQuery) return false;
      }

      // Filtro de categoría
      if (categoriaActiva === 'Todos') return true;

      if (categoriaActiva === '❤️ Favoritos') {
        return favorites.includes(p.id);
      }

      if (categoriaActiva === 'Platos Salados') {
        const esDulce = name.includes('choc') || name.includes('mousse') || name.includes('tiramis') || name.includes('dulce') || name.includes('vainilla');
        return !esDulce && !name.includes('bebida') && !name.includes('jugo');
      }

      if (categoriaActiva === 'Platos Dulces') {
        return name.includes('choc') || name.includes('mousse') || name.includes('tiramis') || name.includes('dulce') || name.includes('fresa') || name.includes('vainilla');
      }

      if (categoriaActiva === 'Hamburguesas') {
        const syns = ['hamburguesa', 'burger', 'cheeseburger', 'smash', 'angus', 'papa'];
        return syns.some(s => name.includes(s) || desc.includes(s));
      }

      if (categoriaActiva === 'Pizzas') {
        const syns = ['pizza', 'margarita', 'pepperoni', 'calzone', 'focaccia', 'napolitana'];
        return syns.some(s => name.includes(s) || desc.includes(s));
      }

      if (categoriaActiva === 'Sushi') {
        const syns = ['sushi', 'roll', 'maki', 'tempura', 'sashimi', 'nigiri', 'salmon'];
        return syns.some(s => name.includes(s) || desc.includes(s));
      }

      if (categoriaActiva === 'Bebidas') {
        const syns = ['bebida', 'jugo', 'refresco', 'soda', 'coca', 'pepsi', 'café', 'cafe', 'cerveza', 'agua'];
        return syns.some(s => name.includes(s) || desc.includes(s));
      }

      return true;
    });
  }, [productos, todosLosProductos, categoriaActiva, searchQuery, favorites]);

  function handleOpenModal(producto) {
    setSelectedProduct(producto);
    setModalQty(1);
  }

  function handleCloseModal() {
    setSelectedProduct(null);
    setModalQty(1);
  }

  function handleConfirmarAgregar() {
    if (!selectedProduct || !negocioActivo) return;

    const precio = parseFloat(selectedProduct.price || 0);
    const added = addItem(
      {
        id: selectedProduct.id,
        name: selectedProduct.name,
        price: precio,
        image_url: selectedProduct.image_url,
        quantity: modalQty,
      },
      negocioActivo.id,
      negocioActivo.name
    );

    if (added) {
      showToast(`¡${modalQty}x ${selectedProduct.name} agregado al carrito!`);
      handleCloseModal();
    }
  }

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2800);
  }

  function guardarDireccion(e) {
    e.preventDefault();
    if (tempDireccion.trim()) {
      setDireccion(tempDireccion.trim());
      localStorage.setItem('tropicalia_delivery_address', tempDireccion.trim());
    }
    setShowAddressModal(false);
  }

  const nombreUsuario = user?.user_metadata?.full_name?.split(' ')[0] || 'Bienvenido';

  return (
    <div style={{ position: 'relative', minHeight: '100vh', backgroundColor: '#ffffff', paddingBottom: '90px' }}>
      
      {/* TOAST DE FEEDBACK */}
      {toastMsg && (
        <div className="toast-feedback">
          {toastMsg}
        </div>
      )}

      {/* HEADER OFICIAL FIGMA (GRADIENTE AMARANTO / VIOLETA) */}
      <header className="figma-header">
        <div className="figma-header-top">
          <h1 className="figma-header-title">
            {nombreUsuario}
          </h1>
          <Link to="/checkout" className="figma-cart-pill" aria-label="Ir al carrito">
            <span>🛒</span>
            <span>{totalCount}</span>
          </Link>
        </div>

        {/* Pastilla de ubicación y tasa BCV */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="figma-delivery-pill"
            onClick={() => {
              setTempDireccion(direccion);
              setShowAddressModal(true);
            }}
            title="Cambiar dirección de entrega"
          >
            <span>📍</span>
            <span style={{ maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Entregar en: {direccion}
            </span>
            <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>▼</span>
          </button>

          <span style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 600 }}>
            💵 BCV: {formatBs(tasaBCV)}
          </span>
        </div>

        {/* Buscador Global Inteligente con IA y Sinónimos */}
        <GlobalSearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          interpretacion={interpretacion}
        />

        {/* Selector de Categorías Horizontal Figma */}
        <div className="category-scroll-container">
          {CATEGORIAS_FIGMA.map(cat => (
            <button
              key={cat}
              type="button"
              className={`category-pill ${categoriaActiva === cat ? 'active' : ''}`}
              onClick={() => setCategoriaActiva(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </header>

      {/* ESTRUCTURA DE NAVEGACIÓN DE RESTAURANTES TROPICALIA */}
      {listaRestaurantesOrdenados.length > 0 && (
        <section style={{ padding: '16px 20px 8px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <h2 style={{ fontSize: '1.05rem', margin: 0, color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                🏪 Nuestras Cocinas y Restaurantes
              </h2>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                Selecciona una cocina para explorar su menú exclusivo
              </span>
            </div>
            {negocioActivo && (
              <span style={{ fontSize: '0.72rem', background: '#ecfdf5', color: '#065f46', padding: '3px 8px', borderRadius: '999px', fontWeight: 700 }}>
                ✓ {negocioActivo.name.replace('Tropicalia ', '')}
              </span>
            )}
          </div>

          <div style={{
            display: 'flex',
            gap: '12px',
            overflowX: 'auto',
            paddingBottom: '8px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}>
            {listaRestaurantesOrdenados.map(n => {
              const isSelected = negocioActivo?.id === n.id;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    seleccionarRestaurante(n);
                    showToast(`Menú de "${n.name}" cargado`);
                  }}
                  style={{
                    minWidth: '200px',
                    maxWidth: '220px',
                    background: isSelected ? '#ffffff' : '#f9fafb',
                    border: isSelected ? '2px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                    borderRadius: '16px',
                    padding: '12px',
                    cursor: 'pointer',
                    boxShadow: isSelected ? '0 4px 14px rgba(130, 19, 58, 0.12)' : 'none',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--golden-orange)', fontWeight: 800, textTransform: 'uppercase' }}>
                      {n.category || 'Cocina Aliada'}
                    </span>
                    {isSelected && (
                      <span style={{ background: 'var(--dark-amaranth)', color: '#ffffff', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 900 }}>
                        ✓
                      </span>
                    )}
                  </div>
                  <strong style={{ fontSize: '0.92rem', color: isSelected ? 'var(--dark-amaranth)' : '#1f2937', display: 'block', marginBottom: '6px' }}>
                    {n.name}
                  </strong>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800 }}>
                      ⭐ {n.rating.toFixed(1)} ({n.ratingCount}+)
                    </span>
                    <span style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 6px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700 }}>
                      📍 ~{n.distanciaKm.toFixed(1)} km
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* BANNER DE PEDIDO EN CURSO */}
      {ultimaOrdenId && (
        <div style={{ margin: '8px 20px 14px 20px' }}>
          <Link
            to={`/tracking?order_id=${ultimaOrdenId}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(90deg, #064e3b 0%, #047857 100%)',
              color: '#ffffff',
              padding: '12px 16px',
              borderRadius: '16px',
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(4, 120, 87, 0.25)'
            }}
          >
            <div>
              <strong style={{ fontSize: '0.88rem', display: 'block' }}>🛵 Tienes un pedido en curso</strong>
              <small style={{ color: '#a7f3d0' }}>Toca para ver el mapa en vivo y PIN seguro</small>
            </div>
            <span style={{ fontSize: '1.1rem' }}>→</span>
          </Link>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL: BUSCADOR GLOBAL DUAL O MENÚ DE COCINA ACTIVA */}
      <main>
        {searchQuery.trim() ? (
          <section style={{ padding: '0 20px', marginTop: '14px' }}>
            
            {/* CABECERA BUSCADOR GLOBAL DUAL */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                  🔍 Resultados para "{searchQuery}"
                </h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                  Resultados divididos en restaurantes y platos independientes disponibles
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="btn-secundario"
                style={{ padding: '4px 10px', fontSize: '0.78rem', borderRadius: '8px' }}
              >
                ✕ Limpiar Búsqueda
              </button>
            </div>

            {/* PESTAÑAS DEL BUSCADOR DUAL */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
              <button
                type="button"
                onClick={() => setSearchDualTab('todo')}
                style={{
                  background: searchDualTab === 'todo' ? 'var(--dark-amaranth)' : '#f3f4f6',
                  color: searchDualTab === 'todo' ? '#ffffff' : '#4b5563',
                  border: 'none',
                  borderRadius: '999px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Todo ({restaurantesCoincidentes.length + platosIndependientes.length})
              </button>
              <button
                type="button"
                onClick={() => setSearchDualTab('restaurantes')}
                style={{
                  background: searchDualTab === 'restaurantes' ? 'var(--dark-amaranth)' : '#f3f4f6',
                  color: searchDualTab === 'restaurantes' ? '#ffffff' : '#4b5563',
                  border: 'none',
                  borderRadius: '999px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                🏪 Restaurantes ({restaurantesCoincidentes.length})
              </button>
              <button
                type="button"
                onClick={() => setSearchDualTab('platos')}
                style={{
                  background: searchDualTab === 'platos' ? 'var(--dark-amaranth)' : '#f3f4f6',
                  color: searchDualTab === 'platos' ? '#ffffff' : '#4b5563',
                  border: 'none',
                  borderRadius: '999px',
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                🍽️ Platos Disponibles ({platosIndependientes.length})
              </button>
            </div>

            {restaurantesCoincidentes.length === 0 && platosIndependientes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f9fafb', borderRadius: '18px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🔍</div>
                <strong style={{ color: '#374151', fontSize: '1rem' }}>No encontramos resultados para "{searchQuery}"</strong>
                <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: '4px 0 14px 0' }}>
                  Prueba buscando otro plato (hamburguesa, pizza, postre, sushi) o nombre de restaurante.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="btn-primario"
                  style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                >
                  Ver Menú Completo
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* 1. SECCIÓN DUAL: RESTAURANTES PRIORIZADOS */}
                {(searchDualTab === 'todo' || searchDualTab === 'restaurantes') && restaurantesCoincidentes.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '1.1rem' }}>🏪</span>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                        Restaurantes Coincidentes ({restaurantesCoincidentes.length})
                      </h3>
                      <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>
                        • Priorizados por calificación y cercanía
                      </small>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                      {restaurantesCoincidentes.map(r => (
                        <div
                          key={r.id}
                          style={{
                            background: '#ffffff',
                            border: '1.5px solid #e5e7eb',
                            borderRadius: '16px',
                            padding: '14px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '10px'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <h4 style={{ margin: 0, fontSize: '0.98rem', color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                                🏪 {r.name}
                              </h4>
                              <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 800 }}>
                                ⭐ {r.rating.toFixed(1)} ({r.ratingCount}+)
                              </span>
                            </div>
                            <span style={{ color: '#6b7280', fontSize: '0.76rem', display: 'block', marginTop: '2px' }}>
                              {r.category || 'Cocina Gourmet'} • ⏱️ 20-30 min
                            </span>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
                              <span style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700 }}>
                                📍 ~{r.distanciaKm.toFixed(1)} km
                              </span>
                              {r.matchReason && (
                                <span style={{ background: '#fdf2f8', color: 'var(--dark-amaranth)', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800 }}>
                                  ✨ {r.matchReason}
                                </span>
                              )}
                            </div>

                            {/* Vista previa de platos coincidentes en este restaurante */}
                            {r.platosCoincidentes && r.platosCoincidentes.length > 0 && (
                              <div style={{ marginTop: '8px', borderTop: '1px dashed #e5e7eb', paddingTop: '8px' }}>
                                <span style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                                  Platos destacados en su carta:
                                </span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {r.platosCoincidentes.map(cp => (
                                    <div
                                      key={cp.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenModal(cp);
                                      }}
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        background: '#f9fafb',
                                        padding: '4px 8px',
                                        borderRadius: '6px',
                                        fontSize: '0.74rem',
                                        cursor: 'pointer'
                                      }}
                                      title={`Toca para ver ${cp.name}`}
                                    >
                                      <span style={{ fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' }}>
                                        🍽️ {cp.name}
                                      </span>
                                      <span style={{ fontWeight: 800, color: 'var(--dark-amaranth)', flexShrink: 0 }}>
                                        ${parseFloat(cp.price || 0).toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              seleccionarRestaurante(r);
                              setSearchQuery('');
                              showToast(`Menú de "${r.name}" cargado`);
                            }}
                            className="btn-primario"
                            style={{ width: '100%', padding: '8px', fontSize: '0.8rem', fontWeight: 800 }}
                          >
                            Ver Menú Completo →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. SECCIÓN DUAL: PLATOS DISPONIBLES INDEPENDIENTES */}
                {(searchDualTab === 'todo' || searchDualTab === 'platos') && platosIndependientes.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '1.1rem' }}>🍽️</span>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                        Platos Disponibles ({platosIndependientes.length})
                      </h3>
                      <small style={{ color: '#6b7280', fontSize: '0.74rem' }}>
                        • Listado individual de todas las cocinas
                      </small>
                    </div>

                    <div className="product-grid-figma">
                      {platosIndependientes.map(p => {
                        const precioUsd = parseFloat(p.price || 0);
                        const precioBs = toBs(precioUsd, tasaBCV);
                        const imgUrl = getProductImageUrl(p);
                        const nombreLocal = p.businesses?.name || 'Tropicalia';

                        return (
                          <div
                            key={p.id}
                            className="product-card-figma"
                            onClick={() => handleOpenModal(p)}
                            role="button"
                            tabIndex={0}
                            style={{ position: 'relative' }}
                          >
                            <span style={{
                              position: 'absolute',
                              top: '8px',
                              left: '8px',
                              background: 'rgba(0, 0, 0, 0.72)',
                              color: '#ffffff',
                              padding: '2px 6px',
                              borderRadius: '6px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              zIndex: 2,
                              maxWidth: '120px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              🏪 {nombreLocal.replace('Tropicalia ', '')}
                            </span>

                            {/* Botón Favorito ❤️ / 🤍 */}
                            <button
                              type="button"
                              onClick={(e) => handleToggleFavorite(p.id, e)}
                              aria-label={favorites.includes(p.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                              style={{
                                position: 'absolute',
                                top: '8px',
                                right: '8px',
                                width: '30px',
                                height: '30px',
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.94)',
                                border: '1px solid rgba(0, 0, 0, 0.08)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.95rem',
                                cursor: 'pointer',
                                zIndex: 3,
                                boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                                transition: 'transform 0.15s ease'
                              }}
                            >
                              {favorites.includes(p.id) ? '❤️' : '🤍'}
                            </button>

                            <div className="product-card-img-box">
                              <img
                                src={imgUrl}
                                alt={p.name}
                                className="product-card-img"
                                loading="lazy"
                                onError={e => {
                                  e.target.onerror = null;
                                  e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80';
                                }}
                              />
                            </div>
                            <h3 className="product-card-name">{p.name}</h3>
                            {p.matchedReason && (
                              <span style={{ fontSize: '0.68rem', color: '#047857', fontWeight: 700, display: 'block', marginBottom: '2px' }}>
                                ✨ {p.matchedReason}
                              </span>
                            )}
                            <p className="product-card-price">{formatUsd(precioUsd)}</p>
                            <span className="product-card-bs">{formatBs(precioBs)}</span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addItem(
                                  {
                                    id: p.id,
                                    name: p.name,
                                    price: precioUsd,
                                    image_url: p.image_url,
                                    quantity: 1
                                  },
                                  p.business_id,
                                  nombreLocal
                                );
                                showToast(`¡${p.name} agregado al carrito!`);
                              }}
                              className="btn-primario"
                              style={{ width: '100%', padding: '6px', fontSize: '0.76rem', fontWeight: 800, marginTop: '8px' }}
                            >
                              + Agregar
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            )}
          </section>
        ) : loadingMenu ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <p>Cargando menú delicioso de {negocioActivo?.name}...</p>
          </div>
        ) : (
          <div>
            {/* ENCABEZADO DEL MENÚ DE LA COCINA SELECCIONADA */}
            {negocioActivo && (
              <div style={{
                margin: '10px 20px 14px 20px',
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '16px',
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
              }}>
                <div>
                  <span style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', fontWeight: 800 }}>
                    Menú Oficial de Cocina
                  </span>
                  <h3 style={{ margin: '2px 0 0 0', fontSize: '1.1rem', color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                    🍽️ {negocioActivo.name}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 800 }}>
                    ⭐ {parseFloat(negocioActivo.rating || 4.90).toFixed(1)} ({negocioActivo.rating_count || 120} calificaciones)
                  </span>
                  <span style={{ background: '#ecfdf5', color: '#065f46', padding: '3px 8px', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700 }}>
                    📍 Activo
                  </span>
                </div>
              </div>
            )}

            {productosFiltrados.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>No se encontraron platos en esta categoría.</p>
                <button
                  onClick={() => { setCategoriaActiva('Todos'); setSearchQuery(''); }}
                  className="btn-secundario"
                  style={{ marginTop: '10px' }}
                >
                  Ver todos los platos
                </button>
              </div>
            ) : (
              <div className="product-grid-figma">
                {productosFiltrados.map(p => {
                  const precioUsd = parseFloat(p.price || 0);
                  const precioBs = toBs(precioUsd, tasaBCV);
                  const imgUrl = getProductImageUrl(p);

                  return (
                    <div
                      key={p.id}
                      className="product-card-figma"
                      onClick={() => handleOpenModal(p)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver detalle de ${p.name}`}
                      style={{ position: 'relative' }}
                    >
                      {/* Botón Favorito ❤️ / 🤍 */}
                      <button
                        type="button"
                        onClick={(e) => handleToggleFavorite(p.id, e)}
                        aria-label={favorites.includes(p.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '30px',
                          height: '30px',
                          borderRadius: '50%',
                          background: 'rgba(255, 255, 255, 0.94)',
                          border: '1px solid rgba(0, 0, 0, 0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.95rem',
                          cursor: 'pointer',
                          zIndex: 3,
                          boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                          transition: 'transform 0.15s ease'
                        }}
                      >
                        {favorites.includes(p.id) ? '❤️' : '🤍'}
                      </button>

                      <div className="product-card-img-box">
                        <img
                          src={imgUrl}
                          alt={p.name}
                          className="product-card-img"
                          loading="lazy"
                          onError={e => {
                            e.target.onerror = null;
                            e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80';
                          }}
                        />
                      </div>
                      <h3 className="product-card-name">{p.name}</h3>
                      <p className="product-card-price">{formatUsd(precioUsd)}</p>
                      <span className="product-card-bs">{formatBs(precioBs)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL DETALLE DE PLATO (FIGMA 'detalle') */}
      {selectedProduct && (
        <div className="modal-figma-overlay" onClick={handleCloseModal}>
          <div
            className="modal-figma-sheet"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Barra superior de cierre y favorito */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ width: '40px', height: '4px', backgroundColor: '#d1d5db', borderRadius: '999px', margin: '0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={(e) => handleToggleFavorite(selectedProduct.id, e)}
                  aria-label={favorites.includes(selectedProduct.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fee2e2',
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    fontSize: '1.1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.06)'
                  }}
                  title={favorites.includes(selectedProduct.id) ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                >
                  {favorites.includes(selectedProduct.id) ? '❤️' : '🤍'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  style={{
                    background: '#f3f4f6',
                    border: 'none',
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#4b5563'
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Imagen del plato */}
            <img
              src={getProductImageUrl(selectedProduct)}
              alt={selectedProduct.name}
              className="modal-figma-img"
            />

            {/* Datos del plato */}
            <h2 className="modal-figma-title">{selectedProduct.name}</h2>
            <p className="modal-figma-desc">
              {selectedProduct.description || 'Preparado con ingredientes frescos de la más alta calidad y recetas exclusivas de Tropicalia CRB.'}
            </p>
            <div className="modal-figma-price">
              {formatUsd(parseFloat(selectedProduct.price || 0))}
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: '8px' }}>
                ({formatBs(toBs(parseFloat(selectedProduct.price || 0), tasaBCV))})
              </span>
            </div>

            {/* Opiniones del Plato (Figma) */}
            <div>
              <h4 className="opiniones-title">Opiniones del Plato</h4>
              <div className="opiniones-grid">
                <div className="opinion-card">
                  <div className="opinion-card-top">
                    <span style={{ fontWeight: 700, color: '#1f2937' }}>Carlos M.</span>
                    <span>Hace 2d</span>
                  </div>
                  <div className="opinion-stars">★★★★★</div>
                  <div className="opinion-comment">
                    "¡Excelente sabor y porción generosa! 100% recomendado."
                  </div>
                </div>

                <div className="opinion-card">
                  <div className="opinion-card-top">
                    <span style={{ fontWeight: 700, color: '#1f2937' }}>Elena R.</span>
                    <span>Ayer</span>
                  </div>
                  <div className="opinion-stars">★★★★★</div>
                  <div className="opinion-comment">
                    "Llegó caliente, empaque impecable y fresco."
                  </div>
                </div>
              </div>
            </div>

            {/* Barra inferior "Tu Producto" */}
            <div className="tu-producto-bar">
              <div className="counter-pill">
                <button
                  type="button"
                  className="counter-btn"
                  onClick={() => setModalQty(q => Math.max(1, q - 1))}
                  aria-label="Restar uno"
                >
                  −
                </button>
                <span style={{ minWidth: '18px', textAlign: 'center' }}>{modalQty}</span>
                <button
                  type="button"
                  className="counter-btn"
                  onClick={() => setModalQty(q => q + 1)}
                  aria-label="Sumar uno"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                className="btn-agregar-figma"
                onClick={handleConfirmarAgregar}
              >
                Agregar • {formatUsd(parseFloat(selectedProduct.price || 0) * modalQty)}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL CAMBIAR DIRECCIÓN */}
      {showAddressModal && (
        <div className="modal-figma-overlay" onClick={() => setShowAddressModal(false)}>
          <div
            className="modal-figma-sheet"
            onClick={e => e.stopPropagation()}
            style={{ paddingBottom: '30px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, color: 'var(--dark-amaranth)' }}>📍 Dirección de Entrega</h3>
              <button
                onClick={() => setShowAddressModal(false)}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={guardarDireccion}>
              <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 12px 0' }}>
                Ingresa tu dirección o punto de referencia para calcular tu delivery con precisión:
              </p>
              <input
                type="text"
                className="form-input-figma"
                value={tempDireccion}
                onChange={e => setTempDireccion(e.target.value)}
                placeholder="Ej. Calle 5, Res. Las Aves, Apto 4B"
                required
                autoFocus
              />
              <button type="submit" className="btn-primario" style={{ width: '100%', marginTop: '6px' }}>
                Guardar Dirección
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
