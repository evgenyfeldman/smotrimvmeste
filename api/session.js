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

module.exports = async (req, res) => {
  try {
    const sid = req.query?.sid;
    if (!sid || typeof sid !== 'string' || !sid.startsWith('cs_')) {
      return res.status(400).json({ error: 'invalid_session_id' });
    }

    // Rate limit: success-странице нужен 1 запрос, 20/мин с запасом хватает.
    // Без лимита эндпоинт позволяет массово прощупывать session-id ради email-ов.
    const ip = req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
    const rl = await kvStore.checkRateLimit('session:' + ip, 20, 60);
    if (!rl.allowed) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'too_many_requests' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });
    const session = await stripe.checkout.sessions.retrieve(sid);

    const videoId = session.metadata?.video_id;
    // Отдаём только сессии нашего сайта. Через этот Stripe-аккаунт идут платежи
    // других проектов — их email-ы по чужому session-id светить нельзя.
    if (!VIDEOS[videoId]) {
      return res.status(404).json({ error: 'not_found' });
    }
    const videoName = VIDEOS[videoId] || null;
    const email =
      session.customer_details?.email || session.customer_email || null;
    const eur = (session.amount_total || 0) / 100;
    const amountTotalCents = session.amount_total || 0;
    const paid = session.payment_status === 'paid';
    // Если эфир по этому видео уже прошёл — отдаём ссылку на запись, чтобы
    // success-страница показала её купившему.
    const recording = schedule.isArchived(videoId)
      ? schedule.recordingUrl(videoId)
      : null;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      paid,
      video_id: videoId,
      video_name: videoName,
      email,
      eur,
      amount_total_cents: amountTotalCents,
      recording,
    });
  } catch (e) {
    console.error('session error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
