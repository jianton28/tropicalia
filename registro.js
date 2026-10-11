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

window.cambiarRol = function(rol) {
  rolSeleccionado = rol;
  
  document.querySelectorAll('.btn-rol').forEach(b => {
    b.classList.toggle('activo', b.dataset.rol === rol);
  });

  if (rol === 'client') {
    seccionCocina.style.display = 'none';
    seccionDelivery.style.display = 'none';
    textoTyc.innerHTML = 'Acepto los <strong>Términos para Clientes</strong> (Tropicalia opera exclusivamente como intermediario tecnológico de pedidos y entregas).';
    btnRegistrar.innerText = 'Crear Cuenta de Cliente';
  } else if (rol === 'restaurant') {
    seccionCocina.style.display = 'flex';
    seccionDelivery.style.display = 'none';
    textoTyc.innerHTML = 'Acepto los <strong>Términos para Comercios</strong> (Responsabilidad sanitaria y fiscal exclusiva del local, 10% de comisión de plataforma y cortes de caja diarios).';
    btnRegistrar.innerText = 'Solicitar Registro de Restaurante';
  } else if (rol === 'delivery') {
    seccionCocina.style.display = 'none';
    seccionDelivery.style.display = 'flex';
    textoTyc.innerHTML = 'Acepto el <strong>Contrato Mercantil Independiente</strong> (Servicio autónomo sin subordinación laboral bajo la LOTTT, uso de vehículo propio y tope de deuda en efectivo de $15).';
    btnRegistrar.innerText = 'Registrarse como Repartidor';
  }
};

async function subirDocumento(file, carpeta) {
  if (!file) return null;
  const ext = file.name.split('.').pop();
  const ruta = `${carpeta}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
  
  const { error } = await db.storage.from('receipts').upload(ruta, file);
  if (error) throw new Error('Error al subir documento: ' + error.message);
  
  const { data } = db.storage.from('receipts').getPublicUrl(ruta);
  return data.publicUrl;
}

if (formRegistro) {
  formRegistro.addEventListener('submit', async (e) => {
    e.preventDefault();
    regMensaje.style.display = 'none';
    btnRegistrar.disabled = true;
    btnRegistrar.innerText = 'Procesando registro...';

    const nombreCompleto = document.getElementById('reg-nombre-completo').value.trim();
    const telefono = document.getElementById('reg-telefono').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const checkTyc = document.getElementById('reg-check-tyc').checked;

    if (!checkTyc) {
      alert('Debes aceptar los términos y condiciones correspondientes a tu rol.');
      btnRegistrar.disabled = false;
      return;
    }

    try {
      // 1. Registro en Supabase Auth
      const { data: authData, error: authError } = await db.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: nombreCompleto,
            phone: telefono,
            role: rolSeleccionado
          }
        }
      });

      if (authError) throw authError;
      const user = authData.user;
      if (!user) throw new Error('No se pudo crear la sesión del usuario.');

      // 2. Lógica por rol
      if (rolSeleccionado === 'restaurant') {
        const restNombre = document.getElementById('reg-restaurante-nombre').value.trim();
        const slug = (document.getElementById('reg-restaurante-slug').value.trim() || restNombre)
          .toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        const rif = document.getElementById('reg-restaurante-rif').value.trim();

        const fileId = document.getElementById('doc-cocina-id').files[0];
        const fileSanitario = document.getElementById('doc-cocina-sanitario').files[0];
        const fileLicores = document.getElementById('doc-cocina-licores').files[0];

        if (!fileId || !fileSanitario) {
          throw new Error('Debes adjuntar Cédula/RIF y Certificado de Manipulación de Alimentos.');
        }

        btnRegistrar.innerText = 'Subiendo recaudos legales...';
        const docIdUrl = await subirDocumento(fileId, 'verificaciones/cocinas');
        const docSanitarioUrl = await subirDocumento(fileSanitario, 'verificaciones/cocinas');
        const docLicoresUrl = fileLicores ? await subirDocumento(fileLicores, 'verificaciones/cocinas') : null;

        // Crear el comercio en businesses
        const { data: negocio, error: errNegocio } = await db
          .from('businesses')
          .insert([{
            name: restNombre,
            slug: slug,
            phone: telefono,
            is_active: false // Inactivo hasta verificación administrativa
          }])
          .select()
          .single();

        if (errNegocio) throw errNegocio;

        // Vincular el perfil de cocina
        await db.from('kitchen_profiles').insert([{
          id: user.id,
          business_id: negocio.id
        }]);

        // Registrar expediente de recaudos
        await db.from('restaurant_verifications').insert([{
          business_id: negocio.id,
          rif: rif,
          id_doc_url: docIdUrl,
          health_permit_url: docSanitarioUrl,
          liquor_license_url: docLicoresUrl,
          status: 'pending_review'
        }]);

      } else if (rolSeleccionado === 'delivery') {
        const cedula = document.getElementById('reg-delivery-ci').value.trim();
        const tipoVehiculo = document.getElementById('reg-vehiculo-tipo').value;
        const placa = document.getElementById('reg-vehiculo-placa').value.trim();

        const fileCi = document.getElementById('doc-delivery-ci').files[0];
        const fileLic = document.getElementById('doc-delivery-licencia').files[0];
        const fileMed = document.getElementById('doc-delivery-medico').files[0];

        if (!fileCi || !fileLic || !fileMed) {
          throw new Error('Debes adjuntar Cédula, Licencia y Certificado Médico Vial.');
        }

        btnRegistrar.innerText = 'Subiendo recaudos viales...';
        await subirDocumento(fileCi, 'verificaciones/drivers');
        await subirDocumento(fileLic, 'verificaciones/drivers');
        await subirDocumento(fileMed, 'verificaciones/drivers');

        // Inicializar billetera y control de deuda de efectivo
        await db.from('delivery_wallets').insert([{
          driver_id: user.id,
          prepaid_balance: 0.00,
          cash_debt: 0.00,
          debt_ceiling: 15.00,
          is_blocked: false
        }]);
      }

      regMensaje.style.background = '#065f46';
      regMensaje.style.borderColor = '#047857';
      regMensaje.innerText = '¡Registro completado con éxito! Redirigiendo al portal de acceso...';
      regMensaje.style.display = 'block';

      setTimeout(() => {
        window.location.href = 'portal.html';
      }, 1800);

    } catch (err) {
      regMensaje.style.background = '#7f1d1d';
      regMensaje.style.borderColor = '#991b1b';
      regMensaje.innerText = 'Error al registrar: ' + err.message;
      regMensaje.style.display = 'block';
    } finally {
      btnRegistrar.disabled = false;
      cambiarRol(rolSeleccionado);
    }
  });
}