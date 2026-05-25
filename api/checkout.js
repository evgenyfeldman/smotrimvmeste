const Stripe = require('stripe');

const VIDEOS = {
  '1960': 'Дебаты Кеннеди и Никсона (1960)',
  '1992': 'Речь Патрика Бьюкенена (1992)',
  '2008': 'Дебаты Обамы и Маккейна (2008)',
  '2016': 'Дебаты Трампа и Клинтон (2016)',
  'apprentice': 'The Apprentice (2004)',
};
// Ручные оверрайды состояний: используются для 'past' (эфир прошёл) и при необходимости форсировать.
// Won — определяется автоматически по сумме (см. ниже).
const STATE_OVERRIDES = {};
const GOAL_CENTS = 10000;

// Кэш сумм по видео в памяти warm-инстанса. Обновляется раз в минуту.
// Если кэш свеж — /api/checkout мгновенно возвращает состояние без запросов к Stripe.
let totalsCache = { computed: 0, totals: null };
const TOTALS_CACHE_TTL = 60 * 1000;

async function refreshTotals(stripe) {
  const totals = {};
  let starting_after;
  for (let i = 0; i < 50; i++) {
    const resp = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      starting_after,
    });
    for (const s of resp.data) {
      const vid = s.metadata?.video_id;
      if (vid && s.payment_status === 'paid') {
        totals[vid] = (totals[vid] || 0) + (s.amount_total || 0);
      }
    }
    if (!resp.has_more) break;
    starting_after = resp.data[resp.data.length - 1].id;
  }
  return totals;
}

async function getVideoState(stripe, videoId) {
  if (STATE_OVERRIDES[videoId]) return STATE_OVERRIDES[videoId];
  const fresh = Date.now() - totalsCache.computed < TOTALS_CACHE_TTL;
  if (!fresh || !totalsCache.totals) {
    try {
      totalsCache.totals = await refreshTotals(stripe);
      totalsCache.computed = Date.now();
    } catch (e) {
      console.error('totals refresh for state failed', e);
      return 'open';
    }
  }
  const cents = totalsCache.totals[videoId] || 0;
  return cents >= GOAL_CENTS ? 'won' : 'open';
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const { video_id, amount } = req.body || {};
    const videoName = VIDEOS[video_id];
    if (!videoName) {
      return res.status(400).json({ error: 'invalid_video' });
    }

    const eur = Number(amount);
    if (!Number.isFinite(eur)) {
      return res.status(400).json({ error: 'invalid_amount' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const state = await getVideoState(stripe, video_id);
    const minEur = state === 'past' ? 5 : (state === 'won' ? 8 : 7);
    if (eur < minEur) {
      return res.status(400).json({ error: 'invalid_amount', min: minEur });
    }

    const prefix = state === 'past'
      ? 'Запись'
      : state === 'won'
      ? 'Билет на эфир'
      : 'Донат и билет на эфир';

    const description = state === 'past'
      ? 'Доступ к записи прошедшего эфира «Смотрим вместе с Евгением Фельдманом». Ссылку на запись пришлём на email.'
      : state === 'won'
      ? 'Билет на закрытый эфир «Смотрим вместе с Евгением Фельдманом». Ссылку на эфир пришлём на email.'
      : 'Сумма — это голос и билет на закрытый эфир «Смотрим вместе с Евгением Фельдманом». Когда видео соберёт €100, я объявлю дату эфира и пришлю ссылку всем участникам.';

    const unit_amount = Math.round(eur * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount,
          product_data: {
            name: `${prefix}: ${videoName}`,
            description,
          },
        },
      }],
      metadata: { video_id, eur: String(eur) },
      customer_creation: 'always',
      success_url: `${origin}/success.html?vid=${encodeURIComponent(video_id)}&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('checkout error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
