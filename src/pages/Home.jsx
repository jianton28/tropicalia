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

export default function Home({ onTriggerSearch, searchOpen }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { cart, totalCount, subtotalUsd, addItem } = useCart();

  const [tasaBCV, setTasaBCV] = useState(875.65);
  const [negocios, setNegocios] = useState([]);
  const [negocioActivo, setNegocioActivo] = useState(null);
  const [productos, setProductos] = useState([]);
  const [loadingLocales, setLoadingLocales] = useState(true);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [localSearchOpen, setLocalSearchOpen] = useState(false);

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
  }

  async function seleccionarRestaurante(negocio) {
    if (!negocio) return;
    setNegocioActivo(negocio);
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

        {/* Buscador Integrado */}
        {(localSearchOpen || searchOpen) && (
          <div style={{ position: 'relative', marginTop: '4px', marginBottom: '10px' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.7 }}>🔍</span>
            <input
              type="text"
              className="figma-search-input"
              placeholder="Buscar hamburguesas, pizzas, postres..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                ✕
              </button>
            )}
          </div>
        )}

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

      {/* GRILLA DE PLATOS FIGMA (2 COLUMNAS) */}
      <main>
        {loadingMenu ? (
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
