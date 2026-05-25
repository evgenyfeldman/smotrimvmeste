const Stripe = require('stripe');
const kvStore = require('./_kv');

const VIDEO_IDS = kvStore.VIDEO_IDS;

// Локальный кэш в памяти warm-инстанса. Используется если KV недоступен или как ускоритель.
let memCache = { computed: 0, totals: null };
let inflight = null;
const TTL_MS = 5 * 60 * 1000;

async function computeFromStripe(stripe) {
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

async function getTotals(stripe, { bypassCache } = {}) {
  // Если KV подключён — основной источник правды это он.
  if (kvStore.isEnabled()) {
    let totals = await kvStore.readTotals();
    if (!totals) {
      // KV пуст — инициализируем из Stripe (одноразово)
      totals = await computeFromStripe(stripe);
      await kvStore.writeTotals(totals);
    }
    return totals;
  }

  // Фоллбэк: память warm-инстанса + полный пересчёт из Stripe
  if (!bypassCache && memCache.totals && Date.now() - memCache.computed < TTL_MS) {
    return memCache.totals;
  }
  if (!bypassCache && memCache.totals && !inflight) {
    inflight = (async () => {
      try {
        const totals = await computeFromStripe(stripe);
        memCache = { computed: Date.now(), totals };
        return totals;
      } finally {
        inflight = null;
      }
    })();
    return memCache.totals;
  }
  if (inflight && !bypassCache) {
    return memCache.totals || inflight;
  }
  inflight = (async () => {
    try {
      const totals = await computeFromStripe(stripe);
      memCache = { computed: Date.now(), totals };
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
    const bypassCache = req.query?.fresh === '1';
    const totals = await getTotals(stripe, { bypassCache });

    if (kvStore.isEnabled()) {
      // KV — источник правды и сам мгновенный, кэшировать на CDN не имеет смысла:
      // тогда бы стейл-данные пересиливали свежие из KV.
      res.setHeader('Cache-Control', 'no-store');
    } else if (bypassCache) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    return res.status(200).json({ totals });
  } catch (e) {
    console.error('totals error', e);
    return res.status(500).json({ error: 'server_error' });
  }
};
