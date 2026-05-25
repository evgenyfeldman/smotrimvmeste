const Stripe = require('stripe');

const VIDEO_IDS = ['1960', '1992', '2008', '2016', 'apprentice'];

module.exports = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const totals = Object.fromEntries(VIDEO_IDS.map((v) => [v, 0]));

    let starting_after;
    for (let i = 0; i < 50; i++) {
      const resp = await stripe.checkout.sessions.list({
        limit: 100,
        status: 'complete',
        starting_after,
      });
      for (const s of resp.data) {
        const vid = s.metadata?.video_id;
        if (vid && totals[vid] !== undefined && s.payment_status === 'paid') {
          totals[vid] += s.amount_total || 0;
        }
      }
      if (!resp.has_more) break;
      starting_after = resp.data[resp.data.length - 1].id;
    }

    res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=10');
    return res.status(200).json({ totals });
  } catch (e) {
    console.error('totals error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
