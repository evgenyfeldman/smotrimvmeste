const Stripe = require('stripe');

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
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sid);

    const videoId = session.metadata?.video_id;
    const videoName = VIDEOS[videoId] || null;
    const email =
      session.customer_details?.email || session.customer_email || null;
    const eur = (session.amount_total || 0) / 100;
    const paid = session.payment_status === 'paid';

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      paid,
      video_id: videoId,
      video_name: videoName,
      email,
      eur,
    });
  } catch (e) {
    console.error('session error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
