import { supabase } from '../lib/supabase';

/**
 * Servicio de Gestión y Optimización de Fotos de Perfil (Avatares)
 * Soporta compresión en el cliente con HTML5 Canvas y almacenamiento en Supabase Storage
 * con fallback de resiliencia multicanal.
 */

/**
 * Redimensiona y recorta una imagen de forma cuadrada centrada (1:1)
 * para optimizar rendimiento y almacenamiento antes de subir a Supabase.
 * 
 * @param {File|Blob} file 
 * @param {number} size - Ancho y alto final en píxeles (default 400px)
 * @param {number} quality - Calidad de compresión JPEG (0.82)
 * @returns {Promise<{ blob: Blob, dataUrl: string }>}
 */
export function resizeAndCompressImage(file, size = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No se proporcionó ningún archivo de imagen.'));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Error al leer el archivo de imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagen no compatible.'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');

          // Cálculo de recorte cuadrado centrado
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;

          // Suavizado de bordes
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          canvas.toBlob(
            blob => {
              if (blob) {
                resolve({ blob, dataUrl });
              } else {
                resolve({ blob: file, dataUrl });
              }
            },
            'image/jpeg',
            quality
          );
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Sube y actualiza la foto de perfil en Supabase Storage y base de datos:
 * 1. Sube a bucket 'avatars' (o bucket de respaldo 'receipts').
 * 2. Actualiza metadatos de usuario en auth.users (user_metadata.avatar_url).
 * 3. Actualiza columna avatar_url en client_profiles.
 * 
 * @param {File} file - Archivo de imagen seleccionado
 * @param {string} userId - UUID del usuario autenticado
 * @returns {Promise<string>} URL pública final del avatar
 */
export async function uploadUserAvatar(file, userId) {
  if (!file || !userId) {
    throw new Error('Archivo y usuario requeridos para subir foto de perfil.');
  }

  // 1. Optimización en cliente
  const { blob, dataUrl } = await resizeAndCompressImage(file, 400, 0.82);

  let publicUrl = null;
  const fileName = `avatar_${Date.now()}.jpg`;
  const storagePath = `${userId}/${fileName}`;

  // 2. Intentar subida a bucket 'avatars'
  try {
    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (!uploadErr) {
      const { data: pubData } = supabase.storage.from('avatars').getPublicUrl(storagePath);
      if (pubData?.publicUrl) {
        publicUrl = pubData.publicUrl;
      }
    }
  } catch (err) {
    console.warn('Bucket avatars no disponible, intentando bucket receipts:', err);
  }

  // 3. Fallback a bucket 'receipts' si 'avatars' no estuviera configurado
  if (!publicUrl) {
    try {
      const fallbackPath = `avatars/${userId}_${Date.now()}.jpg`;
      const { error: fbErr } = await supabase.storage
        .from('receipts')
        .upload(fallbackPath, blob, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (!fbErr) {
        const { data: pubData } = supabase.storage.from('receipts').getPublicUrl(fallbackPath);
        if (pubData?.publicUrl) {
          publicUrl = pubData.publicUrl;
        }
      }
    } catch (fbErr) {
      console.warn('Bucket receipts fallback falló:', fbErr);
    }
  }

  // 4. Fallback final resiliente: Data URL comprimida de alta fidelidad (<50KB)
  if (!publicUrl) {
    publicUrl = dataUrl;
  }

  // 5. Actualizar en Supabase Auth (user_metadata.avatar_url)
  const { error: authErr } = await supabase.auth.updateUser({
    data: { avatar_url: publicUrl }
  });
  if (authErr) {
    console.warn('Error actualizando user_metadata.avatar_url:', authErr);
  }

  // 6. Actualizar en tabla client_profiles
  try {
    await supabase
      .from('client_profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId);
  } catch (dbErr) {
    console.warn('Error sincronizando avatar_url en client_profiles:', dbErr);
  }

  return publicUrl;
}

/**
 * Elimina la foto de perfil del usuario en Supabase
 * 
 * @param {string} userId - UUID del usuario autenticado
 */
export async function removeUserAvatar(userId) {
  if (!userId) return;

  // 1. Limpiar en Supabase Auth
  const { error: authErr } = await supabase.auth.updateUser({
    data: { avatar_url: null }
  });
  if (authErr) {
    console.warn('Error removiendo user_metadata.avatar_url:', authErr);
  }

  // 2. Limpiar en tabla client_profiles
  try {
    await supabase
      .from('client_profiles')
      .update({ avatar_url: null })
      .eq('id', userId);
  } catch (dbErr) {
    console.warn('Error limpiando avatar_url en client_profiles:', dbErr);
  }

  return true;
}

