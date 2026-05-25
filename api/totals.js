const Stripe = require('stripe');

const VIDEO_IDS = ['1960', '1992', '2008', '2016', 'apprentice'];

// Кэш сумм в памяти warm-инстанса. Раз в 5 секунд — пересчёт из Stripe.
// Короткий TTL чтобы после оплаты success-страница быстро увидела новую сумму.
let cache = { computed: 0, totals: null };
let inflight = null;
const TTL_MS = 5 * 1000;

async function computeTotals(stripe) {
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
  return totals;
}

async function getTotals(stripe) {
  if (cache.totals && Date.now() - cache.computed < TTL_MS) {
    return cache.totals;
  }
  // Если уже идёт пересчёт — присоединимся к нему, чтобы не плодить параллельные запросы.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const totals = await computeTotals(stripe);
      cache = { computed: Date.now(), totals };
      return totals;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

module.exports = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const totals = await getTotals(stripe);
    // CDN: 3 сек свежее, до 30 сек — отдаём stale и фоном обновляем
    res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=30');
    return res.status(200).json({ totals });
  } catch (e) {
    console.error('totals error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
