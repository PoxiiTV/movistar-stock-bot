// Vigila el stock de uno o varios dispositivos en movistar.es y avisa por Telegram.
// Sin dependencias: fetch es nativo de Node >= 18.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const MODALIDAD = process.env.PRODUCT_VARIANT || '';
const MINUTOS = Number(process.env.CHECK_MINUTES || 30);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ESTADO = new URL('./state.json', import.meta.url);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const log = (...args) => console.log(new Date().toLocaleString('es-ES'), '·', ...args);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function duracion(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

// TARGETS: objetivos separados por ";", cada uno "Nombre | término,término | url".
// Basta con que uno tenga stock para recibir el aviso; cada objetivo avisa por su cuenta.
export function leerObjetivos(texto) {
  return (texto || '')
    .split(';')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const [nombre, terminos, url] = linea.split('|').map((p) => p.trim());
      if (!nombre || !terminos || !url) throw new Error(`Objetivo mal escrito en TARGETS: "${linea}"`);
      const lista = terminos.split(',').map((t) => t.trim()).filter(Boolean);
      return { nombre, terminos: lista, url, clave: lista.join('+') };
    });
}

const OBJETIVOS = leerObjetivos(process.env.TARGETS);
// Página única de la que leer el stock de todos los objetivos. Si se deja vacía,
// cada objetivo se lee de su propia url.
const FUENTE = process.env.SOURCE_URL || null;

function leerEstado() {
  try {
    return JSON.parse(readFileSync(ESTADO, 'utf8'));
  } catch {
    return { objetivos: {} };
  }
}

function guardarEstado(estado) {
  writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
}

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

// Datos en memoria para el informe de estado por Telegram.
const arranque = Date.now();
const info = {
  comprobaciones: 0,
  errores: 0,
  ultimoError: null,
  ultimaComprobacion: null,
  proxima: null,
  lecturas: {},
  historial: [], // Solo los últimos HISTORIAL intentos; lo viejo no sirve para nada.
};

export const HISTORIAL = 10;

export function anotar(resumen) {
  info.historial.push({ cuando: new Date(), resumen });
  if (info.historial.length > HISTORIAL) info.historial.shift();
}

export function informe() {
  const estado = leerEstado();
  const lineas = ['🟢 <b>Vigilante operativo</b>', '', `🏷 Modalidad: ${MODALIDAD}`, ''];

  if (info.ultimaComprobacion) {
    lineas.push('📦 <b>Última lectura</b>');
    for (const objetivo of OBJETIVOS) {
      const lectura = info.lecturas[objetivo.clave];
      if (!lectura) {
        lineas.push(`   ⚠️ ${objetivo.nombre} — sin datos`);
      } else if (lectura.unidades > 0) {
        lineas.push(`   ✅ <b>${objetivo.nombre} — ${lectura.unidades} uds.</b>`);
      } else {
        lineas.push(`   ❌ ${objetivo.nombre} — agotado`);
      }
    }
    lineas.push(
      '',
      `🕐 Comprobado: ${hora(info.ultimaComprobacion)} (hace ${duracion(Date.now() - info.ultimaComprobacion)})`,
      `⏭ Próxima: ~${hora(info.proxima)}`
    );
  } else {
    lineas.push('📦 Estado: aún sin datos, primera comprobación en curso.');
  }

  const avisados = OBJETIVOS.filter((o) => estado.objetivos?.[o.clave]?.hayStock).length;
  const aviso =
    avisados === 0
      ? `armado para los ${OBJETIVOS.length} modelos`
      : `${avisados} ya avisado(s), se rearma al agotarse`;

  lineas.push(
    '',
    `🔁 Cada ${MINUTOS} min · ${info.comprobaciones} comprobaciones · ${info.errores} errores`,
    `🔔 Aviso: ${aviso}`,
    `⏱ En marcha desde ${hora(new Date(arranque))} (${duracion(Date.now() - arranque)})`,
    `🖥 Servidor: ${hostname()}`
  );

  if (info.historial.length > 0) {
    lineas.push('', `🧾 <b>Últimos ${info.historial.length} intentos</b>`);
    for (const intento of [...info.historial].reverse()) {
      lineas.push(`   ${hora(intento.cuando)} — ${intento.resumen}`);
    }
  }

  if (info.ultimoError) lineas.push('', `⚠️ Último error: ${info.ultimoError}`);
  for (const objetivo of OBJETIVOS) {
    lineas.push('', `👉 <a href="${objetivo.url}">${objetivo.nombre}</a>`);
  }
  return lineas.join('\n');
}

async function telegram(texto) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: texto,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram: ${data.description}`);
}

async function descargar(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  return res.text();
}

async function comprobar() {
  // Cualquier ficha de Movistar lleva el catálogo entero en su JSON, así que con SOURCE_URL
  // basta una descarga para todos los objetivos; su url queda solo como enlace de compra.
  const paginas = new Map();
  const fuentes = FUENTE ? [FUENTE] : [...new Set(OBJETIVOS.map((o) => o.url))];
  for (const url of fuentes) paginas.set(url, await descargar(url));
  const html = (objetivo) => paginas.get(FUENTE ?? objetivo.url);

  const estado = leerEstado();
  estado.objetivos ??= {};

  for (const objetivo of OBJETIVOS) {
    const previo = estado.objetivos[objetivo.clave] ?? { hayStock: false, avisadoSinCoincidencias: false };
    const variantes = extraerStock(html(objetivo), objetivo.terminos);

    if (variantes.length === 0) {
      log(`⚠️  ${objetivo.nombre}: ninguna variante coincide. ¿Ha cambiado la web?`);
      delete info.lecturas[objetivo.clave];
      if (!previo.avisadoSinCoincidencias) {
        await telegram(
          `⚠️ <b>El vigilante no encuentra un producto</b>\n${objetivo.nombre}\nNo hay variantes que coincidan con: <code>${objetivo.terminos.join(', ')}</code>\n${objetivo.url}`
        );
        estado.objetivos[objetivo.clave] = { ...previo, avisadoSinCoincidencias: true };
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
        `🚨 <b>¡YA HAY STOCK!</b>\n${objetivo.nombre}\n${MODALIDAD}\n${unidades} unidades disponibles\n\n👉 <a href="${objetivo.url}">Enlace directo para comprarlo</a>`
      );
      log(`📨 Aviso enviado: ${objetivo.nombre}`);
    } else if (!hayStock && previo.hayStock) {
      log(`${objetivo.nombre}: vuelve a estar agotado, se rearma el aviso.`);
    }

    estado.objetivos[objetivo.clave] = { hayStock, unidades, avisadoSinCoincidencias: false };
  }

  estado.ultimaComprobacion = new Date().toISOString();
  guardarEstado(estado);

  const conStock = OBJETIVOS.filter((o) => info.lecturas[o.clave]?.unidades > 0);
  anotar(conStock.length === 0 ? 'todo agotado' : conStock.map((o) => `${o.nombre}: ${info.lecturas[o.clave].unidades}`).join(', '));
}

// programada = false cuando la comprobación la pides tú por Telegram;
// esas no mueven la hora de la siguiente ronda automática.
async function ciclo({ programada = true } = {}) {
  info.comprobaciones += 1;
  info.ultimaComprobacion = new Date();
  if (programada) info.proxima = new Date(Date.now() + MINUTOS * 60_000);
  try {
    await comprobar();
    info.ultimoError = null;
  } catch (err) {
    info.errores += 1;
    info.ultimoError = `${err.message} (${hora(new Date())})`;
    anotar(`error: ${err.message}`);
    log('Error en la comprobación:', err.message, '— se reintentará en el siguiente ciclo.');
  }
}

// Escucha mensajes: cualquier texto que le mandes devuelve el informe de estado.
async function escucharTelegram() {
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=50&offset=${offset}`, {
        signal: AbortSignal.timeout(70_000),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.description);
      for (const update of data.result) {
        offset = update.update_id + 1;
        const mensaje = update.message ?? update.edited_message;
        // Solo contesta al chat configurado; a cualquier otro lo ignora.
        if (!mensaje?.chat || String(mensaje.chat.id) !== String(process.env.TELEGRAM_CHAT_ID)) continue;
        log('Consulta de estado recibida.');
        // "Escribiendo..." mientras se consulta a Movistar, para que no parezca colgado.
        fetch(`https://api.telegram.org/bot${TOKEN}/sendChatAction`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: mensaje.chat.id, action: 'typing' }),
        }).catch(() => {});
        // Se consulta el stock en el momento, salvo que se acabe de mirar (evita repetir si escribes varias veces seguidas).
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

// Solo arranca el vigilante al ejecutar este archivo; al importarlo (test.js) no hace nada.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.error('Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el archivo .env');
    process.exit(1);
  }
  if (OBJETIVOS.length === 0) {
    console.error('No hay ningún objetivo definido en TARGETS (archivo .env)');
    process.exit(1);
  }
  log(`Vigilando cada ${MINUTOS} min: ${OBJETIVOS.map((o) => o.nombre).join(' | ')}`);
  await ciclo();
  // Margen aleatorio (como mucho un 20% del intervalo) para no golpear la web siempre en el mismo instante.
  const margen = Math.min(180_000, MINUTOS * 60_000 * 0.2);
  setInterval(ciclo, MINUTOS * 60_000 + Math.random() * margen);
  escucharTelegram();
}
