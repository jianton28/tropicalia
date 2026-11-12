import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles } from 'lucide-react';
import { semanticSearchService } from '../../services/semanticSearchService';

/**
 * Barra de Búsqueda Global Inteligente (Tropicalia CRB)
 * Maneja debounce para tipeo fluido, chips de sugerencias rápidas,
 * reconocimiento de sinónimos/traducciones y feedback visual semántico.
 */
export default function GlobalSearchBar({
  searchQuery,
  onSearchChange,
  placeholder = 'Buscar hamburguesas, pizzas, sushi, postres...',
  interpretacion = null
}) {
  const [localInput, setLocalInput] = useState(searchQuery || '');
  const [isFocused, setIsFocused] = useState(false);
  const debounceTimerRef = useRef(null);

  // Sincronizar con el estado del padre si cambia externamente (ej: botón limpiar)
  useEffect(() => {
    setLocalInput(searchQuery || '');
  }, [searchQuery]);

  // Manejador con debounce de 220ms para rendimiento óptimo
  function handleInputChange(e) {
    const val = e.target.value;
    setLocalInput(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onSearchChange(val);
    }, 220);
  }

  function handleClear() {
    setLocalInput('');
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    onSearchChange('');
  }

  function handleSuggestionClick(term) {
    setLocalInput(term);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    onSearchChange(term);
  }

  const sugerencias = semanticSearchService.obtenerSugerenciasRapidas();

  return (
    <div style={{ position: 'relative', width: '100%', padding: '0 20px', marginTop: '6px', marginBottom: '10px', boxSizing: 'border-box' }}>
      
      {/* INPUT PRINCIPAL (MANUAL DE MARCA TROPICALIA) */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span
          style={{
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--dark-amaranth)',
            pointerEvents: 'none',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7.5" />
            <line x1="20" y1="20" x2="16.2" y2="16.2" />
          </svg>
        </span>

        <input
          id="global-search-input"
          type="text"
          value={localInput}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder={placeholder}
          className="figma-search-input"
          style={{
            width: '100%',
            paddingLeft: '40px',
            paddingRight: localInput ? '42px' : '16px',
            boxSizing: 'border-box'
          }}
          aria-label="Buscar restaurantes y platos"
        />

        {localInput && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              position: 'absolute',
              right: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(130, 19, 58, 0.14)',
              border: 'none',
              borderRadius: '50%',
              width: '24px',
              height: '24px',
              color: 'var(--dark-amaranth)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.82rem',
              fontWeight: 800,
              zIndex: 3,
              transition: 'background 0.15s ease'
            }}
            title="Borrar búsqueda"
            aria-label="Borrar búsqueda"
          >
            <X size={14} color="var(--dark-amaranth)" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* CHIPS DE SUGERENCIAS RÁPIDAS (MANUAL DE MARCA: CRIMSON VIOLET / GOLDEN ORANGE) */}
      {!localInput && (
        <div
          style={{
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            paddingTop: '8px',
            paddingBottom: '2px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          <span style={{ fontSize: '0.72rem', color: 'var(--dark-amaranth)', alignSelf: 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Populares:
          </span>
          {sugerencias.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSuggestionClick(s.query)}
              style={{
                background: '#f3eef0',
                border: '1px solid rgba(130, 19, 58, 0.25)',
                borderRadius: '999px',
                color: 'var(--dark-amaranth)',
                padding: '3px 10px',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* BANNER DE RETROALIMENTACIÓN SEMÁNTICA / IA */}
      {localInput && interpretacion && interpretacion.conceptosDetectados?.length > 0 && (
        <div
          style={{
            marginTop: '8px',
            background: '#fffbeb',
            border: '1px solid rgba(239, 157, 36, 0.55)',
            borderRadius: '10px',
            padding: '6px 10px',
            fontSize: '0.74rem',
            color: 'var(--dark-amaranth)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={14} color="var(--golden-orange)" />
            <span>
              <strong>Búsqueda Semántica:</strong> "{localInput}" interpretado como{' '}
              <span style={{ color: 'var(--crimson-violet)', textDecoration: 'underline', fontWeight: 700 }}>
                {interpretacion.conceptosDetectados.join(' y ')}
              </span>
            </span>
          </div>
          <span style={{ fontSize: '0.68rem', color: '#92400e', background: '#fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
            Sinónimos & IA
          </span>
        </div>
      )}

    </div>
  );
}

