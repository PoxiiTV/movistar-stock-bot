// Muestra el chat_id de quien haya escrito al bot (ejecutar tras enviarle un mensaje).
const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
const { ok, result, description } = await res.json();
if (!ok) throw new Error(description);
const chats = [...new Map(result.map((u) => {
  const chat = u.message?.chat ?? u.channel_post?.chat;
  return chat ? [chat.id, chat] : [null, null];
}).filter(([id]) => id)).values()];
if (chats.length === 0) {
  console.log('Sin mensajes. Escribe algo a tu bot en Telegram y vuelve a ejecutar esto.');
} else {
  for (const c of chats) console.log(`TELEGRAM_CHAT_ID=${c.id}   (${c.first_name || c.title || c.username})`);
}
