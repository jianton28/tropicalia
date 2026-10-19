import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  async function resolveRole(authUser) {
    if (!authUser) return null;
    let detectedRole = authUser.user_metadata?.role;

    if (!detectedRole) {
      if (authUser.email?.includes('admin')) {
        detectedRole = 'admin';
      } else {
        try {
          const { data: neg } = await supabase
            .from('businesses')
            .select('id')
            .eq('owner_id', authUser.id)
            .maybeSingle();

          if (neg) {
            detectedRole = 'restaurant';
          } else {
            const { data: drv } = await supabase
              .from('driver_profiles')
              .select('id')
              .eq('id', authUser.id)
              .maybeSingle();

            if (drv) {
              detectedRole = 'delivery';
            } else {
              detectedRole = 'client';
            }
          }
        } catch (err) {
          console.warn('Error resolviendo rol:', err);
          detectedRole = 'client';
        }
      }
    }
    return detectedRole;
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
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
    <AuthContext.Provider value={{ user, role, loading, signIn, signUp, signOut, refreshSession: initAuth }}>
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

