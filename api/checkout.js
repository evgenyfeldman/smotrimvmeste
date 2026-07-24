const Stripe = require('stripe');
const kvStore = require('./_kv');
const schedule = require('./_schedule');

const VIDEOS = {
  '1960': 'Дебаты Кеннеди и Никсона (1960)',
  '1992': 'Речь Патрика Бьюкенена (1992)',
  '2008': 'Дебаты Обамы и Маккейна (2008)',
  '2016': 'Дебаты Трампа и Клинтон (2016)',
  'apprentice': 'The Apprentice (2004)',
};
// Ручные оверрайды состояний. Меняются мной по запросу когда видео переходит
// в новую фазу (won/past). Бот уведомит когда видео доберёт до €100 — тогда обновляем.
// Без автодетекции, чтобы /api/checkout открывался максимально быстро.
const STATE_OVERRIDES = {
  '1960': 'won',
  '1992': 'won',
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    // Rate limit: 10 запросов в минуту на IP. Не препятствует обычному юзеру
    // (которому нужен 1 запрос на оплату), но останавливает спам-ботов от
    // массовой генерации Stripe-сессий.
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const rl = await kvStore.checkRateLimit('checkout:' + ip, 10, 60);
    if (!rl.allowed) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'too_many_requests' });
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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });
    // Origin берём из env (прод) или из host-заголовка Vercel (preview/local).
    // Не из req.headers.origin: атакующий может подсунуть свой Origin и
    // увести юзера после оплаты на фишинговый success.
    const origin = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;

    // После archiveAt видео автоматически продаётся как запись, минуя ручной
    // STATE_OVERRIDES. До этого — берём ручной оверрайд (won/open).
    const state = schedule.isArchived(video_id)
      ? 'past'
      : (STATE_OVERRIDES[video_id] || 'open');
    const minEur = state === 'past' ? 5 : (state === 'won' ? 8 : 7);
    if (eur < minEur) {
      return res.status(400).json({ error: 'invalid_amount', min: minEur });
    }

    const prefix = state === 'past'
      ? 'Запись'
      : state === 'won'
      ? 'Билет на эфир'
      : 'Донат и билет на эфир';

    const recording = schedule.recordingUrl(video_id);
    const description = state === 'past'
      ? `Доступ к записи прошедшего эфира «Смотрим вместе с Евгением Фельдманом».${recording ? ` Запись доступна по ссылке: ${recording}` : ' Ссылку на запись пришлём на email.'}`
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
