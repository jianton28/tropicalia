import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { APP_PRODUCTION_URL, getAuthRedirectUrl } from '../services/authRedirect';

export { APP_PRODUCTION_URL, getAuthRedirectUrl };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  async function resolveRole(authUser) {
    if (!authUser) return null;
    
    // 1. Administrador: Verificación estricta (correo oficial del dominio o tabla app_admins)
    const emailLower = authUser.email?.toLowerCase() || '';
    if (emailLower.includes('admin') || emailLower.endsWith('@tropicalia.lat')) {
      return 'admin';
    }

    try {
      // Verificar en tabla app_admins si existe
      const { data: adm } = await supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (adm) return 'admin';

      // 2. Cocina / Restaurante: Verificación en tabla businesses (owner_id)
      const { data: neg } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', authUser.id)
        .maybeSingle();

      if (neg) {
        return 'restaurant';
      }

      // 3. Repartidor: Verificación en tabla driver_profiles
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

    // Por aislamiento estricto de seguridad, cualquier otro usuario es estrictamente 'client'
    // y NINGÚN usuario puede auto-asignarse roles privilegiados desde user_metadata
    return 'client';
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

  /**
   * Actualización segura de datos de perfil:
   * - Edición de nombre sin clave.
   * - Correo y teléfono requieren clave actual por seguridad.
   * - El rol NUNCA es editable desde el cliente.
   */
  async function updateUserProfile({ fullName, email, phone, currentPassword }) {
    if (!user) throw new Error('No hay sesión activa.');

    // 1. Edición de nombre de usuario
    if (fullName && fullName.trim() !== user.user_metadata?.full_name) {
      const { data, error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() } // ROL NUNCA SE MODIFICA
      });
      if (error) throw error;
      setUser(data.user);

      try {
        await supabase.from('client_profiles').update({ full_name: fullName.trim() }).eq('id', user.id);
      } catch (e) {
        console.warn('Sync client_profiles:', e);
      }
    }

    // 2. Actualización de correo o teléfono (requiere contraseña actual obligatoria)
    const cambiarEmail = email && email.trim().toLowerCase() !== user.email?.toLowerCase();
    const cambiarTelefono = phone && phone.trim() !== user.user_metadata?.phone;

    if (cambiarEmail || cambiarTelefono) {
      if (!currentPassword) {
        throw new Error('Para actualizar tu correo o teléfono debes ingresar tu contraseña actual.');
      }

      // Validar contraseña actual contra Supabase
      const { error: pwdErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      });
      if (pwdErr) {
        throw new Error('La contraseña actual es incorrecta.');
      }

      if (cambiarEmail) {
        const redirectUrl = getAuthRedirectUrl('/portal');
        const { error: emailErr } = await supabase.auth.updateUser(
          { email: email.trim().toLowerCase() },
          { emailRedirectTo: redirectUrl }
        );
        if (emailErr) throw emailErr;
      }

      if (cambiarTelefono) {
        const { data: upUser, error: telErr } = await supabase.auth.updateUser({
          data: { phone: phone.trim() }
        });
        if (telErr) throw telErr;
        setUser(upUser.user);
        try {
          await supabase.from('client_profiles').update({ phone: phone.trim() }).eq('id', user.id);
        } catch (e) {
          console.warn('Sync phone client_profiles:', e);
        }
      }
    }

    return { success: true };
  }

  /**
   * Cambio seguro de contraseña:
   * Valida clave actual, envía correo de verificación obligatorio a production URL,
   * y al confirmar el enlace, se actualiza automáticamente en Supabase.
   */
  async function requestPasswordChange({ currentPassword, newPassword, confirmPassword }) {
    if (!user) throw new Error('No hay sesión activa.');
    if (!currentPassword) throw new Error('Debes ingresar tu contraseña actual.');
    if (!newPassword || newPassword.length < 6) {
      throw new Error('La nueva contraseña debe tener mínimo 6 caracteres.');
    }
    if (newPassword !== confirmPassword) {
      throw new Error('Las nuevas contraseñas no coinciden.');
    }
    if (newPassword === currentPassword) {
      throw new Error('La nueva contraseña debe ser diferente a la contraseña actual.');
    }

    // 1. Validar autenticidad de la contraseña actual
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });
    if (authErr) {
      throw new Error('La contraseña actual no es correcta.');
    }

    // 2. Guardar temporalmente en sesión local segura para actualización automática post-enlace
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('tropicalia_pending_new_pwd', newPassword);
    }

    // 3. Enviar correo de verificación obligatorio garantizando URL oficial
    const redirectUrl = getAuthRedirectUrl('/portal?verify_pwd_update=1');
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: redirectUrl
    });

    if (resetErr) throw resetErr;

    return {
      success: true,
      message: `Hemos enviado un correo de verificación a ${user.email}. Por favor confirma el enlace recibido para que tu nueva contraseña se active automáticamente en Supabase.`
    };
  }

  /**
   * Recuperación de contraseña para usuarios con sesión cerrada (olvidaron clave).
   * Envía enlace oficial de restablecimiento a production URL evitando localhost:3000.
   */
  async function sendPasswordResetEmail(emailToReset) {
    if (!emailToReset || !emailToReset.trim()) {
      throw new Error('Por favor ingresa tu correo electrónico.');
    }
    const cleanEmail = emailToReset.trim().toLowerCase();
    const redirectUrl = getAuthRedirectUrl('/portal?reset_pwd=1');
    const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: redirectUrl
    });
    if (error) throw error;
    return data;
  }

  /**
   * Autenticación con proveedores externos (Google, Apple, etc.) garantizando redirección oficial.
   */
  async function signInWithOAuth(provider = 'google', nextPath = '/portal') {
    const redirectUrl = getAuthRedirectUrl(nextPath);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl
      }
    });
    if (error) throw error;
    return data;
  }

  /**
   * Reenvío del correo de confirmación de cuenta en caso de que no haya llegado.
   */
  async function resendVerificationEmail(emailToResend) {
    if (!emailToResend || !emailToResend.trim()) {
      throw new Error('Por favor ingresa tu correo electrónico.');
    }
    const cleanEmail = emailToResend.trim().toLowerCase();
    const redirectUrl = getAuthRedirectUrl('/portal');
    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    if (error) throw error;
    return data;
  }

  async function applyPendingPasswordUpdate(newPasswordOverride = null) {
    const pwd = newPasswordOverride || (typeof window !== 'undefined' ? sessionStorage.getItem('tropicalia_pending_new_pwd') : null);
    if (!pwd) return false;

    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) throw error;

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('tropicalia_pending_new_pwd');
    }
    return true;
  }

  return (
    <AuthContext.Provider value={{
      user,
      role,
      setRole,
      loading,
      signIn,
      signUp,
      signOut,
      signInWithOAuth,
      sendPasswordResetEmail,
      resendVerificationEmail,
      refreshSession: initAuth,
      updateUserProfile,
      requestPasswordChange,
      applyPendingPasswordUpdate
    }}>
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

