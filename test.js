// Comprobaciones mínimas: parseo de stock, lectura de objetivos e informe.
import assert from 'node:assert/strict';

const URL_256 = 'https://www.movistar.es/moviles/apple-iphone-18-pro-max-256gb-burdeos/';
const URL_512 = 'https://www.movistar.es/moviles/apple-iphone-18-pro-max-512gb-burdeos/';

// Configuración de prueba, cargada antes de importar el vigilante.
process.env.PRODUCT_VARIANT = 'Movistar Swap';
process.env.TARGETS = [
  `iPhone 18 Pro Max 256 GB Burdeos | iphone-18-pro-max-fusion,burdeos,256GB | ${URL_256}`,
  `iPhone 18 Pro Max 512 GB Burdeos | iphone-18-pro-max-fusion,burdeos,512GB | ${URL_512}`,
].join(' ; ');

const { extraerStock, leerObjetivos, informe, anotar, HISTORIAL, extraerVariantes, urlDeVariante } = await import('./index.js');

// --- parseo de stock ---
const html = `
  "stock":0,"alias":"6732_iphone-18-pro-max-fusion_burdeos_256GB_rent_adicional_swap_particulares"
  "stock":8,"alias":"6700_iphone-18-pro-max_burdeos_256GB_particulares"
  "stock":37,"alias":"6730_iphone-18-pro-max-fusion_negro_256GB_rent_particulares"
  "stock":0,"alias":"6736_iphone-18-pro-max-fusion_burdeos_512GB_rent_particulares"
`;
const terminos256 = ['iphone-18-pro-max-fusion', 'burdeos', '256GB'];

const r = extraerStock(html, terminos256);
assert.equal(r.length, 1, 'debe ignorar la compra normal, el color negro y los 512 GB');
assert.equal(r[0].unidades, 0);

const conStock = extraerStock(html.replace('"stock":0', '"stock":4'), terminos256);
assert.equal(conStock[0].unidades, 4);

assert.equal(extraerStock('sin nada que coincidir', terminos256).length, 0);

// --- objetivos ---
const objetivos = leerObjetivos(process.env.TARGETS);
assert.equal(objetivos.length, 2);
assert.equal(objetivos[1].url, URL_512);
assert.deepEqual(objetivos[1].terminos, ['iphone-18-pro-max-fusion', 'burdeos', '512GB']);
assert.notEqual(objetivos[0].clave, objetivos[1].clave, 'cada objetivo necesita su propia clave de estado');
assert.throws(() => leerObjetivos('me falta la url | terminos'), /mal escrito/);

// --- historial: solo los ultimos HISTORIAL intentos ---
for (let i = 1; i <= HISTORIAL + 5; i += 1) anotar(`intento ${i}`);
const conHistorial = informe();
assert.match(conHistorial, new RegExp(`Ultimos ${HISTORIAL} intentos`.replace('Ultimos', 'Últimos')));
assert.match(conHistorial, /intento 15/, 'debe conservar el mas reciente');
assert.doesNotMatch(conHistorial, /intento 5 /, 'debe descartar los viejos');

// --- catalogo: los menus se construyen con combinaciones que existen de verdad ---
const catalogo = `
  "stock":0,"alias":"6732_iphone-18-pro-max-fusion_burdeos_256GB_rent_particulares"
  "stock":3,"alias":"6733_iphone-18-pro-max-fusion_azul_256GB_rent_particulares"
  "stock":8,"alias":"6700_iphone-18-pro-max_burdeos_256GB_particulares"
  <a href="/moviles/apple-iphone-18-pro-max-256gb-burdeos/">x</a>
  <a href="/moviles/apple-iphone-18-pro-max-256gb-azulglacial/">x</a>
`;
const variantes = extraerVariantes(catalogo);
assert.equal(variantes.length, 3);
const azul = variantes.find((v) => v.color === 'azul');
assert.equal(azul.unidades, 3);
assert.equal(azul.swap, true);
assert.equal(variantes.find((v) => !v.swap).modelo, 'iphone-18-pro-max');

// El color del alias no es el de la url: azul -> azulglacial. Si esto se rompe,
// el aviso de stock llevaria un enlace equivocado justo cuando mas prisa hay.
assert.equal(
  urlDeVariante(catalogo, azul, 'respaldo'),
  'https://www.movistar.es/moviles/apple-iphone-18-pro-max-256gb-azulglacial/'
);
assert.equal(
  urlDeVariante(catalogo, variantes.find((v) => v.color === 'burdeos' && v.swap), 'respaldo'),
  'https://www.movistar.es/moviles/apple-iphone-18-pro-max-256gb-burdeos/'
);
assert.equal(urlDeVariante(catalogo, { modelo: 'iphone-99', color: 'rosa', capacidad: '1GB' }, 'respaldo'), 'respaldo');

// --- escapado de HTML ---
// Telegram rechaza el mensaje entero si el HTML esta mal formado; un nombre con & o <
// dejaria al bot sin poder avisar justo el dia que hay stock.
anotar('fallo: se esperaba <b> y llego &');
const raro = informe();
assert.doesNotMatch(raro, /&(?!amp;|lt;|gt;)/, 'todo & debe ir escapado');
assert.equal((raro.match(/<b>/g) || []).length, (raro.match(/<\/b>/g) || []).length);
assert.equal((raro.match(/<a /g) || []).length, (raro.match(/<\/a>/g) || []).length);

// --- informe ---
const texto = informe();
assert.match(texto, /Vigilante operativo/);
assert.match(texto, /512 GB/);
// Las etiquetas HTML que acepta Telegram deben quedar balanceadas.
assert.equal((texto.match(/<b>/g) || []).length, (texto.match(/<\/b>/g) || []).length);

console.log('OK: parseo, objetivos e informe correctos.');
console.log('---- ejemplo de informe ----');
console.log(texto.replace(/<[^>]+>/g, ''));
