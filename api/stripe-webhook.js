const Stripe = require('stripe');
const kvStore = require('./_kv');

const VIDEOS = {
  '1960': 'Дебаты Кеннеди и Никсона (1960)',
  '1992': 'Речь Патрика Бьюкенена (1992)',
  '2008': 'Дебаты Обамы и Маккейна (2008)',
  '2016': 'Дебаты Трампа и Клинтон (2016)',
  'apprentice': 'The Apprentice (2004)',
};
const TAGS = {
  '1960': '1960',
  '1992': '1992',
  '2008': '2008',
  '2016': '2016',
  'apprentice': '2004',
};
const GOAL_CENTS = 10000;

// Резервный дедуп в памяти на случай если KV не подключён.
let processedEvents = new Set();

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function tg(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('telegram env missing');
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) console.error('telegram non-200', r.status, await r.text());
  } catch (e) {
    console.error('telegram error', e);
  }
}

async function appendToSheet(row) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.warn('sheets env missing');
    return;
  }
  const body = JSON.stringify({ secret, ...row });
  const attempts = [0, 1500];
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) await new Promise((r) => setTimeout(r, attempts[i]));
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow',
      });
      if (r.ok) return;
      lastErr = `non-200 ${r.status}: ${await r.text()}`;
      console.error(`sheets attempt ${i + 1} failed`, lastErr);
    } catch (e) {
      lastErr = e?.message || String(e);
      console.error(`sheets attempt ${i + 1} error`, e);
    }
  }
  // Все попытки исчерпаны — кричим в Telegram, чтобы строку добили руками.
  await tg(
    `⚠️ <b>Sheets не записал донат</b>\n` +
    `${row.video}\n` +
    `Email: <code>${row.email}</code>\n` +
    `Сумма: €${row.eur}\n` +
    `Session: <code>${row.session_id}</code>\n` +
    `Ошибка: ${String(lastErr).slice(0, 200)}`
  ).catch(() => {});
}

async function sumForVideoFallback(stripe, videoId) {
  let total = 0;
  let starting_after;
  for (let i = 0; i < 50; i++) {
    const resp = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      starting_after,
    });
    for (const s of resp.data) {
      if (s.metadata?.video_id === videoId && s.payment_status === 'paid') {
        total += s.amount_total || 0;
      }
    }
    if (!resp.has_more) break;
    starting_after = resp.data[resp.data.length - 1].id;
  }
  return total;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const raw = await rawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  // Дедуп события. KV — приоритетнее (переживает cold start). Память — фоллбэк.
  if (kvStore.isEnabled()) {
    try {
      const claimed = await kvStore.tryClaimEvent(event.id);
      if (!claimed) {
        console.warn('duplicate event (kv), skipping', event.id);
        return res.status(200).json({ received: true });
      }
    } catch (e) {
      console.error('kv dedup failed, falling back to memory', e);
      if (processedEvents.has(event.id)) {
        return res.status(200).json({ received: true });
      }
    }
  } else if (processedEvents.has(event.id)) {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const videoId = session.metadata?.video_id;
  const videoName = VIDEOS[videoId] || videoId || 'unknown';
  const eur = (session.amount_total || 0) / 100;
  const amountCents = session.amount_total || 0;
  const email =
    session.customer_details?.email || session.customer_email || 'нет email';

  const tag = TAGS[videoId] || videoId;
  const cleanName = videoName.replace(/\s*\(\d{4}\)$/, '');

  try {
    // KV-инкремент тотала идёт параллельно с Sheets. Telegram — после, чтобы цифру в сообщении взять актуальную.
    const incrementPromise = kvStore.isEnabled()
      ? kvStore.incrementTotal(videoId, amountCents).catch((e) => {
          console.error('kv increment failed', e);
          return null;
        })
      : sumForVideoFallback(stripe, videoId).catch((e) => {
          console.error('sum fallback failed', e);
          return null;
        });

    const sheetsPromise = appendToSheet({
      video: `${tag} | ${cleanName}`,
      email,
      eur,
      session_id: session.id,
    });

    const [, totalCents] = await Promise.all([sheetsPromise, incrementPromise]);

    const escape = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

    let text =
      `<b>💸 Новый донат</b>\n` +
      `Видео: <b>${escape(videoName)}</b>\n` +
      `Сумма: <b>€${eur}</b>\n` +
      `Email: <code>${escape(email)}</code>`;
    if (totalCents !== null && totalCents !== undefined) {
      const totalEur = totalCents / 100;
      text += `\n\nВсего по видео: <b>€${totalEur}</b> из €100`;
    }
    await tg(text);

    if (
      totalCents !== null &&
      totalCents !== undefined &&
      totalCents >= GOAL_CENTS &&
      totalCents - amountCents < GOAL_CENTS
    ) {
      await tg(
        `🏆 <b>ВИДЕО СОБРАЛО €100!</b>\n` +
        `<b>${escape(videoName)}</b>\n` +
        `Пора готовить рассылку доступа всем, кто проголосовал.\n\n` +
        `<i>Не забудь сообщить Клоду — пусть обновит STATE_OVERRIDES, добавит дату эфира и переведёт карточку в won-состояние.</i>`
      );
    }

    // Маркируем в памяти на случай ретрая в пределах warm-инстанса
    processedEvents.add(event.id);
    if (processedEvents.size > 200) {
      processedEvents = new Set(Array.from(processedEvents).slice(-100));
    }
  } catch (e) {
    console.error('webhook processing error', e);
    return res.status(500).json({ error: 'processing_failed' });
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
