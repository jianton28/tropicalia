const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let rolSeleccionado = 'client';

const seccionCocina = document.getElementById('seccion-cocina');
const seccionDelivery = document.getElementById('seccion-delivery');
const textoTyc = document.getElementById('texto-tyc-dinamico');
const formRegistro = document.getElementById('form-registro');
const regMensaje = document.getElementById('reg-mensaje');
const btnRegistrar = document.getElementById('btn-registrar');

// Cambiar entre pestañas de rol (Cliente, Cocina, Repartidor)
window.cambiarRol = function(rol) {
  rolSeleccionado = rol;

  document.querySelectorAll('.btn-rol').forEach(b => {
    b.classList.toggle('activo', b.dataset.rol === rol);
  });

  if (rol === 'client') {
    if (seccionCocina) seccionCocina.style.display = 'none';
    if (seccionDelivery) seccionDelivery.style.display = 'none';
    if (textoTyc) {
      textoTyc.innerHTML = 'Acepto los <a href="legal.html" target="_blank" style="color: #fbbf24; text-decoration: underline;">Términos para Clientes</a> (Tropicalia opera exclusivamente como intermediario tecnológico de pedidos y entregas).';
    }
    if (btnRegistrar) btnRegistrar.innerText = 'Crear Cuenta de Cliente';
  } else if (rol === 'restaurant') {
    if (seccionCocina) seccionCocina.style.display = 'flex';
    if (seccionDelivery) seccionDelivery.style.display = 'none';
    if (textoTyc) {
      textoTyc.innerHTML = 'Acepto el <a href="legal.html" target="_blank" style="color: #fbbf24; text-decoration: underline;">Acuerdo Comercial para Locales</a> (Responsabilidad sanitaria y fiscal del local, 10% de comisión y cortes de caja diarios).';
    }
    if (btnRegistrar) btnRegistrar.innerText = 'Solicitar Registro de Restaurante';
  } else if (rol === 'delivery') {
    if (seccionCocina) seccionCocina.style.display = 'none';
    if (seccionDelivery) seccionDelivery.style.display = 'flex';
    if (textoTyc) {
      textoTyc.innerHTML = 'Acepto el <a href="legal.html" target="_blank" style="color: #fbbf24; text-decoration: underline;">Contrato Mercantil Independiente</a> (Servicio autónomo sin subordinación bajo LOTTT, vehículo propio y tope de deuda de $20).';
    }
    if (btnRegistrar) btnRegistrar.innerText = 'Registrarse como Repartidor';
  }
};

// Función auxiliar para subir recaudos a Supabase Storage
async function subirArchivoRecaudo(inputId, carpeta) {
  const input = document.getElementById(inputId);
  if (!input || !input.files || input.files.length === 0) return null;

  const file = input.files[0];
  const ext = file.name.split('.').pop();
  const path = `${carpeta}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;

  const { error } = await db.storage.from('receipts').upload(path, file);
  if (error) return null;

  const { data } = db.storage.from('receipts').getPublicUrl(path);
  return data.publicUrl;
}

// Procesar el formulario de registro
if (formRegistro) {
  formRegistro.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnRegistrar.disabled = true;
    btnRegistrar.innerText = 'Procesando registro...';
    if (regMensaje) regMensaje.style.display = 'none';

    try {
      const nombre = document.getElementById('reg-nombre').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const telefono = document.getElementById('reg-telefono').value.trim();
      const password = document.getElementById('reg-password').value;

      // 1. Crear usuario en Supabase Auth con su rol en user_metadata
      const { data: authData, error: authErr } = await db.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: rolSeleccionado,
            full_name: nombre,
            phone: telefono
          }
        }
      });

      if (authErr) throw authErr;
      const userId = authData.user?.id;

      // 2. Guardar datos específicos según el rol elegido
      if (rolSeleccionado === 'client' && userId) {
        await db.from('client_profiles').upsert([{
          id: userId,
          full_name: nombre,
          phone: telefono,
          terms_accepted: true
        }]);
        alert('¡Cuenta de cliente creada con éxito!');
        window.location.href = 'index.html';

      } else if (rolSeleccionado === 'restaurant' && userId) {
        const nombreLocal = document.getElementById('reg-local-nombre')?.value.trim() || `${nombre} Cocina`;
        const categoriaLocal = document.getElementById('reg-local-categoria')?.value.trim() || 'Gastronomía';
        const rifLocal = document.getElementById('reg-local-rif')?.value.trim() || 'J-00000000-0';

        // Crear restaurante (inactivo hasta aprobación de admin o activo para pruebas)
        const { data: nuevoNegocio, error: negErr } = await db
          .from('businesses')
          .insert([{
            owner_id: userId,
            name: nombreLocal,
            category: categoriaLocal,
            phone: telefono,
            is_active: true
          }])
          .select()
          .single();

        if (!negErr && nuevoNegocio) {
          const urlSanitario = await subirArchivoRecaudo('file-permiso-sanitario', 'verificaciones');
          const urlManipulacion = await subirArchivoRecaudo('file-manipulacion', 'verificaciones');
          const urlLicores = await subirArchivoRecaudo('file-licores', 'verificaciones');

          await db.from('restaurant_verifications').insert([{
            business_id: nuevoNegocio.id,
            rif: rifLocal,
            sanitary_permit_url: urlSanitario,
            food_handling_url: urlManipulacion,
            liquor_license_url: urlLicores,
            status: 'pending'
          }]);
        }

        alert('¡Restaurante registrado con éxito! Redirigiendo a tu panel de cocina.');
        window.location.href = 'cocina.html';

      } else if (rolSeleccionado === 'delivery' && userId) {
        const vehiculo = document.getElementById('reg-vehiculo-tipo')?.value || 'moto';
        const placa = document.getElementById('reg-vehiculo-placa')?.value.trim() || 'S/P';

        const urlCedula = await subirArchivoRecaudo('file-driver-cedula', 'choferes');
        const urlLicencia = await subirArchivoRecaudo('file-driver-licencia', 'choferes');

        await db.from('driver_profiles').upsert([{
          id: userId,
          full_name: nombre,
          phone: telefono,
          vehicle_type: vehiculo,
          vehicle_plate: placa,
          id_doc_url: urlCedula,
          license_doc_url: urlLicencia,
          cash_debt: 0,
          is_online: true
        }]);

        alert('¡Cuenta de repartidor creada con éxito! Redirigiendo a tu panel de entregas.');
        window.location.href = 'delivery.html';
      }

    } catch (err) {
      if (regMensaje) {
        regMensaje.style.display = 'block';
        regMensaje.style.color = '#fca5a5';
        regMensaje.innerText = 'Error: ' + err.message;
      } else {
        alert('Error en el registro: ' + err.message);
      }
      btnRegistrar.disabled = false;
      btnRegistrar.innerText = 'Reintentar Registro';
    }
  });
}

// Inicializar vista por defecto
cambiarRol('client');