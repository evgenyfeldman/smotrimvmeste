const Stripe = require('stripe');

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

// Дедуп event.id в памяти (переживёт warm-инстанс, не переживёт cold start —
// но защитит от типичных stripe-ретраев в пределах нескольких секунд).
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
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, ...row }),
      redirect: 'follow',
    });
    if (!r.ok) console.error('sheets non-200', r.status, await r.text());
  } catch (e) {
    console.error('sheets error', e);
  }
}

async function sumForVideo(stripe, videoId) {
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

  // Дедуп по event.id — пропускаем уже обработанные.
  // Важно: добавляем в set только ПОСЛЕ успешной обработки (см. ниже),
  // чтобы недосчитанная попытка не блокировала ретрай Stripe.
  if (processedEvents.has(event.id)) {
    console.warn('duplicate event, skipping', event.id);
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const videoId = session.metadata?.video_id;
  const videoName = VIDEOS[videoId] || videoId || 'unknown';
  const eur = (session.amount_total || 0) / 100;
  const email =
    session.customer_details?.email || session.customer_email || 'нет email';

  const tag = TAGS[videoId] || videoId;
  const cleanName = videoName.replace(/\s*\(\d{4}\)$/, '');

  try {
    // Sheets и подсчёт суммы — независимы, гоняем параллельно
    const [, totalCents] = await Promise.all([
      appendToSheet({
        video: `${tag} | ${cleanName}`,
        email,
        eur,
        session_id: session.id,
      }),
      sumForVideo(stripe, videoId).catch((e) => {
        console.error('sum failed', e);
        return null;
      }),
    ]);

    const escape = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

    let text =
      `<b>💸 Новый донат</b>\n` +
      `Видео: <b>${escape(videoName)}</b>\n` +
      `Сумма: <b>€${eur}</b>\n` +
      `Email: <code>${escape(email)}</code>`;
    if (totalCents !== null) {
      const totalEur = totalCents / 100;
      text += `\n\nВсего по видео: <b>€${totalEur}</b> из €100`;
    }
    await tg(text);

    if (
      totalCents !== null &&
      totalCents >= GOAL_CENTS &&
      totalCents - (session.amount_total || 0) < GOAL_CENTS
    ) {
      await tg(
        `🏆 <b>ВИДЕО СОБРАЛО €100!</b>\n` +
        `<b>${escape(videoName)}</b>\n` +
        `Пора готовить рассылку доступа всем, кто проголосовал.\n\n` +
        `<i>Не забудь сообщить Клоду — пусть обновит STATE_OVERRIDES, добавит дату эфира и переведёт карточку в won-состояние.</i>`
      );
    }

    // Маркируем как обработанное — только после успеха
    processedEvents.add(event.id);
    if (processedEvents.size > 200) {
      processedEvents = new Set(Array.from(processedEvents).slice(-100));
    }
  } catch (e) {
    console.error('webhook processing error', e);
    // Не отвечаем 200 — Stripe ретрайнет, и в следующий раз дедуп нас пропустит
    return res.status(500).json({ error: 'processing_failed' });
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
