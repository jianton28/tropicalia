import React, { useState, useEffect, useRef } from 'react';
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
    <div style={{ position: 'relative', width: '100%', marginTop: '6px', marginBottom: '12px' }}>
      
      {/* INPUT PRINCIPAL */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span
          style={{
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '1.05rem',
            opacity: 0.8,
            pointerEvents: 'none',
            zIndex: 2
          }}
        >
          🔍
        </span>

        <input
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
            boxSizing: 'border-box',
            boxShadow: isFocused ? '0 0 0 2px rgba(235, 178, 66, 0.45)' : 'none',
            transition: 'all 0.2s ease'
          }}
          aria-label="Buscar restaurantes y platos"
        />

        {localInput && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(255, 255, 255, 0.25)',
              border: 'none',
              borderRadius: '50%',
              width: '24px',
              height: '24px',
              color: '#ffffff',
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
            ✕
          </button>
        )}
      </div>

      {/* CHIPS DE SUGERENCIAS RÁPIDAS (VISIBLES CUANDO NO HAY BÚSQUEDA ACTIVA) */}
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
          <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.75)', alignSelf: 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Populares:
          </span>
          {sugerencias.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSuggestionClick(s.query)}
              style={{
                background: 'rgba(255, 255, 255, 0.16)',
                border: '1px solid rgba(255, 255, 255, 0.24)',
                borderRadius: '999px',
                color: '#ffffff',
                padding: '3px 10px',
                fontSize: '0.72rem',
                fontWeight: 600,
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
            background: 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            borderRadius: '10px',
            padding: '5px 10px',
            fontSize: '0.74rem',
            color: '#fef3c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>💡</span>
            <span>
              <strong>Búsqueda Semántica:</strong> "{localInput}" interpretado como{' '}
              <span style={{ color: '#ffffff', textDecoration: 'underline' }}>
                {interpretacion.conceptosDetectados.join(' y ')}
              </span>
            </span>
          </div>
          <span style={{ fontSize: '0.68rem', opacity: 0.85, background: 'rgba(0,0,0,0.2)', padding: '1px 6px', borderRadius: '4px' }}>
            Sinónimos & IA activos
          </span>
        </div>
      )}

    </div>
  );
}

