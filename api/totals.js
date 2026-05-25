const Stripe = require('stripe');

const VIDEO_IDS = ['1960', '1992', '2008', '2016', 'apprentice'];

// Кэш сумм в памяти warm-инстанса. Большой TTL (5 минут) для скорости главной страницы.
// При оплате success-страница использует свой механизм (см. /api/session) и видит свежие цифры,
// поэтому здесь приоритет — скорость, а не свежесть.
let cache = { computed: 0, totals: null };
let inflight = null;
const TTL_MS = 5 * 60 * 1000;

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
  // Если есть кэш и он свежий — мгновенный ответ
  if (cache.totals && Date.now() - cache.computed < TTL_MS) {
    return cache.totals;
  }
  // Если есть кэш (пусть и протухший), а пересчёт ещё не идёт — запускаем фоном, отдаём старое
  if (cache.totals && !inflight) {
    inflight = (async () => {
      try {
        const totals = await computeTotals(stripe);
        cache = { computed: Date.now(), totals };
        return totals;
      } finally {
        inflight = null;
      }
    })();
    return cache.totals;
  }
  // Если идёт пересчёт — присоединяемся
  if (inflight) {
    return cache.totals || inflight;
  }
  // Совсем нет данных — придётся подождать
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
    const fresh = req.query?.fresh === '1';
    let totals;
    if (fresh) {
      // Используется success-страницей: пользователь только что заплатил, показываем без кэша.
      totals = await computeTotals(stripe);
      cache = { computed: Date.now(), totals };
      res.setHeader('Cache-Control', 'no-store');
    } else {
      totals = await getTotals(stripe);
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    return res.status(200).json({ totals });
  } catch (e) {
    console.error('totals error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
