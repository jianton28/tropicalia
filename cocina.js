const SUPABASE_URL = 'https://utmmswvwqrqdxzobzakv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bW1zd3Z3cXJxZHh6b2J6YWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMTU2NTksImV4cCI6MjEwNTU5MTY1OX0.ykNc6yhpgUqJWQKMMWKOVgYY-JA0UP25SxLRQKUB_Vc';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let negocioId = null;
let insumosDisponibles = [];
let listaPlatos = [];
let ventasChartInstance = null;
let periodoSeleccionado = 'dia';
let pedidosHistoricos = [];
let platoEditandoId = null;
let estadoNegocioActivo = true;

// Constante de comisión plataforma
const TASA_COMISION_APP = 0.10; // 10%

// Elementos DOM
const panelNombreNegocio = document.getElementById('panel-nombre-negocio');
const gridPedidos = document.getElementById('grid-pedidos');
const loading = document.getElementById('loading');
const formNuevoPlato = document.getElementById('form-nuevo-plato');
const formNuevoInsumo = document.getElementById('form-nuevo-insumo');
const formMerma = document.getElementById('form-merma');
const selectMermaInsumo = document.getElementById('merma-insumo-id');
const tablaInsumosCuerpo = document.getElementById('tabla-insumos-cuerpo');
const tablaPlatosCuerpo = document.getElementById('tabla-platos-cuerpo');

// DOM Cierre de caja
const cajaVentasBrutas = document.getElementById('caja-ventas-brutas');
const cajaComision = document.getElementById('caja-comision');
const cajaNetoRecibir = document.getElementById('caja-neto-recibir');

// Modal Receta DOM
const modalReceta = document.getElementById('modal-receta');
const modalRecetaTitulo = document.getElementById('modal-receta-titulo');
const modalListaInsumos = document.getElementById('modal-lista-insumos-receta');

// =========================================================================
// CONTROL DE ACCESO Y SESIÓN (GUARDIA)
// =========================================================================
async function inicializarSesion(user) {
  try {
    const { data: perfil, error: errPerfil } = await db
      .from('kitchen_profiles')
      .select('business_id, businesses(name)')
      .eq('id', user.id)
      .single();

    if (errPerfil || !perfil) {
      alert('Esta cuenta no está vinculada a ningún restaurante registrado.');
      await cerrarSesion();
      return;
    }

    negocioId = perfil.business_id;
    if (panelNombreNegocio) {
      panelNombreNegocio.innerText = `${perfil.businesses?.name || 'Local'} - Operaciones`;
    }

    solicitarPermisoNotificaciones();
    await cargarEstadoNegocio();
    await cargarTodo();
    suscribirTiempoReal();
  } catch (err) {
    console.error('Error inicializando sesión:', err);
    await cerrarSesion();
  }
}

window.cerrarSesion = async function() {
  await db.auth.signOut();
  negocioId = null;
  window.location.href = 'portal.html';
};

// --- NOTIFICACIONES PUSH Y SONIDO ---
function solicitarPermisoNotificaciones() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
}

function reproducirAlertaComanda() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.warn('AudioContext no soportado:', e);
  }
}

function dispararNotificacionNuevaOrden(orden) {
  reproducirAlertaComanda();
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('🔔 ¡Nueva comanda recibida en Tropicalia!', {
      body: `Pedido #${orden.id.slice(0, 8)} de ${orden.customer_name || 'Cliente'} por $${parseFloat(orden.total || 0).toFixed(2)}`,
      icon: 'favicon.ico'
    });
  }
}

// --- INTERRUPTOR LOCAL ABIERTO / CERRADO ---
async function cargarEstadoNegocio() {
  if (!negocioId) return;
  const { data, error } = await db.from('businesses').select('is_active').eq('id', negocioId).single();
  if (!error && data) {
    estadoNegocioActivo = data.is_active;
    actualizarBotonEstadoNegocio();
  }
}

function actualizarBotonEstadoNegocio() {
  const btn = document.getElementById('btn-toggle-negocio');
  if (!btn) return;
  if (estadoNegocioActivo) {
    btn.className = 'btn-toggle activo';
    btn.innerText = '🟢 Local Abierto';
  } else {
    btn.className = 'btn-toggle pausado';
    btn.innerText = '🔴 Local Cerrado (Pausado)';
  }
}

window.toggleEstadoNegocio = async function() {
  const nuevoEstado = !estadoNegocioActivo;
  const { error } = await db.from('businesses').update({ is_active: nuevoEstado }).eq('id', negocioId);
  if (error) {
    alert('Error al cambiar estado del local: ' + error.message);
  } else {
    estadoNegocioActivo = nuevoEstado;
    actualizarBotonEstadoNegocio();
  }
};

// --- RESPALDO: ENVIAR A WHATSAPP ---
window.enviarComandaWhatsApp = function(telefonoCliente, ordenId, clienteNombre, direccion, total, itemsJson) {
  const items = JSON.parse(decodeURIComponent(itemsJson));
  let detalle = items.map(i => `• ${i.quantity || i.cantidad || 1}x ${i.name} ($${i.subtotal || i.price})`).join('\n');
  
  const mensaje = 
    `*TROPICALIA - RESUMEN DE ORDEN*\n` +
    `*Orden:* #${ordenId.slice(0, 8)}\n` +
    `*Cliente:* ${clienteNombre}\n` +
    `*Dirección:* ${direccion}\n\n` +
    `*Detalle:*\n${detalle}\n\n` +
    `*Total:* $${parseFloat(total).toFixed(2)}`;

  const url = `https://wa.me/${(telefonoCliente || '').replace(/\+/g, '').replace(/\s+/g, '')}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, '_blank');
};

// --- CRONÓMETRO ---
function calcularTiempoEspera(fechaISO) {
  const minutos = Math.floor((new Date() - new Date(fechaISO)) / 60000);

  if (minutos < 15) {
    return { texto: `⏱️ ${minutos} min`, claseCard: 'alerta-optimo', claseTiempo: 'tiempo-optimo' };
  } else if (minutos <= 25) {
    return { texto: `⏳ ${minutos} min`, claseCard: 'alerta-demorado', claseTiempo: 'tiempo-demorado' };
  } else {
    return { texto: `🚨 ${minutos} min (Retrasado)`, claseCard: 'alerta-critico', claseTiempo: 'tiempo-critico' };
  }
}

async function cargarTodo() {
  if (!negocioId) return;
  await Promise.all([
    cargarInsumos(),
    cargarPlatosMenu(),
    cargarPedidos(),
    cargarDashboardFinanciero(),
    cargarBalanceCorteTurno()
  ]);
}

// --- COMANDAS ---
async function cargarPedidos() {
  if (!negocioId) return;
  if (loading) loading.style.display = 'block';

  const { data: pedidos, error } = await db
    .from('orders')
    .select('*')
    .eq('business_id', negocioId)
    .in('status', ['pending_payment_verification', 'pending', 'cooking', 'on_the_way'])
    .order('created_at', { ascending: true });

  if (loading) loading.style.display = 'none';

  if (error) {
    if (gridPedidos) gridPedidos.innerHTML = `<p class="alerta">Error: ${error.message}</p>`;
    return;
  }

  if (!pedidos || pedidos.length === 0) {
    if (gridPedidos) gridPedidos.innerHTML = '<p class="alerta">No hay comandas activas en este momento.</p>';
    return;
  }

  if (gridPedidos) {
    gridPedidos.innerHTML = pedidos.map(orden => {
      const alertaTiempo = calcularTiempoEspera(orden.created_at);
      const items = Array.isArray(orden.items) ? orden.items : [];
      const itemsSerializados = encodeURIComponent(JSON.stringify(items));
      const esVerificacion = orden.status === 'pending_payment_verification';

      let etiquetaBadge = orden.status;
      let claseBadge = `badge-${orden.status}`;
      if (esVerificacion) {
        etiquetaBadge = 'Esperando Pago';
        claseBadge = 'badge-verification';
      }

      return `
        <div class="ticket ${alertaTiempo.claseCard}">
          <div>
            <div class="ticket-header">
              <div>
                <strong>#ORD-${orden.id.slice(0, 8)}</strong>
                <span class="tiempo-badge ${alertaTiempo.claseTiempo}">${alertaTiempo.texto}</span>
              </div>
              <span class="badge ${claseBadge}">${etiquetaBadge}</span>
            </div>

            <ul class="ticket-items">
              ${items.map(item => `<li><strong>${item.quantity || item.cantidad || 1}x</strong> ${item.name} ($${item.subtotal || item.price || 0})</li>`).join('')}
            </ul>

            <div class="ticket-cliente">
              <p><strong>Cliente:</strong> ${orden.customer_name || 'Sin nombre'}</p>
              <p><strong>Tlf:</strong> ${orden.customer_phone || 'N/A'}</p>
              <p><strong>Modalidad:</strong> ${orden.delivery_type === 'pickup' ? '🛍️ Retiro en Local' : '🛵 Delivery'}</p>
              <p><strong>Dirección:</strong> ${orden.delivery_address || 'No indicada'}</p>
              ${orden.notes ? `<p style="color:#f59e0b;"><strong>Notas:</strong> ${orden.notes}</p>` : ''}
              ${orden.map_url ? `<p><a href="${orden.map_url}" target="_blank" style="color: #fbbf24;">📍 Ver Mapa GPS</a></p>` : ''}
            </div>
          </div>

          <div class="ticket-acciones">
            <button class="btn-secundario" style="padding: 6px; font-size: 0.75rem;" onclick="enviarComandaWhatsApp('${orden.customer_phone || ''}', '${orden.id}', '${orden.customer_name || ''}', '${orden.delivery_address || ''}', '${orden.total}', '${itemsSerializados}')">
              📲 WhatsApp
            </button>

            ${esVerificacion ? `
              <button class="btn-estado" disabled style="background:#4b5563; color:#d1d5db; cursor:not-allowed;" title="Esperando que el operador valide el pago móvil">
                ⏳ Pago en Validación
              </button>
            ` : ''}

            ${orden.status === 'pending' ? `
              <button class="btn-estado" style="background:#f59e0b; color:#000;" onclick="iniciarCocinaYDescontarStock('${orden.id}', '${itemsSerializados}')">
                Comenzar Cocina
              </button>` : ''}

            ${orden.status === 'cooking' ? `
              <button class="btn-estado" style="background:#10b981; color:#000;" onclick="cambiarEstado('${orden.id}', 'on_the_way')">
                Listo / Despachar
              </button>` : ''}

            ${orden.status === 'on_the_way' ? `
              <button class="btn-estado" style="background:#6366f1; color:#fff;" onclick="cambiarEstado('${orden.id}', 'delivered')">
                Entregado
              </button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

// Descuenta receta al comenzar preparación
window.iniciarCocinaYDescontarStock = async function(ordenId, itemsJson) {
  const items = JSON.parse(decodeURIComponent(itemsJson));

  try {
    for (const item of items) {
      const { data: receta } = await db
        .from('product_ingredients')
        .select('ingredient_id, quantity_required')
        .eq('product_id', item.product_id);

      if (receta && receta.length > 0) {
        for (const ing of receta) {
          const gastoTotal = ing.quantity_required * (item.quantity || 1);
          const insumo = insumosDisponibles.find(i => i.id === ing.ingredient_id);
          if (insumo) {
            const nuevoStock = Math.max(0, parseFloat(insumo.current_stock) - gastoTotal);
            await db.from('ingredients').update({ current_stock: nuevoStock }).eq('id', ing.ingredient_id);
          }
        }
      }
    }

    await cambiarEstado(ordenId, 'cooking');
    await cargarInsumos();
  } catch (err) {
    console.error('Error al descontar receta:', err);
    cambiarEstado(ordenId, 'cooking');
  }
};

window.cambiarEstado = async function(id, nuevoEstado) {
  const { error } = await db.from('orders').update({ status: nuevoEstado }).eq('id', id);
  if (!error) {
    cargarPedidos();
    cargarBalanceCorteTurno();
  }
};

// --- CIERRE DE CAJA Y LIQUIDACIÓN POR TURNOS ---
async function cargarBalanceCorteTurno() {
  if (!negocioId) return;

  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);

  const { data: ordenesTurno, error } = await db
    .from('orders')
    .select('subtotal_food, total, status')
    .eq('business_id', negocioId)
    .gte('created_at', hoyInicio.toISOString())
    .neq('status', 'cancelled');

  if (error || !ordenesTurno) return;

  const ventasBrutas = ordenesTurno.reduce((acc, o) => acc + (parseFloat(o.subtotal_food || o.total) || 0), 0);
  const comision = ventasBrutas * TASA_COMISION_APP;
  const neto = ventasBrutas - comision;

  if (cajaVentasBrutas) cajaVentasBrutas.innerText = `$${ventasBrutas.toFixed(2)}`;
  if (cajaComision) cajaComision.innerText = `-$${comision.toFixed(2)}`;
  if (cajaNetoRecibir) cajaNetoRecibir.innerText = `$${neto.toFixed(2)}`;
}

window.solicitarCorteCaja = async function() {
  if (!confirm('¿Deseas cerrar este turno y enviar la solicitud de liquidación a los operadores?')) return;

  const montoNeto = cajaNetoRecibir ? cajaNetoRecibir.innerText.replace('$', '') : '0.00';
  
  const { error } = await db.from('cash_closures').insert([{
    business_id: negocioId,
    net_amount: parseFloat(montoNeto),
    status: 'pending_settlement'
  }]);

  if (error) {
    alert('Aviso: Registrado corte local.');
  } else {
    alert('Turno cerrado. La administración procesará la transferencia de tu balance neto.');
  }
};

// --- MÓDULO DE REGISTRO DE MERMA Y VENTAS EN LOCAL ---
function actualizarSelectMermas() {
  if (!selectMermaInsumo) return;
  selectMermaInsumo.innerHTML = '<option value="" disabled selected>Seleccionar insumo...</option>' +
    insumosDisponibles.map(i => `<option value="${i.id}">${i.name} (Stock: ${i.current_stock} ${i.unit})</option>`).join('');
}

if (formMerma) {
  formMerma.addEventListener('submit', async (e) => {
    e.preventDefault();

    const insumoId = selectMermaInsumo.value;
    const cantidad = parseFloat(document.getElementById('merma-cantidad').value);
    const motivo = document.getElementById('merma-motivo').value;

    if (!insumoId || isNaN(cantidad) || cantidad <= 0) {
      alert('Ingresa un insumo y una cantidad válida.');
      return;
    }

    const insumo = insumosDisponibles.find(i => i.id === insumoId);
    if (!insumo) return;

    if (parseFloat(insumo.current_stock) < cantidad) {
      if (!confirm(`La cantidad a descontar (${cantidad}) supera el stock registrado (${insumo.current_stock}). ¿Deseas forzar el ajuste?`)) {
        return;
      }
    }

    try {
      await db.from('stock_waste').insert([{
        business_id: negocioId,
        ingredient_id: insumoId,
        quantity: cantidad,
        reason: motivo
      }]);

      const nuevoStock = Math.max(0, parseFloat(insumo.current_stock) - cantidad);
      await db.from('ingredients').update({ current_stock: nuevoStock }).eq('id', insumoId);

      alert('Salida de inventario registrada con éxito.');
      formMerma.reset();
      await cargarInsumos();
    } catch (err) {
      alert('Error al registrar merma: ' + err.message);
    }
  });
}

// --- CATÁLOGO DE PLATOS ---
async function cargarPlatosMenu() {
  if (!negocioId) return;
  const { data, error } = await db
    .from('products')
    .select('*')
    .eq('business_id', negocioId)
    .order('name');

  if (!error && data) {
    listaPlatos = data;
    renderizarTablaPlatos();
  }
}

function renderizarTablaPlatos() {
  if (!tablaPlatosCuerpo) return;
  tablaPlatosCuerpo.innerHTML = listaPlatos.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small style="color:#888;">${p.description || ''}</small></td>
      <td style="color:#fbbf24; font-weight:bold;">$${parseFloat(p.price).toFixed(2)}</td>
      <td>
        <button class="btn-toggle ${p.is_available ? 'activo' : 'pausado'}" onclick="toggleVisibilidadPlato('${p.id}', ${p.is_available})">
          ${p.is_available ? '● Activo en web' : '○ Pausado (Oculto)'}
        </button>
      </td>
      <td>
        <button class="btn-secundario" style="padding: 4px 8px; font-size:0.75rem; margin-right: 4px;" onclick="abrirModalReceta('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
          📝 Editar Receta
        </button>
        <button class="btn-peligro" onclick="eliminarPlato('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

window.toggleVisibilidadPlato = async function(id, estadoActual) {
  const { error } = await db
    .from('products')
    .update({ is_available: !estadoActual })
    .eq('id', id);

  if (error) {
    alert('Error al cambiar visibilidad: ' + error.message);
  } else {
    cargarPlatosMenu();
  }
};

window.eliminarPlato = async function(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}" del menú? Se desvincularán también sus recetas asociadas.`)) return;

  await db.from('product_ingredients').delete().eq('product_id', id);
  const { error } = await db.from('products').delete().eq('id', id);
  if (error) {
    alert('No se pudo eliminar el plato: ' + error.message);
  } else {
    cargarPlatosMenu();
  }
};

// --- GESTIÓN DE INSUMOS ---
async function cargarInsumos() {
  if (!negocioId) return;
  const { data, error } = await db
    .from('ingredients')
    .select('*')
    .eq('business_id', negocioId)
    .order('name');

  if (error) return console.error('Error al cargar insumos:', error);
  insumosDisponibles = data || [];
  renderizarTablaInsumos();
  actualizarSelectMermas();
}

function renderizarTablaInsumos() {
  if (!tablaInsumosCuerpo) return;
  tablaInsumosCuerpo.innerHTML = insumosDisponibles.map(insumo => {
    const bajoStock = parseFloat(insumo.current_stock) <= parseFloat(insumo.min_stock);
    const nombreLimpio = insumo.name.replace(/'/g, "\\'");
    return `
      <tr>
        <td><strong>${insumo.name}</strong></td>
        <td style="color: ${bajoStock ? '#ef4444' : '#10b981'}; font-weight:bold; font-size:1rem;">
          ${insumo.current_stock}
        </td>
        <td>${insumo.unit}</td>
        <td>${bajoStock ? '⚠️ Reponer stock' : '✅ Suficiente'}</td>
        <td>
          <button class="btn-secundario" style="padding: 4px 8px; font-size:0.75rem; margin-right: 4px;" onclick="sumarStock('${insumo.id}', '${nombreLimpio}', '${insumo.unit}')">
            + Añadir Existencias
          </button>
          <button class="btn-peligro" onclick="eliminarInsumo('${insumo.id}', '${nombreLimpio}')">
            Eliminar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.sumarStock = async function(id, nombre, unidad) {
  const cantidadStr = prompt(`¿Cuánta cantidad de "${nombre}" (${unidad}) compraste para sumar?`);
  const cantidad = parseFloat(cantidadStr);
  if (isNaN(cantidad) || cantidad <= 0) return;

  const actual = insumosDisponibles.find(i => i.id === id);
  const nuevoTotal = parseFloat(actual.current_stock) + cantidad;

  const { error } = await db.from('ingredients').update({ current_stock: nuevoTotal }).eq('id', id);
  if (!error) cargarInsumos();
};

window.eliminarInsumo = async function(id, nombre) {
  try {
    const { data: vinculos, error: errVinculos } = await db
      .from('product_ingredients')
      .select('product_id, products(name)')
      .eq('ingredient_id', id);

    if (errVinculos) throw errVinculos;

    if (vinculos && vinculos.length > 0) {
      const platosAfectados = vinculos.map(v => v.products ? v.products.name : 'Plato sin nombre').join(', ');
      const confirmar = confirm(
        `El insumo "${nombre}" forma parte de las recetas de los siguientes platos:\n` +
        `• ${platosAfectados}\n\n` +
        `Si lo eliminas, se quitará de esas recetas automáticamente. ¿Deseas continuar?`
      );
      if (!confirmar) return;

      const { error: errBorrarVinculos } = await db
        .from('product_ingredients')
        .delete()
        .eq('ingredient_id', id);

      if (errBorrarVinculos) throw errBorrarVinculos;
    } else {
      if (!confirm(`¿Estás seguro de eliminar el insumo "${nombre}" de tu inventario?`)) return;
    }

    const { error: errBorrarInsumo } = await db
      .from('ingredients')
      .delete()
      .eq('id', id);

    if (errBorrarInsumo) throw errBorrarInsumo;

    alert(`Insumo "${nombre}" eliminado exitosamente.`);
    await cargarInsumos();
  } catch (err) {
    alert('Error al eliminar el insumo: ' + err.message);
  }
};

// --- REGISTRAR NUEVO INSUMO ---
if (formNuevoInsumo) {
  formNuevoInsumo.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('insumo-nombre')?.value.trim();
    const unidad = document.getElementById('insumo-unidad')?.value;
    const stock = parseFloat(document.getElementById('insumo-stock')?.value);
    const minInput = document.getElementById('insumo-min') || document.getElementById('insumo-minimo');
    const minimo = parseFloat(minInput?.value) || 0;

    const { error } = await db.from('ingredients').insert([{
      business_id: negocioId,
      name: nombre,
      unit: unidad,
      current_stock: stock,
      min_stock: minimo
    }]);

    if (error) {
      alert('Error al registrar insumo: ' + error.message);
      return;
    }

    formNuevoInsumo.reset();
    await cargarInsumos();
  });
}

// --- ASOCIACIÓN DE RECETAS EN DOM (CREACIÓN) ---
const btnAgregarInsumoReceta = document.getElementById('btn-agregar-insumo-receta');
if (btnAgregarInsumoReceta) {
  btnAgregarInsumoReceta.addEventListener('click', () => {
    if (insumosDisponibles.length === 0) {
      alert('Primero debes registrar insumos en el inventario inferior.');
      return;
    }

    const contenedor = document.getElementById('contenedor-receta');
    if (!contenedor) return;

    const fila = document.createElement('div');
    fila.className = 'fila-receta';
    fila.style = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';

    const opciones = insumosDisponibles.map(i => `<option value="${i.id}">${i.name} (${i.unit})</option>`).join('');

    fila.innerHTML = `
      <select class="receta-insumo-id" style="flex: 2; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;">
        ${opciones}
      </select>
      <input type="number" step="0.01" min="0.01" class="receta-cantidad" placeholder="Cant. por ración" required style="flex: 1; padding: 6px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px;" />
      <button type="button" onclick="this.parentElement.remove()" style="background: #991b1b; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer;">✕</button>
    `;
    contenedor.appendChild(fila);
  });
}

// --- CREAR PLATO CON SU FOTO Y RECETA ---
if (formNuevoPlato) {
  formNuevoPlato.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = document.getElementById('btn-submit-plato') || formNuevoPlato.querySelector('button[type="submit"]');
    const inputFoto = document.getElementById('plato-foto');
    const archivoFoto = inputFoto?.files[0];

    if (!archivoFoto) {
      alert('Debes subir una foto para el plato obligatoriamente.');
      return;
    }

    const nombre = document.getElementById('plato-nombre').value.trim();
    const precio = parseFloat(document.getElementById('plato-precio').value);
    const descripcion = document.getElementById('plato-desc').value.trim();

    btnSubmit.disabled = true;
    btnSubmit.innerText = 'Subiendo foto y guardando...';

    try {
      const extension = archivoFoto.name.split('.').pop();
      const nombreArchivo = `${negocioId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;

      const { error: uploadError } = await db.storage
        .from('platos')
        .upload(nombreArchivo, archivoFoto, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw new Error('Error al subir la imagen: ' + uploadError.message);

      const { data: urlData } = db.storage
        .from('platos')
        .getPublicUrl(nombreArchivo);

      const imageUrl = urlData.publicUrl;

      const { data: plato, error: errPlato } = await db
        .from('products')
        .insert([{
          business_id: negocioId,
          name: nombre,
          price: precio,
          description: descripcion,
          image_url: imageUrl,
          is_available: true
        }])
        .select()
        .single();

      if (errPlato) throw errPlato;

      const filasReceta = document.querySelectorAll('#contenedor-receta .fila-receta');
      const asociaciones = [];

      filasReceta.forEach(f => {
        const ingredient_id = f.querySelector('.receta-insumo-id')?.value;
        const quantity_required = parseFloat(f.querySelector('.receta-cantidad')?.value);
        if (ingredient_id && quantity_required > 0) {
          asociaciones.push({
            product_id: plato.id,
            ingredient_id: ingredient_id,
            quantity_required: quantity_required
          });
        }
      });

      if (asociaciones.length > 0) {
        const { error: errReceta } = await db.from('product_ingredients').insert(asociaciones);
        if (errReceta) console.error('Error al asociar ingredientes:', errReceta);
      }

      alert(`¡Plato "${nombre}" con foto publicado con éxito!`);
      formNuevoPlato.reset();
      const contenedor = document.getElementById('contenedor-receta');
      if (contenedor) contenedor.innerHTML = '';
      cargarPlatosMenu();

    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerText = 'Guardar y Publicar Plato';
    }
  });
}

// --- MODAL: EDITAR / REEMPLAZAR RECETAS DE UN PLATO EXISTENTE ---
window.abrirModalReceta = async function(platoId, platoNombre) {
  platoEditandoId = platoId;
  modalRecetaTitulo.innerText = `Editar Receta: ${platoNombre}`;
  modalListaInsumos.innerHTML = '<p style="color:#888;">Cargando ingredientes...</p>';
  modalReceta.style.display = 'flex';

  try {
    const { data: recetaActual, error } = await db
      .from('product_ingredients')
      .select('id, ingredient_id, quantity_required')
      .eq('product_id', platoId);

    if (error) throw error;

    modalListaInsumos.innerHTML = '';

    if (!recetaActual || recetaActual.length === 0) {
      modalListaInsumos.innerHTML = '<p class="alerta" style="margin: 0 0 10px 0;">Este plato no tiene receta asociada aún.</p>';
    } else {
      recetaActual.forEach(item => {
        agregarFilaRecetaModal(item.ingredient_id, item.quantity_required);
      });
    }
  } catch (err) {
    modalListaInsumos.innerHTML = `<p class="alerta">Error: ${err.message}</p>`;
  }
};

window.cerrarModalReceta = function() {
  modalReceta.style.display = 'none';
  platoEditandoId = null;
  modalListaInsumos.innerHTML = '';
};

window.agregarFilaRecetaModal = function(insumoSeleccionado = '', cantidad = '') {
  if (insumosDisponibles.length === 0) {
    alert('No hay insumos registrados en el inventario.');
    return;
  }

  const alerta = modalListaInsumos.querySelector('.alerta');
  if (alerta) alerta.remove();

  const fila = document.createElement('div');
  fila.className = 'fila-receta-modal';
  fila.style = 'display: flex; gap: 8px; align-items: center;';

  const opciones = insumosDisponibles.map(i => `
    <option value="${i.id}" ${i.id === insumoSeleccionado ? 'selected' : ''}>
      ${i.name} (${i.unit})
    </option>
  `).join('');

  fila.innerHTML = `
    <select class="modal-insumo-id" style="flex: 2; padding: 6px; background: #262626; color: #fff; border: 1px solid #444; border-radius: 4px;">
      ${opciones}
    </select>
    <input type="number" step="0.01" min="0.01" value="${cantidad}" class="modal-insumo-cantidad" placeholder="Cant. ración" required style="flex: 1; padding: 6px; background: #262626; color: #fff; border: 1px solid #444; border-radius: 4px;" />
    <button type="button" onclick="this.parentElement.remove()" style="background: #991b1b; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer;">✕</button>
  `;

  modalListaInsumos.appendChild(fila);
};

window.guardarRecetaModificada = async function() {
  if (!platoEditandoId) return;

  const btnGuardar = document.getElementById('btn-guardar-receta-modal');
  btnGuardar.disabled = true;
  btnGuardar.innerText = 'Guardando...';

  const filas = modalListaInsumos.querySelectorAll('.fila-receta-modal');
  const nuevasAsociaciones = [];

  filas.forEach(f => {
    const ingredient_id = f.querySelector('.modal-insumo-id')?.value;
    const quantity_required = parseFloat(f.querySelector('.modal-insumo-cantidad')?.value);
    if (ingredient_id && quantity_required > 0) {
      nuevasAsociaciones.push({
        product_id: platoEditandoId,
        ingredient_id: ingredient_id,
        quantity_required: quantity_required
      });
    }
  });

  try {
    const { error: errDelete } = await db
      .from('product_ingredients')
      .delete()
      .eq('product_id', platoEditandoId);

    if (errDelete) throw errDelete;

    if (nuevasAsociaciones.length > 0) {
      const { error: errInsert } = await db
        .from('product_ingredients')
        .insert(nuevasAsociaciones);

      if (errInsert) throw errInsert;
    }

    alert('¡Receta actualizada con éxito!');
    cerrarModalReceta();
  } catch (err) {
    alert('Error al actualizar la receta: ' + err.message);
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.innerText = 'Guardar Cambios';
  }
};

// --- DASHBOARD FINANCIERO ---
window.filtrarPeriodo = function(periodo, boton) {
  periodoSeleccionado = periodo;
  document.querySelectorAll('.btn-filtro').forEach(btn => btn.classList.remove('activo'));
  boton.classList.add('activo');
  procesarMetricasYGrafica();
};

async function cargarDashboardFinanciero() {
  if (!negocioId) return;
  const { data: ordenes, error } = await db
    .from('orders')
    .select('id, total, subtotal_food, status, created_at')
    .eq('business_id', negocioId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true });

  if (!error && ordenes) {
    pedidosHistoricos = ordenes;
    procesarMetricasYGrafica();
  }
}

function procesarMetricasYGrafica() {
  const ahora = new Date();
  let totalFacturado = 0;
  let conteoPedidos = 0;
  const gruposGrafica = {};

  pedidosHistoricos.forEach(orden => {
    const fOrden = new Date(orden.created_at);
    let entraEnPeriodo = false;
    let etiquetaEjeX = '';

    if (periodoSeleccionado === 'dia') {
      entraEnPeriodo = fOrden.toDateString() === ahora.toDateString();
      etiquetaEjeX = `${fOrden.getHours().toString().padStart(2, '0')}:00`;
    } else if (periodoSeleccionado === 'mes') {
      entraEnPeriodo = fOrden.getMonth() === ahora.getMonth() && fOrden.getFullYear() === ahora.getFullYear();
      etiquetaEjeX = `Día ${fOrden.getDate()}`;
    } else if (periodoSeleccionado === 'ano') {
      entraEnPeriodo = fOrden.getFullYear() === ahora.getFullYear();
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      etiquetaEjeX = meses[fOrden.getMonth()];
    }

    if (entraEnPeriodo) {
      const tot = parseFloat(orden.subtotal_food || orden.total) || 0;
      totalFacturado += tot;
      conteoPedidos++;
      gruposGrafica[etiquetaEjeX] = (gruposGrafica[etiquetaEjeX] || 0) + tot;
    }
  });

  const kpiTotal = document.getElementById('kpi-total');
  const kpiPedidos = document.getElementById('kpi-pedidos');
  if (kpiTotal) kpiTotal.textContent = `$${totalFacturado.toFixed(2)}`;
  if (kpiPedidos) kpiPedidos.textContent = conteoPedidos;

  renderizarGrafica(Object.keys(gruposGrafica), Object.values(gruposGrafica));
}

function renderizarGrafica(etiquetas, datos) {
  const ctx = document.getElementById('graficaVentas');
  if (!ctx) return;

  if (ventasChartInstance) ventasChartInstance.destroy();

  ventasChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: etiquetas.length ? etiquetas : ['Sin ventas en este período'],
      datasets: [{
        label: 'Ventas Comida ($)',
        data: datos.length ? datos : [0],
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: '#fbbf24'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
        y: { ticks: { color: '#888', callback: v => `$${v}` }, grid: { color: '#2a2a2a' }, beginAtZero: true }
      }
    }
  });
}

function suscribirTiempoReal() {
  if (!negocioId) return;
  db.channel('cocina-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'orders',
      filter: `business_id=eq.${negocioId}`
    }, (payload) => {
      if (payload.eventType === 'INSERT') {
        dispararNotificacionNuevaOrden(payload.new);
      }
      cargarPedidos();
      cargarDashboardFinanciero();
      cargarBalanceCorteTurno();
    })
    .subscribe();
}

// =========================================================================
// INICIALIZACIÓN CON GUARDIA DE ACCESO
// =========================================================================
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session || !session.user) {
    window.location.href = 'portal.html';
    return;
  }
  await inicializarSesion(session.user);
})();