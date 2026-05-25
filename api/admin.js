// Простой админ-эндпоинт для редкой ручной работы со стейтом в KV.
// Защищён общим секретом (тот же что и Apps Script — SHEETS_WEBHOOK_SECRET).
const kvStore = require('./_kv');

module.exports = async (req, res) => {
  const secret = req.headers['x-admin-secret'] || req.query?.secret;
  if (!secret || secret !== process.env.SHEETS_WEBHOOK_SECRET) {
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
