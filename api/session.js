const Stripe = require('stripe');

const VIDEOS = {
  '1960': 'Дебаты Кеннеди и Никсона (1960)',
  '1992': 'Речь Патрика Бьюкенена (1992)',
  '2008': 'Дебаты Обамы и Маккейна (2008)',
  '2016': 'Дебаты Трампа и Клинтон (2016)',
  'apprentice': 'The Apprentice (2004)',
};

async function totalForVideo(stripe, videoId) {
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
    const sid = req.query?.sid;
    if (!sid || typeof sid !== 'string' || !sid.startsWith('cs_')) {
      return res.status(400).json({ error: 'invalid_session_id' });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sid);

    const videoId = session.metadata?.video_id;
    const videoName = VIDEOS[videoId] || null;
    const email =
      session.customer_details?.email || session.customer_email || null;
    const eur = (session.amount_total || 0) / 100;
    const paid = session.payment_status === 'paid';

    // Считаем общую сумму по этому видео свежо — без кэшей, чтобы success-страница
    // сразу показала актуальную цифру, включая только что прошедший платёж.
    let totalCents = null;
    try {
      totalCents = await totalForVideo(stripe, videoId);
    } catch (e) {
      console.error('totalForVideo failed', e);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      paid,
      video_id: videoId,
      video_name: videoName,
      email,
      eur,
      video_total_cents: totalCents,
    });
  } catch (e) {
    console.error('session error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
