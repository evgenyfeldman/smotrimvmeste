const Stripe = require('stripe');

const VIDEOS = {
  '1960': 'Дебаты Кеннеди и Никсона (1960)',
  '1992': 'Речь Патрика Бьюкенена (1992)',
  '2008': 'Дебаты Обамы и Маккейна (2008)',
  '2016': 'Дебаты Трампа и Клинтон (2016)',
  'apprentice': 'The Apprentice (2004)',
};
const GOAL_CENTS = 10000;
// Превью/ручные оверрайды состояний. Если video_id здесь — берём это состояние,
// иначе вычисляем по Stripe-итогам (>=€100 → won, иначе open).
// Перед релизом очистить или подменить логикой из Sheets/конфига.
const STATE_OVERRIDES = {
  '2008': 'past',
  '2016': 'won',
};

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

    // Определяем состояние видео: past (эфир прошёл), won (собрано ≥€100), open
    let state = STATE_OVERRIDES[video_id];
    if (!state) {
      state = 'open';
      try {
        const total = await sumForVideo(stripe, video_id);
        if (total >= GOAL_CENTS) state = 'won';
      } catch (e) {
        console.error('total computation failed, treating as open', e);
      }
    }

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
