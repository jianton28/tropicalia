-- =========================================================================
-- MIGRACIÓN SUPABASE: SOPORTE DE FOTO DE PERFIL DE USUARIO
-- Tropicalia Web & Mobile Platform
-- =========================================================================

-- 1. Agregar columna avatar_url en la tabla de perfiles de clientes
ALTER TABLE public.client_profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Agregar columna avatar_url en perfiles de choferes y cocinas para compatibilidad multi-rol
ALTER TABLE public.driver_profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 3. Crear bucket de almacenamiento 'avatars' público en Supabase Storage
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 4. Habilitar políticas de seguridad RLS en storage.objects para el bucket 'avatars'
-- A) Lectura pública de avatares para que cualquier cliente o restaurante vea la foto
DROP POLICY IF EXISTS "Avatares son publicos para lectura" ON storage.objects;
CREATE POLICY "Avatares son publicos para lectura"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- B) Inserción autorizada para usuarios autenticados
DROP POLICY IF EXISTS "Usuarios autenticados pueden subir avatar" ON storage.objects;
CREATE POLICY "Usuarios autenticados pueden subir avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- C) Actualización autorizada para usuarios autenticados
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar su avatar" ON storage.objects;
CREATE POLICY "Usuarios autenticados pueden actualizar su avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars');

-- D) Eliminación autorizada para usuarios autenticados
DROP POLICY IF EXISTS "Usuarios autenticados pueden borrar su avatar" ON storage.objects;
CREATE POLICY "Usuarios autenticados pueden borrar su avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars');

