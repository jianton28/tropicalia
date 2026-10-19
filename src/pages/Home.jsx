import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useCart } from '../context/CartContext';
import { fetchTasaBCV, toBs, formatUsd, formatBs } from '../services/bcvService';

export default function Home() {
  const navigate = useNavigate();
  const { cart, totalCount, subtotalUsd, addItem } = useCart();

  const [tasaBCV, setTasaBCV] = useState(875.65);
  const [negocios, setNegocios] = useState([]);
  const [negocioActivo, setNegocioActivo] = useState(null);
  const [productos, setProductos] = useState([]);
  const [loadingLocales, setLoadingLocales] = useState(true);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [ultimaOrdenId, setUltimaOrdenId] = useState(null);

  useEffect(() => {
    // 1. Obtener tasa BCV
    fetchTasaBCV().then(r => setTasaBCV(r));

    // 2. Verificar orden activa reciente
    const lastId = localStorage.getItem('tropicalia_last_order_id');
    if (lastId) {
      setUltimaOrdenId(lastId);
    }

    // 3. Cargar restaurantes
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

  function handleAgregarPlato(p) {
    const precio = parseFloat(p.price || 0);
    addItem(
      {
        id: p.id,
        name: p.name,
        price: precio,
        image_url: p.image_url,
      },
      negocioActivo.id,
      negocioActivo.name
    );
  }

  return (
    <div className="container" style={{ marginTop: '24px', marginBottom: '100px' }}>
      
      {/* BANNER DE PEDIDO EN CURSO */}
      {ultimaOrdenId && (
        <div className="card" style={{
          borderColor: '#10b981',
          background: '#13221c',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ color: '#34d399' }}>🛵 Tienes un pedido en curso</strong>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: '#a7f3d0' }}>
                Haz clic para ver el mapa en vivo y tu código de entrega seguro.
              </p>
            </div>
            <Link
              to={`/tracking?order_id=${ultimaOrdenId}`}
              className="btn-primario"
              style={{ background: '#10b981' }}
            >
              Ver Seguimiento
            </Link>
          </div>
        </div>
      )}

      {/* SELECTOR DE RESTAURANTES */}
      <section>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '12px' }}>🏪 Elige un Restaurante</h2>
        {loadingLocales ? (
          <p style={{ color: 'var(--text-muted)' }}>Cargando locales disponibles...</p>
        ) : negocios.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No hay restaurantes abiertos en este momento.</p>
        ) : (
          <div className="grid-cards">
            {negocios.map(n => {
              const esActivo = negocioActivo?.id === n.id;
              return (
                <div
                  key={n.id}
                  className="card"
                  onClick={() => seleccionarRestaurante(n)}
                  style={{
                    cursor: 'pointer',
                    borderColor: esActivo ? 'var(--gold)' : 'var(--border-color)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '1.05rem', color: esActivo ? 'var(--gold)' : '#fff' }}>
                      {n.name}
                    </strong>
                    <span className="badge badge-on_the_way">Abierto</span>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
                    {n.category || 'Gastronomía'} • Delivery y Pickup
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* MENÚ DEL RESTAURANTE SELECCIONADO */}
      {negocioActivo && (
        <section style={{ marginTop: '32px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '10px',
            marginBottom: '16px'
          }}>
            <div>
              <h2 style={{ fontSize: '1.4rem', color: 'var(--gold)', margin: 0 }}>
                Menú de {negocioActivo.name}
              </h2>
              <small style={{ color: 'var(--text-muted)' }}>
                Selecciona tus platos y agrégalos a tu carrito
              </small>
            </div>
          </div>

          {loadingMenu ? (
            <p style={{ color: 'var(--text-muted)' }}>Cargando platos...</p>
          ) : productos.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Este local aún no tiene platos disponibles hoy.</p>
          ) : (
            <div className="grid-cards">
              {productos.map(p => {
                const precioUsd = parseFloat(p.price || 0);
                const precioBs = toBs(precioUsd, tasaBCV);
                const stock = p.stock !== null && p.stock !== undefined ? parseInt(p.stock) : 99;
                const agotado = stock <= 0;

                return (
                  <div
                    key={p.id}
                    className="card"
                    style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <strong style={{ fontSize: '1rem' }}>{p.name}</strong>
                        <span style={{ color: 'var(--gold)', fontWeight: 800 }}>
                          {formatUsd(precioUsd)}
                        </span>
                      </div>
                      <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                        {formatBs(precioBs)}
                      </small>
                      <p style={{ fontSize: '0.82rem', color: '#aaa', margin: '8px 0' }}>
                        {p.description || 'Preparado al momento con ingredientes frescos.'}
                      </p>
                    </div>

                    <button
                      className="btn-primario"
                      style={{ width: '100%', marginTop: '10px' }}
                      onClick={() => handleAgregarPlato(p)}
                      disabled={agotado}
                    >
                      {agotado ? 'Agotado' : '+ Agregar al pedido'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* BARRA FLOTANTE DE CARRITO */}
      {totalCount > 0 && (
        <div
          className="floating-cart-bar"
          onClick={() => navigate('/checkout')}
        >
          <div>
            <span>{totalCount} {totalCount === 1 ? 'plato' : 'platos'}</span>
            {' • '}
            <span>{formatUsd(subtotalUsd)}</span>
            <small style={{ display: 'block', fontWeight: 500, fontSize: '0.75rem', opacity: 0.85 }}>
              Equivalente: {formatBs(toBs(subtotalUsd, tasaBCV))}
            </small>
          </div>
          <span>Ir a Pagar →</span>
        </div>
      )}

    </div>
  );
}

