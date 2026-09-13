<div align="center">

# 📱 IP18Bot

### Vigilante de stock de Movistar con avisos por Telegram

Comprueba cada pocos minutos si un móvil agotado vuelve a estar disponible y te avisa al instante.
Sin dependencias, sin navegador, sin scraping visual.

`Node.js` · `systemd` · `Telegram Bot API` · `0 dependencias`

</div>

---

## 🎯 Qué hace

El **iPhone 18 Pro Max** en color Burdeos y Azul Glacial está permanentemente agotado en modalidad **Movistar Swap**. Las reposiciones de Apple llegan escalonadas, sin fecha, y se agotan en minutos.

Este bot vigila la web **cada 3 minutos, 24/7**, y en cuanto entra una unidad te manda un mensaje a Telegram con el enlace directo de compra.

```
🚨 ¡YA HAY STOCK!
iPhone 18 Pro Max 256 GB Burdeos
Movistar Swap
3 unidades disponibles

👉 Enlace directo para comprarlo
```

---

## 🔍 Cómo funciona por dentro

La clave está en **no hacer scraping visual**. La ficha de producto de movistar.es lleva incrustado en el HTML un JSON con todo el catálogo:

```json
"stock":0,"alias":"6732_iphone-18-pro-max-fusion_burdeos_256GB_rent_adicional_swap_particulares"
```

Ese `alias` codifica **SKU, modelo, color, capacidad y modalidad**. El bot descarga la página, busca las variantes cuyo alias contiene todos los términos que le has dado, y lee el número de `stock`.

| Enfoque | Problema |
|---|---|
| ❌ Buscar el texto "Agotado temporalmente" | Se rompe si cambian una palabra |
| ❌ Selectores CSS | Se rompen con cualquier rediseño |
| ❌ Playwright / navegador headless | 300 MB de dependencias para leer un número |
| ✅ **Leer el JSON incrustado** | Sobrevive a cambios de diseño y textos |

### Detalles que importan

- 📦 **Una sola descarga por ronda.** Cualquier ficha trae el catálogo completo, así que `SOURCE_URL` marca la única página que se baja. Vigilar 4 variantes cuesta lo mismo que vigilar 1.
- 🔕 **Aviso único.** El estado vive en `state.json`. Te avisa una vez y solo se rearma si el producto vuelve a agotarse.
- 🎯 **Objetivos independientes.** Cada variante lleva su propio estado. Que salte el aviso del 512 GB no silencia el del 256 GB.
- 🎲 **Margen aleatorio.** Hasta un 20% del intervalo, para no golpear la web siempre en el mismo segundo.
- 🚨 **Nunca falla en silencio.** Si Movistar cambia la web y el bot deja de encontrar la variante, te lo dice por Telegram en vez de quedarse callado fingiendo que todo va bien.
- 🗒️ **Log limpio.** Al `journalctl` solo van los cambios. Si nada se mueve, no escribe nada.

---

## 💬 Consultar el estado

Escríbele **cualquier cosa** al bot (un "hola", un punto, un emoji) y consulta el stock **en ese momento** — no te da una lectura guardada — y responde:

```
🟢 Vigilante operativo

🏷 Modalidad: Movistar Swap

📦 Última lectura
   ❌ iPhone 18 Pro Max 256 GB Burdeos — agotado
   ❌ iPhone 18 Pro Max 512 GB Burdeos — agotado
   ❌ iPhone 18 Pro Max 256 GB Azul Glacial — agotado
   ✅ iPhone 18 Pro Max 512 GB Azul Glacial — 3 uds.

🕐 Comprobado: 14:22 (hace menos de un minuto)
⏭ Próxima: ~14:25

🔁 Cada 3 min · 284 comprobaciones · 0 errores
🔔 Aviso: armado para los 4 modelos
⏱ En marcha desde 11:39 (2 h 43 min)
🖥 Servidor: minipc

🧾 Últimos 10 intentos
   14:22 — iPhone 18 Pro Max 512 GB Azul Glacial: 3
   14:19 — todo agotado
   14:16 — todo agotado
   ...
```

Solo contesta al `TELEGRAM_CHAT_ID` configurado. Si alguien encuentra el bot y le escribe, lo ignora en silencio. Tiene un antirrebote de 20 segundos para que no machaque la web si le escribes varias veces seguidas, y las consultas manuales **no descolocan** el reloj de la ronda automática.

---

## 🚀 Puesta en marcha

### 1️⃣ Crear el bot de Telegram

1. Habla con [**@BotFather**](https://t.me/BotFather) → `/newbot` → copia el token.
2. Envíale cualquier mensaje a tu bot recién creado.
3. Ejecuta `chat-id.bat` (o `node --env-file=.env chat-id.js`) para obtener tu chat.

### 2️⃣ Crear el archivo `.env`

En la raíz del proyecto:

```ini
# Telegram
TELEGRAM_BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789

# Etiqueta de la modalidad, solo para los mensajes
PRODUCT_VARIANT=Movistar Swap

# Única página que se descarga por ronda (trae el catálogo entero)
SOURCE_URL=https://www.movistar.es/moviles/apple-iphone-18-pro-max-256gb-burdeos/

# Objetivos: "Nombre | términos,del,alias | url de compra", separados por ";"
TARGETS=iPhone 18 Pro Max 256 GB Burdeos | iphone-18-pro-max-fusion,burdeos,256GB | https://www.movistar.es/moviles/apple-iphone-18-pro-max-256gb-burdeos/ ; iPhone 18 Pro Max 512 GB Burdeos | iphone-18-pro-max-fusion,burdeos,512GB | https://www.movistar.es/moviles/apple-iphone-18-pro-max-512gb-burdeos/

# Minutos entre comprobaciones
CHECK_MINUTES=3
```

### 3️⃣ Arrancar

**En Windows:** doble clic en `start.bat` y deja la ventana abierta.

**En Linux (recomendado, 24/7):** copia los archivos al servidor y ejecuta como root:

```sh
./install-linux.sh
```

Lo instala en `/opt/vigilante-movistar/` como servicio systemd: arranca solo al encender la máquina y se relanza si se cae.

---

## 🎛️ Vigilar otro producto

Edita `TARGETS`. Cada objetivo es `Nombre | términos | url` y se separan con `;`. Los términos deben aparecer **todos** en el alias interno de la variante:

| Parte | Ejemplos |
|---|---|
| **Modelo** | `iphone-18-pro-max-fusion` (Swap) · `iphone-18-pro-max` (compra directa) |
| **Color** | `burdeos`, `azul`, `negro`, `plata` |
| **Capacidad** | `256GB`, `512GB` |

> 💡 El sufijo `-fusion` junto a `rent`/`swap` es como Movistar identifica internamente la modalidad Swap. Ojo con las URLs: el azul es `azulglacial` en la web aunque el alias interno lo llame `azul`.

Para descubrir los alias de cualquier modelo:

```sh
curl -s "https://www.movistar.es/moviles/apple-iphone-18-pro-max-256gb-burdeos/" \
  | grep -oE '"stock":[0-9]+,"alias":"[^"]*iphone-18[^"]*"' | sort -u
```

---

## 🖥️ Comandos del servicio

```sh
systemctl status vigilante-movistar      # estado
journalctl -u vigilante-movistar -f      # registro en vivo
systemctl restart vigilante-movistar     # tras editar el .env
```

---

## 📂 Archivos

| Archivo | Para qué |
|---|---|
| `index.js` | El vigilante entero |
| `.env` | Token, chat, objetivos y frecuencia *(no incluido en el repo)* |
| `chat-id.js` | Averigua tu chat de Telegram |
| `test.js` | Comprueba parseo, objetivos e informe |
| `install-linux.sh` | Instala el servicio systemd |
| `vigilante-movistar.service` | Unidad de systemd |
| `start.bat` · `chat-id.bat` | Lanzadores para Windows |
| `state.json` | Recuerda de qué te ha avisado ya |

---

## 🧪 Tests

```sh
node test.js
```

Sin frameworks: `assert` de Node y listo. Cubre el parseo del stock, la lectura de objetivos, que las claves de estado no colisionen (si colisionaran, un aviso silenciaría otro) y que las etiquetas HTML del informe queden balanceadas (una `<b>` sin cerrar hace que Telegram rechace el mensaje entero, y te quedarías sin aviso justo el día que hay stock).

---

## ⚠️ Aviso

Hace una petición cada pocos minutos a una página pública, con margen aleatorio. No evade protecciones, no automatiza compras y no inicia sesión en ninguna cuenta. Úsalo con cabeza.

---

<div align="center">

# 🇬🇧 English

</div>

## 🎯 What it does

The **iPhone 18 Pro Max** in Burgundy and Glacial Blue is permanently sold out on **Movistar Swap**. Apple restocks in staggered batches, with no announced date, and they sell out within minutes.

This bot checks the site **every 3 minutes, 24/7**, and pings you on Telegram the moment a unit appears, with a direct buy link.

## 🔍 How it works

No visual scraping. Movistar's product pages embed a JSON blob with the whole catalogue:

```json
"stock":0,"alias":"6732_iphone-18-pro-max-fusion_burdeos_256GB_rent_adicional_swap_particulares"
```

The `alias` encodes SKU, model, colour, capacity and plan. The bot fetches the page, finds variants whose alias contains every configured term, and reads the `stock` number. It survives redesigns and copy changes, needs no browser, and has zero dependencies.

- 📦 **One fetch per round** — any page carries the full catalogue, so `SOURCE_URL` is the only page downloaded. Watching 4 variants costs the same as watching 1.
- 🔕 **Alerts once** — state lives in `state.json`, re-arming only if the item sells out again.
- 🎯 **Independent targets** — each variant keeps its own state.
- 🚨 **Never fails silently** — if the site changes and a variant can't be found, it tells you on Telegram.
- 🗒️ **Quiet logs** — only changes reach `journalctl`.

## 💬 Status on demand

Send the bot **any message** and it checks stock **right then** (not a cached reading), replying with: running state, every target's stock, when it checked and when the next round is due, counters, whether the alert is armed, uptime, host, and the **last 10 attempts**.

It only answers the configured `TELEGRAM_CHAT_ID`; anyone else is ignored. A 20-second debounce prevents hammering the site, and manual checks never shift the automatic schedule.

## 🚀 Setup

1. Message [**@BotFather**](https://t.me/BotFather) → `/newbot` → copy the token.
2. Send any message to your new bot, then run `chat-id.js` to get your chat id.
3. Create a `.env` file (see the Spanish section above for the full template).
4. **Windows:** run `start.bat`. **Linux (24/7):** run `./install-linux.sh` as root — installs a systemd service that starts at boot and restarts on failure.

## 🎛️ Watching something else

Edit `TARGETS`: `Name | alias,terms | buy url`, separated by `;`. Every term must appear in the variant's internal alias — model (`iphone-18-pro-max-fusion` for Swap, `iphone-18-pro-max` for outright purchase), colour and capacity.

## ⚠️ Disclaimer

It makes one request every few minutes to a public page, with random jitter. It does not bypass protections, automate purchases, or log into any account. Use responsibly.
