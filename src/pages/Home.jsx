import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { fetchTasaBCV, toBs, formatUsd, formatBs } from '../services/bcvService';
import { getProductImageUrl } from '../services/imageService';

const CATEGORIAS_FIGMA = [
  'Todos',
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
  // 1. BUSCADOR GLOBAL DE PLATOS Y ALGORITMO DE PRIORIZACIÓN DE COCINAS
  // ==============================================================================
  const cocinasGlobalesPriorizadas = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();

    // 1. Buscar platos que coincidan con la búsqueda en todo el catálogo
    const platosCoincidentes = todosLosProductos.filter(p => {
      const n = (p.name || '').toLowerCase();
      const d = (p.description || '').toLowerCase();
      const c = (p.category || '').toLowerCase();
      return n.includes(query) || d.includes(query) || c.includes(query);
    });

    if (platosCoincidentes.length === 0) return [];

    // 2. Agrupar por dark kitchen / restaurante
    const mapaCocinas = new Map();
    platosCoincidentes.forEach(prod => {
      const bz = prod.businesses;
      if (!bz || bz.is_active === false) return;

      if (!mapaCocinas.has(bz.id)) {
        const latBz = parseFloat(bz.lat || 10.4880);
        const lngBz = parseFloat(bz.lng || -66.8650);
        const distKm = calcularDistanciaKm(userCoords.lat, userCoords.lng, latBz, lngBz);
        const rating = parseFloat(bz.rating || 4.90);
        const ratingCount = parseInt(bz.rating_count || 120, 10);

        mapaCocinas.set(bz.id, {
          business: bz,
          distanciaKm: distKm,
          rating: rating,
          ratingCount: ratingCount,
          productos: []
        });
      }
      mapaCocinas.get(bz.id).productos.push(prod);
    });

    const lista = Array.from(mapaCocinas.values());

    // 3. ALGORITMO DE ORDENAMIENTO Y PRIORIZACIÓN:
    // Criterio 1: Calificación del restaurante (estrellas)
    // Criterio 2: Cercanía geográfica respecto al cliente (distancia en km)
    lista.sort((a, b) => {
      // Si la diferencia de calificación es notable (>= 0.2 estrellas), prioriza el de mayor rating
      const difRating = b.rating - a.rating;
      if (Math.abs(difRating) >= 0.20) {
        return difRating;
      }

      // Si tienen calificación similar o empate técnico, prioriza la cocina más cercana
      const difDistancia = a.distanciaKm - b.distanciaKm;
      if (Math.abs(difDistancia) >= 0.3) {
        return difDistancia;
      }

      // Ponderación compuesta final
      const scoreA = (a.rating * 25) - (a.distanciaKm * 3);
      const scoreB = (b.rating * 25) - (b.distanciaKm * 3);
      return scoreB - scoreA;
    });

    return lista;
  }, [searchQuery, todosLosProductos, userCoords]);

  // Filtrado por categoría y búsqueda
  const productosFiltrados = useMemo(() => {
    return productos.filter(p => {
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

      if (categoriaActiva === 'Platos Salados') {
        const esDulce = name.includes('choc') || name.includes('mousse') || name.includes('tiramis') || name.includes('dulce') || name.includes('vainilla');
        return !esDulce && !name.includes('bebida') && !name.includes('jugo');
      }

      if (categoriaActiva === 'Platos Dulces') {
        return name.includes('choc') || name.includes('mousse') || name.includes('tiramis') || name.includes('dulce') || name.includes('fresa') || name.includes('vainilla');
      }

      if (categoriaActiva === 'Hamburguesas') {
        return name.includes('hamburguesa') || name.includes('burger') || name.includes('papa');
      }

      if (categoriaActiva === 'Pizzas') {
        return name.includes('pizza') || name.includes('margarita') || name.includes('pepperoni');
      }

      if (categoriaActiva === 'Sushi') {
        return name.includes('sushi') || name.includes('roll');
      }

      if (categoriaActiva === 'Bebidas') {
        return name.includes('bebida') || name.includes('jugo') || name.includes('refresco') || name.includes('café');
      }

      return true;
    });
  }, [productos, categoriaActiva, searchQuery]);

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

        {/* Buscador Global Integrado */}
        <div style={{ position: 'relative', marginTop: '6px', marginBottom: '10px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.7, fontSize: '0.95rem' }}>🔍</span>
          <input
            type="text"
            className="figma-search-input"
            placeholder="Buscar hamburguesas, pizzas, sushi en todas las cocinas..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.95rem' }}
              title="Borrar búsqueda"
            >
              ✕
            </button>
          )}
        </div>

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

      {/* SELECTOR DE LOCALES TROPICALIA (CHIPS COMPACTOS) */}
      {negocios.length > 1 && (
        <div style={{ padding: '12px 20px 4px 20px', display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {negocios.map(n => {
            const isSelected = negocioActivo?.id === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => seleccionarRestaurante(n)}
                style={{
                  background: isSelected ? 'var(--dark-amaranth)' : '#f3f4f6',
                  color: isSelected ? '#ffffff' : '#4b5563',
                  border: isSelected ? '1px solid var(--dark-amaranth)' : '1px solid #e5e7eb',
                  borderRadius: '999px',
                  padding: '5px 12px',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                🏪 {n.name.replace('Tropicalia ', '')}
              </button>
            );
          })}
        </div>
      )}

      {/* BANNER DE PEDIDO EN CURSO */}
      {ultimaOrdenId && (
        <div style={{ margin: '12px 20px 0 20px' }}>
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

      {/* CONTENIDO PRINCIPAL: BUSCADOR GLOBAL PRIORIZADO O MENÚ DE LOCAL */}
      <main>
        {searchQuery.trim() ? (
          <section style={{ padding: '0 20px', marginTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                  🍽️ Cocinas que preparan "{searchQuery}"
                </h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                  Priorizadas por mayor calificación ⭐ y cercanía geográfica 📍
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

            {cocinasGlobalesPriorizadas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', background: '#f9fafb', borderRadius: '18px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🔍</div>
                <strong style={{ color: '#374151', fontSize: '1rem' }}>No encontramos cocinas con platos para "{searchQuery}"</strong>
                <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: '4px 0 14px 0' }}>
                  Prueba buscando: hamburguesa, pizza, sushi, postres, pollo o ensalada.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="btn-primario"
                  style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                >
                  Ver Catálogo Completo
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {cocinasGlobalesPriorizadas.map(({ business, distanciaKm, rating, ratingCount, productos: prodsCocina }) => (
                  <div
                    key={business.id}
                    style={{
                      background: '#ffffff',
                      border: '1.5px solid #e5e7eb',
                      borderRadius: '20px',
                      padding: '16px',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.05)',
                      position: 'relative'
                    }}
                  >
                    {/* Header de la Cocina / Dark Kitchen */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #f3f4f6', paddingBottom: '10px', marginBottom: '12px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--dark-amaranth)', fontWeight: 800 }}>
                          🏪 {business.name}
                        </h3>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                          <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            ⭐ {rating.toFixed(1)} ({ratingCount}+)
                          </span>
                          <span style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            📍 ~{distanciaKm.toFixed(1)} km de ti
                          </span>
                          <span style={{ color: '#6b7280', fontSize: '0.74rem' }}>
                            ⏱️ 20-30 min
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          seleccionarRestaurante(business);
                          setSearchQuery('');
                          showToast(`Cocina "${business.name}" seleccionada`);
                        }}
                        className="btn-secundario"
                        style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', fontWeight: 700 }}
                      >
                        Ver Menú Completo →
                      </button>
                    </div>

                    {/* Platos que coinciden en esta cocina */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: '12px' }}>
                      {prodsCocina.map(p => {
                        const precioUsd = parseFloat(p.price || 0);
                        const precioBs = toBs(precioUsd, tasaBCV);
                        const imgUrl = getProductImageUrl(p);

                        return (
                          <div
                            key={p.id}
                            className="product-card-figma"
                            style={{ margin: 0, padding: '10px' }}
                            onClick={() => handleOpenModal(p)}
                          >
                            <div className="product-card-img-box" style={{ height: '110px' }}>
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
                            <h4 className="product-card-name" style={{ fontSize: '0.85rem' }}>{p.name}</h4>
                            <p className="product-card-price" style={{ fontSize: '0.9rem' }}>{formatUsd(precioUsd)}</p>
                            <span className="product-card-bs" style={{ fontSize: '0.72rem' }}>{formatBs(precioBs)}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addItem(p, 1, business.id, business.name);
                                showToast(`¡${p.name} agregado al carrito!`);
                              }}
                              className="btn-primario"
                              style={{ marginTop: '8px', width: '100%', padding: '6px', fontSize: '0.75rem', fontWeight: 800 }}
                            >
                              + Agregar
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : loadingMenu ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <p>Cargando menú delicioso de {negocioActivo?.name}...</p>
          </div>
        ) : productosFiltrados.length === 0 ? (
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
                >
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
            {/* Barra superior de cierre */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ width: '40px', height: '4px', backgroundColor: '#d1d5db', borderRadius: '999px', margin: '0 auto 0 0' }} />
              <button
                type="button"
                onClick={handleCloseModal}
                style={{
                  background: '#f3f4f6',
                  border: 'none',
                  width: '32px',
                  height: '32px',
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
