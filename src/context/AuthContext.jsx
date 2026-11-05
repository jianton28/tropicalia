import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const APP_PRODUCTION_URL = 'https://tropicalia-rho.vercel.app';

export function getAuthRedirectUrl(path = '/portal') {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    // Si no es el puerto de desarrollo local 3000 que causa fallas de redirección externa:
    if (!origin.includes(':3000')) {
      return `${origin}${path}`;
    }
  }
  return `${APP_PRODUCTION_URL}${path}`;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  async function resolveRole(authUser) {
    if (!authUser) return null;
    
    // 1. Administrador (por correo oficial o metadata)
    if (authUser.email?.toLowerCase().includes('admin') || authUser.user_metadata?.role === 'admin') {
      return 'admin';
    }

    try {
      // 2. Cocina / Restaurante (por registro en tabla businesses)
      const { data: neg } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', authUser.id)
        .maybeSingle();

      if (neg) {
        return 'restaurant';
      }

      // 3. Repartidor (por registro en tabla driver_profiles)
      const { data: drv } = await supabase
        .from('driver_profiles')
        .select('id')
        .eq('id', authUser.id)
        .maybeSingle();

      if (drv) {
        return 'delivery';
      }
    } catch (err) {
      console.warn('Error resolviendo rol en Supabase:', err);
    }

    // 4. Metadata explícita o Cliente por defecto
    return authUser.user_metadata?.role || 'client';
  }

  async function initAuth() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        const resolvedRole = await resolveRole(session.user);
        setRole(resolvedRole);
      } else {
        setUser(null);
        setRole(null);
      }
    } catch (e) {
      console.error('Error inicializando sesión:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        const resolvedRole = await resolveRole(session.user);
        setRole(resolvedRole);
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.user) {
      setUser(data.user);
      const r = await resolveRole(data.user);
      setRole(r);
      return { user: data.user, role: r };
    }
    return data;
  }

  async function signUp(email, password, metadata = {}) {
    const redirectUrl = getAuthRedirectUrl('/portal');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: redirectUrl,
      },
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Signout warning:', e);
    } finally {
      setUser(null);
      setRole(null);
      localStorage.removeItem('tropicalia_last_order_id');
    }
  }

  return (
    <AuthContext.Provider value={{ user, role, setRole, loading, signIn, signUp, signOut, refreshSession: initAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser usado dentro de AuthProvider');
  }
  return context;
}

