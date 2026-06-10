// Простой админ-эндпоинт для редкой ручной работы со стейтом в KV.
// Секрет — ТОЛЬКО через заголовок x-admin-secret: query-string попадает в логи
// Vercel и историю браузера. ADMIN_SECRET — отдельный от Sheets, чтобы утечка
// одного не открывала второй; фоллбэк на SHEETS_WEBHOOK_SECRET пока ADMIN_SECRET
// не задан в env.
const crypto = require('crypto');
const kvStore = require('./_kv');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

module.exports = async (req, res) => {
  // Rate limit до проверки секрета — иначе его можно перебирать без ограничений.
  // x-real-ip ставит сам Vercel (в отличие от x-forwarded-for, куда клиент
  // может подсунуть свои значения).
  const ip = req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  const rl = await kvStore.checkRateLimit('admin:' + ip, 10, 60);
  if (!rl.allowed) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'too_many_requests' });
  }

  const expected = process.env.ADMIN_SECRET || process.env.SHEETS_WEBHOOK_SECRET;
  const secret = req.headers['x-admin-secret'];
  if (!secret || !expected || !safeEqual(secret, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!kvStore.isEnabled()) {
    return res.status(500).json({ error: 'kv_not_configured' });
  }

  const action = req.query?.action;

  // GET state
  if (req.method === 'GET' && (!action || action === 'state')) {
    const totals = await kvStore.readTotals();
    return res.status(200).json({ totals });
  }

  // POST reset
  if (req.method === 'POST' && action === 'reset') {
    const videoId = req.query?.video;
    const valueRaw = req.query?.to;
    const value = Number(valueRaw ?? 0);
    if (!videoId || !kvStore.VIDEO_IDS.includes(videoId)) {
      return res.status(400).json({ error: 'invalid_video', valid: kvStore.VIDEO_IDS });
    }
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: 'invalid_value' });
    }
    const current = await kvStore.readTotals();
    const next = { ...(current || {}) };
    next[videoId] = value;
    await kvStore.writeTotals(next);
    return res.status(200).json({ ok: true, totals: next });
  }

  return res.status(400).json({ error: 'unknown_action', usage: {
    'GET /api/admin': 'returns current totals',
    'POST /api/admin?action=reset&video=1960&to=0': 'sets total cents for a video',
  }});
};
