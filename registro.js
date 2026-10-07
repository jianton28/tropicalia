const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const formRegistro = document.getElementById('form-registro');
const regMensaje = document.getElementById('reg-mensaje');
const btnRegistrar = document.getElementById('btn-registrar');

formRegistro.addEventListener('submit', async (e) => {
  e.preventDefault();
  regMensaje.style.display = 'none';
  btnRegistrar.disabled = true;
  btnRegistrar.innerText = 'Creando comercio...';

  const name = document.getElementById('reg-nombre').value.trim();
  const slug = document.getElementById('reg-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
  const phone = document.getElementById('reg-telefono').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value.trim();

  try {
    const { data, error } = await db.rpc('registrar_comercio', {
      p_name: name,
      p_slug: slug,
      p_phone: phone,
      p_email: email,
      p_password: password
    });

    if (error) throw error;

    regMensaje.style.background = '#065f46';
    regMensaje.style.borderColor = '#047857';
    regMensaje.innerText = '¡Comercio registrado con éxito! Redirigiendo a la cocina...';
    regMensaje.style.display = 'block';

    setTimeout(() => {
      window.location.href = 'cocina.html';
    }, 1800);

  } catch (err) {
    regMensaje.style.background = '#7f1d1d';
    regMensaje.style.borderColor = '#991b1b';
    regMensaje.innerText = 'Error al registrar: ' + err.message;
    regMensaje.style.display = 'block';
  } finally {
    btnRegistrar.disabled = false;
    btnRegistrar.innerText = 'Crear Restaurante';
  }
});