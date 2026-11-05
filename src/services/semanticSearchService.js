import { supabase } from '../lib/supabase.js';

// ==============================================================================
// MATRIZ SEMÁNTICA Y DICCIONARIO DE SINÓNIMOS CULINARIOS (BILINGÜE ES/EN + ARCOT)
// ==============================================================================
const DICCIONARIO_SEMANTICO = {
  hamburguesas: {
    categoriaPrincipal: 'Hamburguesas',
    terminos: [
      'burger', 'burgers', 'hamburguesa', 'hamburguesas', 'hamburgesa', 'hamburgesas',
      'cheeseburger', 'doble carne', 'smash', 'smash burger', 'angus', 'bacon burger',
      'torta de carne', 'cuarto de libra', 'pan de papa', 'brioche'
    ],
    etiquetaVisual: '🍔 Hamburguesas'
  },
  pizzas: {
    categoriaPrincipal: 'Pizzas',
    terminos: [
      'pizza', 'pizzas', 'pizzeria', 'pizzería', 'pizzas artesanales', 'margarita',
      'pepperoni', 'peperoni', 'calzone', 'focaccia', 'napolitana', 'cuatro quesos',
      '4 quesos', 'champiñones', 'jamon y queso', 'masa madre'
    ],
    etiquetaVisual: '🍕 Pizzas'
  },
  sushi_asiatica: {
    categoriaPrincipal: 'Sushi',
    terminos: [
      'sushi', 'roll', 'rolls', 'makis', 'maki', 'sashimi', 'nigiri', 'tempura',
      'asiatica', 'asiático', 'asiatico', 'japonés', 'japones', 'oriental',
      'salmon', 'salmón', 'atun', 'atún', 'edamame', 'ramen', 'gyoza', 'wok',
      'arroz chino', 'yakimeshi', 'dinamita', 'dragón roll', 'dragon roll'
    ],
    etiquetaVisual: '🍣 Sushi y Asiática'
  },
  hotdogs: {
    categoriaPrincipal: 'Comida Rápida',
    terminos: [
      'hot dog', 'hotdog', 'hotdogs', 'hot dogs', 'perro caliente', 'perros calientes',
      'perro', 'perros', 'salchicha', 'salchichas', 'con todo', 'perro con queso',
      'chistorra', 'salchipapa', 'salchipapas'
    ],
    etiquetaVisual: '🌭 Perros Calientes'
  },
  postres_dulces: {
    categoriaPrincipal: 'Platos Dulces',
    terminos: [
      'postre', 'postres', 'dessert', 'desserts', 'dulce', 'dulces', 'torta', 'tortas',
      'cake', 'cakes', 'tiramisu', 'tiramisú', 'mousse', 'chocolate', 'choco',
      'helado', 'helados', 'ice cream', 'marquesa', 'pie', 'pay', 'cheesecake',
      'galleta', 'galletas', 'cookie', 'cookies', 'brownie', 'brownies', 'alfajor',
      'tres leches', 'quesillo', 'fresa', 'vainilla', 'nutella', 'dulce de leche', 'arequipe'
    ],
    etiquetaVisual: '🍰 Postres y Dulces'
  },
  bebidas: {
    categoriaPrincipal: 'Bebidas',
    terminos: [
      'bebida', 'bebidas', 'drink', 'drinks', 'refresco', 'refrescos', 'soda', 'sodas',
      'gaseosa', 'gaseosas', 'coca cola', 'cocacola', 'coke', 'pepsi', 'chinotto',
      'colita', 'jugo', 'jugos', 'juice', 'batido', 'smoothie', 'malta', 'maltin',
      'agua', 'water', 'cerveza', 'cervezas', 'beer', 'polar', 'solera', 'te', 'té',
      'iced tea', 'nestea', 'limonada', 'papelon con limon', 'papelón'
    ],
    etiquetaVisual: '🥤 Bebidas y Refrescos'
  },
  cafe: {
    categoriaPrincipal: 'Bebidas',
    terminos: [
      'cafe', 'café', 'coffee', 'espresso', 'expreso', 'capuchino', 'cappuccino',
      'latte', 'marron', 'marrón', 'guayoyo', 'mokaccino', 'moca', 'americano'
    ],
    etiquetaVisual: '☕ Café'
  },
  pollo_wings: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'pollo', 'chicken', 'alitas', 'alita', 'wings', 'buffalo', 'bbq wings',
      'nuggets', 'tenders', 'crispy', 'crujiente', 'broaster', 'pechuga',
      'pollo frito', 'pollo a la canasta', 'strips'
    ],
    etiquetaVisual: '🍗 Pollo y Alitas'
  },
  carnes_parrilla: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'carne', 'meat', 'beef', 'parrilla', 'parrillada', 'asado', 'bbq',
      'churrasco', 'steak', 'lomito', 'solomo', 'punta trasera', 'costillas',
      'ribs', 'picanha', 'chorizo', 'morcilla', 'chinchurria', 'carne mechada'
    ],
    etiquetaVisual: '🥩 Carnes y Parrilla'
  },
  pastas_italiana: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'pasta', 'pastas', 'spaghetti', 'espagueti', 'tallarines', 'fettuccine',
      'penne', 'lasaña', 'lasagna', 'raviolis', 'ravioli', 'bolognesa',
      'carbonara', 'alfredo', 'pomodoro', 'pesto', 'canelones'
    ],
    etiquetaVisual: '🍝 Pastas'
  },
  comida_venezolana: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'arepa', 'arepas', 'reina pepiada', 'pelua', 'pelúa', 'sifrina', 'catira',
      'empanada', 'empanadas', 'pastelito', 'pastelitos', 'mandoca', 'cachapa',
      'cachapas', 'tequeño', 'tequeños', 'tequeno', 'tequenos', 'queso de mano',
      'pabellon', 'pabellón', 'hallaquita', 'tajadas'
    ],
    etiquetaVisual: '🫓 Tradicional Venezolana'
  },
  snacks_pasapalos: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'pasapalo', 'pasapalos', 'snack', 'snacks', 'papas', 'fries', 'french fries',
      'papas fritas', 'papas francesas', 'aros de cebolla', 'onion rings',
      'tostones', 'patacones', 'nachos', 'deditos de queso'
    ],
    etiquetaVisual: '🍟 Snacks y Pasapalos'
  },
  mexicana: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'taco', 'tacos', 'burrito', 'burritos', 'quesadilla', 'quesadillas',
      'nachos', 'fajita', 'fajitas', 'guacamole', 'jalapeno', 'jalapeño',
      'pico de gallo', 'totopos'
    ],
    etiquetaVisual: '🌮 Comida Mexicana'
  },
  saludable_ensaladas: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'saludable', 'healthy', 'ensalada', 'ensaladas', 'salad', 'verde', 'cesar',
      'caesar', 'vegetariano', 'vegano', 'vegan', 'light', 'fitness', 'bowl',
      'poke', 'quinoa', 'sin gluten', 'gluten free'
    ],
    etiquetaVisual: '🥗 Saludable y Ensaladas'
  },
  mariscos_pescado: {
    categoriaPrincipal: 'Platos Salados',
    terminos: [
      'pescado', 'fish', 'marisco', 'mariscos', 'seafood', 'camaron', 'camarones',
      'shrimp', 'ceviche', 'cebiche', 'calamar', 'calamares', 'pulpo', 'filet',
      'pargo', 'corvina'
    ],
    etiquetaVisual: '🦐 Mariscos y Pescados'
  }
};

// ==============================================================================
// FUNCIONES AUXILIARES DE NORMALIZACIÓN Y DISTANCIA LEVENSHTEIN (FUZZY MATCHING)
// ==============================================================================

/**
 * Normaliza una cadena eliminando acentos, tildes, signos y dobles espacios.
 */
export function normalizarTexto(texto) {
  if (!texto) return '';
  return texto
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remueve diacríticos
    .replace(/[^a-z0-9\s]/g, ' ')   // Convierte signos a espacios
    .replace(/\s+/g, ' ')           // Colapsa múltiples espacios
    .trim();
}

/**
 * Distancia de Levenshtein para tolerancia a errores ortográficos.
 */
function calcularLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const matriz = [];
  for (let i = 0; i <= m; i++) {
    matriz[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    matriz[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,       // Eliminación
        matriz[i][j - 1] + 1,       // Inserción
        matriz[i - 1][j - 1] + costo // Sustitución
      );
    }
  }

  return matriz[m][n];
}

/**
 * Verifica si dos palabras son similares por fuzzy matching (máx 1 o 2 diferencias).
 */
function esFuzzyMatch(palabraUsuario, palabraObjetivo) {
  if (palabraUsuario.length <= 3) {
    return palabraUsuario === palabraObjetivo;
  }
  const maxDiff = palabraUsuario.length >= 7 ? 2 : 1;
  const dist = calcularLevenshtein(palabraUsuario, palabraObjetivo);
  return dist <= maxDiff;
}

// ==============================================================================
// CACHÉ EN MEMORIA PARA RESPUESTA INSTANTÁNEA (< 1MS)
// ==============================================================================
const searchMemoryCache = new Map();
const MAX_CACHE_SIZE = 100;

function obtenerDeCache(key) {
  return searchMemoryCache.get(key) || null;
}

function guardarEnCache(key, valor) {
  if (searchMemoryCache.size >= MAX_CACHE_SIZE) {
    const primerKey = searchMemoryCache.keys().next().value;
    searchMemoryCache.delete(primerKey);
  }
  searchMemoryCache.set(key, valor);
}

// ==============================================================================
// MOTOR DE BÚSQUEDA SEMÁNTICA GLOBAL
// ==============================================================================

export const semanticSearchService = {
  /**
   * Sugerencias de conceptos rápidos para el usuario.
   */
  obtenerSugerenciasRapidas() {
    return [
      { id: 'burger', label: '🍔 Burgers', query: 'burger' },
      { id: 'pizza', label: '🍕 Pizzas', query: 'pizza' },
      { id: 'sushi', label: '🍣 Sushi', query: 'sushi' },
      { id: 'alitas', label: '🍗 Alitas', query: 'alitas' },
      { id: 'tequenos', label: '🧀 Tequeños', query: 'tequeños' },
      { id: 'postre', label: '🍰 Postres', query: 'postre' },
      { id: 'bebidas', label: '🥤 Bebidas', query: 'bebida' }
    ];
  },

  /**
   * Expansión de sinónimos y conceptos asociados a la consulta.
   */
  expandirTerminos(query) {
    const rawNormalizado = normalizarTexto(query);
    if (!rawNormalizado) {
      return {
        queryOriginal: '',
        tokens: [],
        sinonimos: [],
        conceptosDetectados: [],
        interpretacionTexto: ''
      };
    }

    const tokens = rawNormalizado.split(' ').filter(t => t.length > 1);
    const sinonimosSet = new Set([rawNormalizado, ...tokens]);
    const conceptosDetectados = [];

    // Búsqueda en el diccionario semántico
    for (const [clave, concepto] of Object.entries(DICCIONARIO_SEMANTICO)) {
      let coincide = false;

      // 1. Coincidencia directa o de subcadena
      for (const t of concepto.terminos) {
        const normT = normalizarTexto(t);
        if (normT === rawNormalizado || rawNormalizado.includes(normT) || normT.includes(rawNormalizado)) {
          coincide = true;
          break;
        }

        // 2. Coincidencia por token o fuzzy match
        for (const token of tokens) {
          if (normT.includes(token) || esFuzzyMatch(token, normT)) {
            coincide = true;
            break;
          }
        }
        if (coincide) break;
      }

      if (coincide) {
        conceptosDetectados.push(concepto.etiquetaVisual);
        // Expandir todos los términos del concepto como sinónimos
        concepto.terminos.forEach(term => {
          sinonimosSet.add(normalizarTexto(term));
        });
      }
    }

    const sinonimosArr = Array.from(sinonimosSet);
    const interpretacionTexto = conceptosDetectados.length > 0
      ? `Conceptos identificados: ${conceptosDetectados.join(', ')}`
      : '';

    return {
      queryOriginal: query,
      tokens,
      sinonimos: sinonimosArr,
      conceptosDetectados,
      interpretacionTexto
    };
  },

  /**
   * Ejecuta la búsqueda cruzada inteligente en el catálogo local en memoria.
   * Relaciona platos individuales con las cocinas que los preparan y calcula relevancia.
   */
  buscarCatalogoLocal({
    query,
    productos,
    restaurantes,
    userCoords = { lat: 10.4950, lng: -66.8480 }
  }) {
    if (!query || !query.trim()) {
      return {
        restaurantesCoincidentes: [],
        platosIndependientes: [],
        interpretacion: null,
        totalEncontrados: 0
      };
    }

    const cacheKey = `${normalizarTexto(query)}_${userCoords.lat.toFixed(3)}_${userCoords.lng.toFixed(3)}_${productos?.length || 0}`;
    const cached = obtenerDeCache(cacheKey);
    if (cached) {
      return cached;
    }

    const { tokens, sinonimos, conceptosDetectados, interpretacionTexto } = this.expandirTerminos(query);
    const queryNorm = normalizarTexto(query);

    // --------------------------------------------------------------------------
    // 1. PUNTUACIÓN Y FILTRADO DE PLATOS INDIVIDUALES
    // --------------------------------------------------------------------------
    const platosConScore = [];

    (productos || []).forEach(p => {
      const nombreNorm = normalizarTexto(p.name);
      const descNorm = normalizarTexto(p.description || '');
      const catNorm = normalizarTexto(p.category || '');
      let score = 0;
      let matchedReason = '';

      // A. Coincidencia exacta con la consulta
      if (nombreNorm === queryNorm) {
        score += 120;
        matchedReason = 'Coincidencia exacta';
      } else if (nombreNorm.startsWith(queryNorm)) {
        score += 90;
        matchedReason = 'Comienza con la búsqueda';
      } else if (nombreNorm.includes(queryNorm)) {
        score += 75;
        matchedReason = 'Nombre contiene el término';
      }

      // B. Coincidencia con sinónimos y conceptos semánticos
      for (const syn of sinonimos) {
        if (!syn) continue;
        if (nombreNorm.includes(syn)) {
          score += 65;
          matchedReason = matchedReason || `Relacionado semánticamente (${syn})`;
          break;
        }
      }

      // C. Coincidencia en categoría
      for (const syn of sinonimos) {
        if (catNorm.includes(syn)) {
          score += 45;
          matchedReason = matchedReason || `Categoría afín (${p.category})`;
          break;
        }
      }

      // D. Coincidencia en descripción de ingredientes
      if (score === 0 || score < 50) {
        for (const syn of sinonimos) {
          if (descNorm.includes(syn)) {
            score += 30;
            matchedReason = matchedReason || 'Ingrediente o receta afín';
            break;
          }
        }
      }

      // E. Fuzzy match en el nombre para errores ortográficos
      if (score === 0) {
        const palabrasNombre = nombreNorm.split(' ');
        for (const token of tokens) {
          for (const pal of palabrasNombre) {
            if (esFuzzyMatch(token, pal)) {
              score += 40;
              matchedReason = `Sugerencia similar a "${token}"`;
              break;
            }
          }
          if (score > 0) break;
        }
      }

      if (score > 0) {
        platosConScore.push({
          ...p,
          searchScore: score,
          matchedReason
        });
      }
    });

    // Ordenar platos por score descendente
    platosConScore.sort((a, b) => b.searchScore - a.searchScore);

    // --------------------------------------------------------------------------
    // 2. RELACIÓN CRUZADA CON RESTAURANTES
    // --------------------------------------------------------------------------
    // Mapear cuántos y cuáles platos de la búsqueda prepara cada cocina
    const platosPorRestaurante = new Map();
    platosConScore.forEach(plato => {
      const bzId = plato.business_id;
      if (!platosPorRestaurante.has(bzId)) {
        platosPorRestaurante.set(bzId, []);
      }
      platosPorRestaurante.get(bzId).push(plato);
    });

    const restaurantesConScore = [];

    (restaurantes || []).forEach(rest => {
      const nombreNorm = normalizarTexto(rest.name);
      const catNorm = normalizarTexto(rest.category || '');
      const platosDeEstaCocina = platosPorRestaurante.get(rest.id) || [];
      let score = 0;
      let matchReason = '';

      // A. Nombre de la cocina coincide directamente
      if (nombreNorm.includes(queryNorm)) {
        score += 100;
        matchReason = 'Coincidencia directa con el local';
      }

      // B. Nombre o categoría de la cocina coincide con sinónimos
      for (const syn of sinonimos) {
        if (nombreNorm.includes(syn)) {
          score += 85;
          matchReason = matchReason || `Especialista en ${syn}`;
          break;
        }
        if (catNorm.includes(syn)) {
          score += 70;
          matchReason = matchReason || `Especialidad: ${rest.category}`;
          break;
        }
      }

      // C. Prepara platos que coinciden con la búsqueda (Relación Cruzada)
      if (platosDeEstaCocina.length > 0) {
        score += 60 + Math.min(platosDeEstaCocina.length * 8, 40);
        matchReason = matchReason || `Prepara ${platosDeEstaCocina.length} ${platosDeEstaCocina.length === 1 ? 'plato afín' : 'platos afines'}`;
      }

      // Solo incluir restaurantes relevantes
      if (score > 0) {
        // Booster por calificación
        const rating = parseFloat(rest.rating || 4.90);
        score += rating * 4;

        // Penalización suave por distancia en km
        const distKm = parseFloat(rest.distanciaKm || 2.0);
        score -= distKm * 1.5;

        restaurantesConScore.push({
          ...rest,
          searchScore: score,
          matchReason,
          platosCoincidentes: platosDeEstaCocina.slice(0, 3), // Muestra previa de 3 platos
          totalPlatosCoincidentes: platosDeEstaCocina.length
        });
      }
    });

    // Ordenar restaurantes por relevancia final
    restaurantesConScore.sort((a, b) => b.searchScore - a.searchScore);

    const resultadoFinal = {
      restaurantesCoincidentes: restaurantesConScore,
      platosIndependientes: platosConScore,
      interpretacion: {
        query,
        conceptosDetectados,
        interpretacionTexto,
        sinonimosUsados: sinonimos.slice(0, 8)
      },
      totalEncontrados: restaurantesConScore.length + platosConScore.length
    };

    guardarEnCache(cacheKey, resultadoFinal);
    return resultadoFinal;
  },

  /**
   * Consulta remota optimizada a Supabase si se desea buscar en todo el catálogo de backend.
   */
  async buscarRemotoSupabase(query) {
    if (!query || !query.trim()) return { productos: [], negocios: [] };

    const { sinonimos } = this.expandirTerminos(query);
    const terminosFiltro = sinonimos.slice(0, 4);

    try {
      // Búsqueda cruzada de productos con negocios relacionados
      let queryProds = supabase
        .from('products')
        .select('*, businesses(id, name, lat, lng, rating, rating_count, is_active)')
        .eq('is_available', true);

      // Aplicar filtros OR ilike
      const orFilters = terminosFiltro.map(t => `name.ilike.%${t}%,description.ilike.%${t}%,category.ilike.%${t}%`).join(',');
      queryProds = queryProds.or(orFilters).limit(50);

      const { data: productos, error: errProds } = await queryProds;

      // Búsqueda de restaurantes por nombre o categoría
      const orBzFilters = terminosFiltro.map(t => `name.ilike.%${t}%,category.ilike.%${t}%`).join(',');
      const { data: negocios, error: errBz } = await supabase
        .from('businesses')
        .select('*')
        .eq('is_active', true)
        .or(orBzFilters)
        .limit(20);

      return {
        productos: errProds ? [] : (productos || []),
        negocios: errBz ? [] : (negocios || [])
      };
    } catch (e) {
      console.warn('Error en búsqueda remota de Supabase:', e);
      return { productos: [], negocios: [] };
    }
  }
};
