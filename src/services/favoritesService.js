import { supabase } from '../lib/supabase.js';

const STORAGE_KEY = 'tropicalia_favorites_ids';

/**
 * Servicio Centralizado de Platos Favoritos
 */
export const favoritesService = {
  getFavorites() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },

  isFavorite(productId) {
    if (!productId) return false;
    const favs = this.getFavorites();
    return favs.includes(productId);
  },

  async toggleFavorite(productId, userId = null) {
    if (!productId) return false;
    let favs = this.getFavorites();
    const exists = favs.includes(productId);

    if (exists) {
      favs = favs.filter(id => id !== productId);
    } else {
      favs.push(productId);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));

    // Si el usuario está autenticado, sincronizar con Supabase
    if (userId) {
      try {
        if (exists) {
          await supabase
            .from('user_favorites')
            .delete()
            .match({ user_id: userId, product_id: productId });
        } else {
          await supabase
            .from('user_favorites')
            .upsert([{ user_id: userId, product_id: productId }]);
        }
      } catch (err) {
        console.warn('Sincronización de favoritos en Supabase:', err.message);
      }
    }

    // Emitir evento para sincronizar componentes en vivo
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tropicalia:favorites_changed', {
        detail: { productId, isFavorite: !exists, favorites: favs }
      }));
    }

    return !exists;
  },

  async syncWithSupabase(userId) {
    if (!userId) return this.getFavorites();
    try {
      const { data, error } = await supabase
        .from('user_favorites')
        .select('product_id')
        .eq('user_id', userId);

      if (!error && data) {
        const remoteIds = data.map(f => f.product_id);
        const localIds = this.getFavorites();
        const merged = Array.from(new Set([...localIds, ...remoteIds]));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
      }
    } catch (e) {
      console.warn('Error sincronizando favoritos:', e);
    }
    return this.getFavorites();
  }
};
