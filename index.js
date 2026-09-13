// Vigila el stock de uno o varios dispositivos en movistar.es y avisa por Telegram.
// Se maneja desde el propio chat con botones. Sin dependencias: fetch es nativo de Node >= 18.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const FUENTE = process.env.SOURCE_URL || null;
const ESTADO = new URL('./state.json', import.meta.url);
const AJUSTES = new URL('./config.json', import.meta.url);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const log = (...args) => console.log(new Date().toLocaleString('es-ES'), '·', ...args);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

// Telegram rechaza el mensaje ENTERO si el HTML está mal formado, así que cualquier
// texto que venga de la configuración se escapa antes de meterlo en el mensaje.
const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function duracion(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

// ─────────────────────────────  Objetivos y ajustes  ─────────────────────────────

// Formato de TARGETS: objetivos separados por ";", cada uno "Nombre | término,término | url".
export function leerObjetivos(texto) {
  return (texto || '')
    .split(';')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const [nombre, terminos, url] = linea.split('|').map((p) => p.trim());
      if (!nombre || !terminos || !url) throw new Error(`Objetivo mal escrito en TARGETS: "${linea}"`);
      const lista = terminos.split(',').map((t) => t.trim()).filter(Boolean);
      const modalidad = process.env.PRODUCT_VARIANT || (lista.some((t) => t.endsWith('-fusion')) ? 'Movistar Swap' : '');
      return { nombre, terminos: lista, url, modalidad, clave: lista.join('+') };
    });
}

// Los ajustes viven en config.json para poder cambiarlos desde el chat.
// La primera vez se siembran con lo que haya en el .env.
function cargarAjustes() {
  if (existsSync(AJUSTES)) {
    try {
      const guardados = JSON.parse(readFileSync(AJUSTES, 'utf8'));
      if (Array.isArray(guardados.objetivos)) return guardados;
    } catch (err) {
      log('config.json ilegible, se reconstruye desde el .env:', err.message);
    }
  }
  return {
    objetivos: leerObjetivos(process.env.TARGETS),
    minutos: Number(process.env.CHECK_MINUTES || 30),
    pausado: false,
  };
}

const ajustes = cargarAjustes();

function guardarAjustes() {
  escribirAtomico(AJUSTES, ajustes);
}

// ─────────────────────────────  Estado persistente  ─────────────────────────────

function escribirAtomico(destino, datos) {
  // Se escribe aparte y se renombra: un corte de luz a media escritura dejaría un
  // archivo truncado, y al no poder leerlo el bot repetiría avisos ya dados.
  const temporal = new URL(`${destino.pathname.split('/').pop()}.tmp`, destino);
  writeFileSync(temporal, JSON.stringify(datos, null, 2));
  renameSync(temporal, destino);
}

function leerEstado() {
  try {
    return JSON.parse(readFileSync(ESTADO, 'utf8'));
  } catch {
    return { objetivos: {} };
  }
}

const guardarEstado = (estado) => escribirAtomico(ESTADO, estado);

// ─────────────────────────────  Lectura del catálogo  ─────────────────────────────

// El HTML del producto lleva incrustado un JSON con "stock":N,"alias":"sku_modelo_color_capacidad_modalidad".
// Devuelve las unidades de las variantes cuyo alias contiene todos los términos buscados.
export function extraerStock(html, terminos) {
  const encontrados = [];
  const re = /"stock":(\d+),"alias":"([^"]+)"/g;
  for (const [, unidades, alias] of html.matchAll(re)) {
    if (terminos.every((t) => alias.toLowerCase().includes(t.toLowerCase()))) {
      encontrados.push({ alias, unidades: Number(unidades) });
    }
  }
  return encontrados;
}

// Desmonta el alias en modelo, color y capacidad para poder construir los menús
// con las combinaciones que existen de verdad, en vez de con una lista inventada.
export function extraerVariantes(html) {
  const variantes = new Map();
  const re = /"stock":(\d+),"alias":"\d+_([a-z0-9-]+)_([a-z0-9-]+)_(\d+GB)_([a-z_]+)"/g;
  for (const [, stock, modelo, color, capacidad, resto] of html.matchAll(re)) {
    const clave = `${modelo}|${color}|${capacidad}`;
    const previo = variantes.get(clave);
    variantes.set(clave, {
      modelo,
      color,
      capacidad,
      swap: modelo.endsWith('-fusion'),
      unidades: Math.max(previo?.unidades ?? 0, Number(stock)),
      resto,
    });
  }
  return [...variantes.values()];
}

// El color del alias no coincide con el de la url (azul -> azulglacial), así que el
// enlace de compra se busca entre las urls que la propia página ya trae.
export function urlDeVariante(html, variante, respaldo) {
  const base = variante.modelo.replace(/-fusion$/, '');
  const slugs = [...new Set([...html.matchAll(/\/moviles\/(apple-iphone-[a-z0-9-]+)\//g)].map((m) => m[1]))];
  const prefijo = `apple-${base}-${variante.capacidad.toLowerCase()}-`;
  const colorPlano = variante.color.replace(/-/g, '');
  const encontrado = slugs.find((s) => s.startsWith(prefijo) && s.slice(prefijo.length).startsWith(colorPlano));
  return encontrado ? `https://www.movistar.es/moviles/${encontrado}/` : respaldo;
}

const bonito = (modelo) =>
  modelo
    .replace(/-fusion$/, '')
    .split('-')
    .map((p) => (p === 'iphone' ? 'iPhone' : /^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');

const colorBonito = (color) =>
  color.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

const nombreDeVariante = (v) =>
  `${bonito(v.modelo)} ${v.capacidad.replace('GB', ' GB')} ${colorBonito(v.color)}${v.swap ? '' : ' (compra)'}`;

// ─────────────────────────────  Datos en memoria  ─────────────────────────────

const arranque = Date.now();
const info = {
  comprobaciones: 0,
  errores: 0,
  ultimoError: null,
  ultimaComprobacion: null,
  proxima: null,
  lecturas: {},
  fallosSeguidos: 0,
  avisadoDeCaida: false,
  historial: [], // Solo los últimos HISTORIAL intentos; lo viejo no sirve para nada.
};

export const HISTORIAL = 10;

// Tras este numero de fallos seguidos se avisa de que el vigilante esta ciego.
// A 3 min por ronda son unos 15 minutos de silencio antes de dar la voz.
export const FALLOS_PARA_AVISAR = 5;

// El silencio del bot es identico a "no hay stock", asi que una caida prolongada
// tiene que avisarse igual que el stock: si no, esperarias un aviso que no llegara.
export function decidirAvisoDeCaida({ hayFallo, fallosSeguidos, avisado, umbral = FALLOS_PARA_AVISAR }) {
  if (hayFallo) return !avisado && fallosSeguidos >= umbral ? 'caida' : null;
  return avisado ? 'recuperado' : null;
}

export function anotar(resumen) {
  info.historial.push({ cuando: new Date(), resumen });
  if (info.historial.length > HISTORIAL) info.historial.shift();
}

// Última página descargada, para que los menús no vuelvan a pedirla en cada toque.
let cache = { html: null, cuando: 0 };

async function catalogo() {
  if (cache.html && Date.now() - cache.cuando < 5 * 60_000) return cache.html;
  const html = await descargar(FUENTE ?? ajustes.objetivos[0]?.url);
  cache = { html, cuando: Date.now() };
  return html;
}

// ─────────────────────────────  Informe  ─────────────────────────────

export function informe() {
  const estado = leerEstado();
  const lineas = [ajustes.pausado ? '⏸️ <b>Vigilante en pausa</b>' : '🟢 <b>Vigilante operativo</b>', ''];

  if (info.ultimaComprobacion) {
    lineas.push('📦 <b>Última lectura</b>');
    for (const objetivo of ajustes.objetivos) {
      const lectura = info.lecturas[objetivo.clave];
      if (!lectura) {
        lineas.push(`   ⚠️ ${escapar(objetivo.nombre)} — sin datos`);
      } else if (lectura.unidades > 0) {
        lineas.push(`   ✅ <b>${escapar(objetivo.nombre)} — ${lectura.unidades} uds.</b>`);
      } else {
        lineas.push(`   ❌ ${escapar(objetivo.nombre)} — agotado`);
      }
    }
    lineas.push(
      '',
      `🕐 Comprobado: ${hora(info.ultimaComprobacion)} (hace ${duracion(Date.now() - info.ultimaComprobacion)})`,
      ajustes.pausado ? '⏭ Próxima: en pausa' : `⏭ Próxima: ~${hora(info.proxima)}`
    );
  } else {
    lineas.push('📦 Estado: aún sin datos, primera comprobación en curso.');
  }

  const avisados = ajustes.objetivos.filter((o) => estado.objetivos?.[o.clave]?.hayStock).length;
  const aviso =
    avisados === 0
      ? `armado para ${ajustes.objetivos.length} modelo(s)`
      : `${avisados} ya avisado(s), se rearma al agotarse`;

  lineas.push(
    '',
    `🔁 Cada ${ajustes.minutos} min · ${info.comprobaciones} comprobaciones · ${info.errores} errores`,
    `🔔 Aviso: ${aviso}`,
    `⏱ En marcha desde ${hora(new Date(arranque))} (${duracion(Date.now() - arranque)})`,
    `🖥 Servidor: ${hostname()}`
  );

  if (info.historial.length > 0) {
    lineas.push('', `🧾 <b>Últimos ${info.historial.length} intentos</b>`);
    for (const intento of [...info.historial].reverse()) {
      lineas.push(`   ${hora(intento.cuando)} — ${escapar(intento.resumen)}`);
    }
  }

  if (info.fallosSeguidos > 0) lineas.push('', `⚠️ ${info.fallosSeguidos} fallo(s) seguidos sin poder leer la web`);
  if (info.ultimoError) lineas.push('', `⚠️ Último error: ${escapar(info.ultimoError)}`);
  for (const objetivo of ajustes.objetivos) {
    lineas.push('', `👉 <a href="${escapar(objetivo.url)}">${escapar(objetivo.nombre)}</a>`);
  }
  return lineas.join('\n');
}

// ─────────────────────────────  Telegram  ─────────────────────────────

// Teclado fijo bajo la caja de texto: no se va con el scroll, siempre a un toque.
// Telegram solo admite un reply_markup por mensaje, asi que este va en los informes
// y el teclado inline (el que navega entre pantallas) va en el menu.
const TECLADO_FIJO = {
  keyboard: [[{ text: '⚙️ Ajustes' }, { text: '📊 Estado' }]],
  resize_keyboard: true,
  is_persistent: true,
};

// getUpdates deja la conexion abierta esperando mensajes, asi que necesita mas margen
// que el resto: con el limite corto se abortaba sola cada 30 s y dejaba huecos sin escuchar.
async function api(metodo, cuerpo, limiteMs = 30_000) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(limiteMs),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${metodo}: ${data.description}`);
  return data.result;
}

// conVista solo en el aviso de stock: ahi la miniatura del producto ayuda. En el informe
// hay varios enlaces y Telegram elige uno al azar, que puede ser de otro color y confundir.
const telegram = (texto, teclado, conVista = false) =>
  api('sendMessage', {
    chat_id: CHAT,
    text: texto,
    parse_mode: 'HTML',
    disable_web_page_preview: !conVista,
    reply_markup: teclado ? { inline_keyboard: teclado } : TECLADO_FIJO,
  });

// Al editar el mensaje en vez de mandar uno nuevo, el menú no llena el chat.
async function editar(chatId, messageId, texto, teclado) {
  try {
    await api('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: texto,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: teclado ?? [] },
    });
  } catch (err) {
    // Telegram da error si el contenido es idéntico al que ya había; no es un fallo real.
    if (!/message is not modified/i.test(err.message)) throw err;
  }
}

// ─────────────────────────────  Pantallas del menú  ─────────────────────────────

const boton = (text, callback_data) => ({ text, callback_data });


function pantallaMenu() {
  const texto = [
    '⚙️ <b>Ajustes del vigilante</b>',
    '',
    `📋 ${ajustes.objetivos.length} modelo(s) vigilados`,
    `⏱️ Comprobando cada ${ajustes.minutos} min`,
    ajustes.pausado ? '⏸️ En pausa' : '🟢 En marcha',
  ].join('\n');
  const teclado = [
    [boton('📋 Objetivos', 'objs'), boton('➕ Añadir', 'add')],
    [boton('⏱️ Frecuencia', 'int'), boton(ajustes.pausado ? '▶️ Reanudar' : '⏸️ Pausar', 'pause')],
    [boton('📊 Estado ahora', 'estado')],
  ];
  return { texto, teclado };
}

function pantallaObjetivos() {
  if (ajustes.objetivos.length === 0) {
    return {
      texto: '📋 <b>Objetivos</b>\n\nNo hay ninguno. Añade uno para empezar a vigilar.',
      teclado: [[boton('➕ Añadir', 'add')], [boton('⬅️ Volver', 'menu')]],
    };
  }
  const texto = [
    '📋 <b>Objetivos vigilados</b>',
    '',
    'Toca 🗑️ para dejar de vigilar uno.',
  ].join('\n');
  const teclado = ajustes.objetivos.map((o) => {
    const lectura = info.lecturas[o.clave];
    const marca = !lectura ? '⚠️' : lectura.unidades > 0 ? `✅ ${lectura.unidades}` : '❌';
    return [boton(`${marca} ${o.nombre}`, 'nada'), boton('🗑️', `del:${o.clave}`)];
  });
  teclado.push([boton('➕ Añadir', 'add')], [boton('⬅️ Volver', 'menu')]);
  return { texto, teclado };
}

// Las tres pantallas de alta salen del catálogo real: solo se ofrecen combinaciones
// que existen, así que es imposible acabar vigilando un modelo fantasma.
function pantallaAlta(variantes, modelo, color) {
  const filas = (botones, porFila) => {
    const salida = [];
    for (let i = 0; i < botones.length; i += porFila) salida.push(botones.slice(i, i + porFila));
    return salida;
  };

  if (!modelo) {
    const modelos = [...new Set(variantes.map((v) => v.modelo))].sort((a, b) => b.localeCompare(a));
    return {
      texto: '➕ <b>Añadir objetivo</b>\n\n1 de 3 — elige el modelo:',
      teclado: [
        ...filas(modelos.map((m) => boton(`${bonito(m)}${m.endsWith('-fusion') ? ' · Swap' : ' · compra'}`, `add:${m}`)), 2),
        [boton('⬅️ Volver', 'menu')],
      ],
    };
  }

  if (!color) {
    const colores = [...new Set(variantes.filter((v) => v.modelo === modelo).map((v) => v.color))];
    return {
      texto: `➕ <b>${escapar(bonito(modelo))}</b>\n\n2 de 3 — elige el color:`,
      teclado: [
        ...filas(colores.map((c) => boton(colorBonito(c), `add:${modelo}:${c}`)), 2),
        [boton('⬅️ Volver', 'add')],
      ],
    };
  }

  const capacidades = variantes.filter((v) => v.modelo === modelo && v.color === color);
  return {
    texto: `➕ <b>${escapar(bonito(modelo))} ${escapar(colorBonito(color))}</b>\n\n3 de 3 — elige la capacidad:`,
    teclado: [
      ...filas(
        capacidades.map((v) =>
          boton(
            `${v.capacidad.replace('GB', ' GB')}${v.unidades > 0 ? ` · ✅ ${v.unidades}` : ' · ❌'}`,
            `add:${modelo}:${color}:${v.capacidad}`
          )
        ),
        2
      ),
      [boton('⬅️ Volver', `add:${modelo}`)],
    ],
  };
}

function pantallaFrecuencia() {
  const opciones = [1, 3, 5, 10, 30, 60];
  return {
    texto: [
      '⏱️ <b>Frecuencia de comprobación</b>',
      '',
      `Ahora: cada ${ajustes.minutos} min`,
      '',
      'Cada ronda baja ~1 MB. A 3 min son unos 480 MB al día.',
    ].join('\n'),
    teclado: [
      opciones.map((m) => boton(`${m === ajustes.minutos ? '• ' : ''}${m} min`, `int:${m}`)),
      [boton('⬅️ Volver', 'menu')],
    ],
  };
}

// ─────────────────────────────  Router de botones  ─────────────────────────────

async function pulsacion(query) {
  const datos = query.data ?? '';
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  let aviso = null;
  let pantalla;

  if (datos === 'nada') {
    await api('answerCallbackQuery', { callback_query_id: query.id });
    return;
  }

  if (datos === 'estado') {
    await api('answerCallbackQuery', { callback_query_id: query.id, text: 'Consultando a Movistar…' });
    await ciclo({ programada: false });
    await telegram(informe());
    return;
  }

  if (datos === 'menu') {
    pantalla = pantallaMenu();
  } else if (datos === 'objs') {
    pantalla = pantallaObjetivos();
  } else if (datos === 'int') {
    pantalla = pantallaFrecuencia();
  } else if (datos.startsWith('int:')) {
    const minutos = Number(datos.slice(4));
    if (Number.isFinite(minutos) && minutos >= 1) {
      ajustes.minutos = minutos;
      guardarAjustes();
      reprogramar();
      aviso = `Cada ${minutos} min`;
    }
    pantalla = pantallaFrecuencia();
  } else if (datos === 'pause') {
    ajustes.pausado = !ajustes.pausado;
    guardarAjustes();
    reprogramar();
    aviso = ajustes.pausado ? 'En pausa' : 'Vigilando de nuevo';
    pantalla = pantallaMenu();
  } else if (datos.startsWith('del:')) {
    const clave = datos.slice(4);
    const fuera = ajustes.objetivos.find((o) => o.clave === clave);
    ajustes.objetivos = ajustes.objetivos.filter((o) => o.clave !== clave);
    delete info.lecturas[clave];
    guardarAjustes();
    aviso = fuera ? `Quitado: ${fuera.nombre}` : 'Ya no estaba';
    pantalla = pantallaObjetivos();
  } else if (datos === 'add' || datos.startsWith('add:')) {
    const [, modelo, color, capacidad] = datos.split(':');
    const html = await catalogo();
    const variantes = extraerVariantes(html);

    if (capacidad) {
      const variante = variantes.find(
        (v) => v.modelo === modelo && v.color === color && v.capacidad === capacidad
      );
      if (!variante) {
        aviso = 'Esa combinación ya no existe';
        pantalla = pantallaObjetivos();
      } else {
        const terminos = [variante.modelo, variante.color, variante.capacidad];
        const clave = terminos.join('+');
        if (ajustes.objetivos.some((o) => o.clave === clave)) {
          aviso = 'Ya lo estabas vigilando';
        } else {
          ajustes.objetivos.push({
            nombre: nombreDeVariante(variante),
            terminos,
            url: urlDeVariante(html, variante, FUENTE ?? ''),
            modalidad: variante.swap ? 'Movistar Swap' : 'Compra directa',
            clave,
          });
          guardarAjustes();
          aviso = `Añadido: ${nombreDeVariante(variante)}`;
          log(`➕ Objetivo añadido desde Telegram: ${clave}`);
        }
        pantalla = pantallaObjetivos();
      }
    } else {
      pantalla = pantallaAlta(variantes, modelo, color);
    }
  } else {
    pantalla = pantallaMenu();
  }

  await api('answerCallbackQuery', { callback_query_id: query.id, ...(aviso ? { text: aviso } : {}) });
  if (pantalla && chatId && messageId) await editar(chatId, messageId, pantalla.texto, pantalla.teclado);
}

// ─────────────────────────────  Vigilancia  ─────────────────────────────

async function descargar(url) {
  // Sin límite de tiempo, una conexión colgada dejaría el vigilante congelado sin que se note.
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return res.text();
}

async function comprobar() {
  // Cualquier ficha de Movistar lleva el catálogo entero en su JSON, así que con SOURCE_URL
  // basta una descarga para todos los objetivos; su url queda solo como enlace de compra.
  const paginas = new Map();
  const fuentes = FUENTE ? [FUENTE] : [...new Set(ajustes.objetivos.map((o) => o.url))];
  for (const url of fuentes) paginas.set(url, await descargar(url));
  const html = (objetivo) => paginas.get(FUENTE ?? objetivo.url);
  cache = { html: paginas.get(fuentes[0]), cuando: Date.now() };

  const estado = leerEstado();
  estado.objetivos ??= {};

  for (const objetivo of ajustes.objetivos) {
    const previo = estado.objetivos[objetivo.clave] ?? { hayStock: false, avisadoSinCoincidencias: false };
    const variantes = extraerStock(html(objetivo), objetivo.terminos);

    if (variantes.length === 0) {
      log(`⚠️  ${objetivo.nombre}: ninguna variante coincide. ¿Ha cambiado la web?`);
      delete info.lecturas[objetivo.clave];
      if (!previo.avisadoSinCoincidencias) {
        await telegram(
          `⚠️ <b>El vigilante no encuentra un producto</b>\n${escapar(objetivo.nombre)}\nNo hay variantes que coincidan con: <code>${escapar(objetivo.terminos.join(', '))}</code>\n${escapar(objetivo.url)}`
        );
        estado.objetivos[objetivo.clave] = { ...previo, avisadoSinCoincidencias: true };
        guardarEstado(estado);
      }
      continue;
    }

    const unidades = Math.max(...variantes.map((v) => v.unidades));
    const hayStock = unidades > 0;
    const cambio = previo.unidades !== unidades;
    info.lecturas[objetivo.clave] = { unidades, alias: variantes[0].alias };
    // Al log del sistema solo van los cambios: si nada se mueve, no se escribe nada.
    if (cambio) log(hayStock ? `✅ HAY STOCK (${unidades} uds.)` : '❌ Agotado', '·', variantes[0].alias);

    if (hayStock && !previo.hayStock) {
      await telegram(
        `🚨 <b>¡YA HAY STOCK!</b>\n${escapar(objetivo.nombre)}\n${unidades} unidades disponibles\n\n👉 <a href="${escapar(objetivo.url)}">Enlace directo para comprarlo</a>`,
        undefined,
        true
      );
      log(`📨 Aviso enviado: ${objetivo.nombre}`);
    } else if (!hayStock && previo.hayStock) {
      log(`${objetivo.nombre}: vuelve a estar agotado, se rearma el aviso.`);
    }

    estado.objetivos[objetivo.clave] = { hayStock, unidades, avisadoSinCoincidencias: false };
    // Se guarda objetivo a objetivo: si el siguiente falla, lo ya avisado no se repite.
    guardarEstado(estado);
  }

  estado.ultimaComprobacion = new Date().toISOString();
  guardarEstado(estado);

  const conStock = ajustes.objetivos.filter((o) => info.lecturas[o.clave]?.unidades > 0);
  anotar(
    conStock.length === 0
      ? 'todo agotado'
      : conStock.map((o) => `${o.nombre}: ${info.lecturas[o.clave].unidades}`).join(', ')
  );
}

// Candado: la ronda automática y una consulta tuya por Telegram pueden coincidir.
// Sin esto, dos comprobaciones a la vez leerían el mismo estado y podrían avisarte dos veces.
let enCurso = null;

function ciclo(opciones) {
  if (enCurso) return enCurso;
  enCurso = ejecutarCiclo(opciones).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

// programada = false cuando la comprobación la pides tú por Telegram;
// esas no mueven la hora de la siguiente ronda automática.
async function ejecutarCiclo({ programada = true } = {}) {
  if (programada && ajustes.pausado) return;
  if (ajustes.objetivos.length === 0) return;
  info.comprobaciones += 1;
  info.ultimaComprobacion = new Date();
  if (programada) info.proxima = new Date(Date.now() + ajustes.minutos * 60_000);
  let fallo = null;
  try {
    await comprobar();
    info.ultimoError = null;
    info.fallosSeguidos = 0;
  } catch (err) {
    fallo = err;
    info.errores += 1;
    info.fallosSeguidos += 1;
    info.ultimoError = `${err.message} (${hora(new Date())})`;
    anotar(`error: ${err.message}`);
    log('Error en la comprobación:', err.message, '— se reintentará en el siguiente ciclo.');
  }

  const decision = decidirAvisoDeCaida({
    hayFallo: Boolean(fallo),
    fallosSeguidos: info.fallosSeguidos,
    avisado: info.avisadoDeCaida,
  });
  if (!decision) return;

  try {
    if (decision === 'caida') {
      await telegram(
        [
          '⚠️ <b>El vigilante no puede leer la web</b>',
          `${info.fallosSeguidos} intentos fallidos seguidos.`,
          `Último error: <code>${escapar(fallo.message)}</code>`,
          '',
          'Sigue intentándolo. Te aviso en cuanto vuelva.',
        ].join('\n')
      );
      info.avisadoDeCaida = true;
      log('📨 Aviso de caída enviado.');
    } else {
      await telegram('✅ <b>El vigilante vuelve a leer la web</b>\nLa vigilancia continúa con normalidad.');
      info.avisadoDeCaida = false;
      log('📨 Aviso de recuperación enviado.');
    }
  } catch (err) {
    // Si el que falla es Telegram, no se marca como avisado: se reintenta en la siguiente ronda.
    log('No se pudo enviar el aviso de estado:', err.message);
  }
}

let temporizador = null;

function reprogramar() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
  if (ajustes.pausado) {
    log('Vigilancia en pausa.');
    return;
  }
  // Margen aleatorio (como mucho un 20% del intervalo) para no golpear la web siempre igual.
  const margen = Math.min(180_000, ajustes.minutos * 60_000 * 0.2);
  temporizador = setInterval(ciclo, ajustes.minutos * 60_000 + Math.random() * margen);
  info.proxima = new Date(Date.now() + ajustes.minutos * 60_000);
  log(`Comprobando cada ${ajustes.minutos} min.`);
}

// ─────────────────────────────  Escucha de Telegram  ─────────────────────────────

async function escucharTelegram() {
  let offset = 0;
  for (;;) {
    try {
      const ESCUCHA_S = 50;
      const actualizaciones = await api('getUpdates', { timeout: ESCUCHA_S, offset }, (ESCUCHA_S + 20) * 1000);
      for (const update of actualizaciones) {
        offset = update.update_id + 1;

        if (update.callback_query) {
          // Solo obedece al chat configurado; a cualquier otro lo ignora.
          if (String(update.callback_query.message?.chat?.id) !== String(CHAT)) continue;
          await pulsacion(update.callback_query);
          continue;
        }

        const mensaje = update.message ?? update.edited_message;
        if (!mensaje?.chat || String(mensaje.chat.id) !== String(CHAT)) continue;
        const texto = (mensaje.text ?? '').trim();

        // "⚙️ Ajustes" del teclado fijo, /ajustes o /start abren el menú.
        if (texto.startsWith('⚙️') || /^\/(start|ajustes|menu)/i.test(texto)) {
          const pantalla = pantallaMenu();
          await telegram(pantalla.texto, pantalla.teclado);
          continue;
        }

        log('Consulta de estado recibida.');
        // "Escribiendo..." mientras se consulta a Movistar, para que no parezca colgado.
        api('sendChatAction', { chat_id: mensaje.chat.id, action: 'typing' }).catch(() => {});
        // Se consulta el stock en el momento, salvo que se acabe de mirar.
        if (!info.ultimaComprobacion || Date.now() - info.ultimaComprobacion > 20_000) {
          await ciclo({ programada: false });
        }
        await telegram(informe());
      }
    } catch (err) {
      log('Escucha de Telegram:', err.message, '— reintento en 15 s.');
      await espera(15_000);
    }
  }
}

// ─────────────────────────────  Arranque  ─────────────────────────────

// Solo arranca el vigilante al ejecutar este archivo; al importarlo (test.js) no hace nada.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!TOKEN || !CHAT) {
    console.error('Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el archivo .env');
    process.exit(1);
  }
  // Un valor mal escrito daría NaN, y setInterval con NaN dispara sin parar:
  // machacaría la web de Movistar hasta que te bloqueen la IP.
  if (!Number.isFinite(ajustes.minutos) || ajustes.minutos < 1) {
    console.error(`La frecuencia debe ser un número de minutos mayor o igual a 1 (recibido: "${ajustes.minutos}")`);
    process.exit(1);
  }
  if (!existsSync(AJUSTES)) guardarAjustes();

  api('setMyCommands', {
    commands: [
      { command: 'estado', description: 'Consultar el stock ahora mismo' },
      { command: 'ajustes', description: 'Abrir el menú de ajustes' },
    ],
  }).catch((err) => log('No se pudieron registrar los comandos:', err.message));

  log(`Vigilando: ${ajustes.objetivos.map((o) => o.nombre).join(' | ') || '(sin objetivos)'}`);
  await ciclo();
  reprogramar();
  escucharTelegram();
}
