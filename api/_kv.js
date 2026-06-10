// Опциональная обёртка над Vercel KV: если переменных нет — null, можно безопасно фоллбэчиться.
let kvInstance = null;
let triedInit = false;

function getKv() {
  if (triedInit) return kvInstance;
  triedInit = true;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    const mod = require('@vercel/kv');
    kvInstance = mod.kv;
  } catch (e) {
    console.error('kv require failed', e);
  }
  return kvInstance;
}

const VIDEO_IDS = ['1960', '1992', '2008', '2016', 'apprentice'];
const KEY_PREFIX = 'total:';

function key(videoId) {
  return KEY_PREFIX + videoId;
}

async function readTotals() {
  const kv = getKv();
  if (!kv) return null;
  const keys = VIDEO_IDS.map(key);
  const values = await kv.mget(...keys);
  // Если ВСЕ ключи отсутствуют — KV не инициализирован
  if (values.every((v) => v == null)) return null;
  const out = {};
  VIDEO_IDS.forEach((id, i) => {
    out[id] = Number(values[i] || 0);
  });
  return out;
}

async function writeTotals(totals) {
  const kv = getKv();
  if (!kv) return;
  await Promise.all(
    VIDEO_IDS.map((id) => kv.set(key(id), Number(totals[id] || 0)))
  );
}

async function incrementTotal(videoId, cents) {
  const kv = getKv();
  if (!kv || !VIDEO_IDS.includes(videoId) || !cents) return null;
  return await kv.incrby(key(videoId), cents);
}

// Rate limit: возвращает { allowed, count, limit }. Если KV не работает — разрешаем (fail-open).
// Окно фиксированное: первый incr выставляет TTL, последующие в окне его наследуют.
async function checkRateLimit(bucket, limit, windowSec) {
  const kv = getKv();
  if (!kv) return { allowed: true, count: 0, limit };
  const k = 'rl:' + bucket;
  try {
    const count = await kv.incr(k);
    if (count === 1) {
      // первый запрос в окне — ставим TTL
      await kv.expire(k, windowSec);
    }
    return { allowed: count <= limit, count, limit };
  } catch (e) {
    console.error('rate limit error', e);
    return { allowed: true, count: 0, limit };
  }
}

// Дедуп webhook-событий через KV (TTL 1 день). Возвращает true если первый раз.
async function tryClaimEvent(eventId) {
  const kv = getKv();
  if (!kv) return true; // если KV не работает, пропускаем дедуп
  const k = 'evt:' + eventId;
  const result = await kv.set(k, '1', { nx: true, ex: 86400 });
  // @vercel/kv: set с nx возвращает 'OK' если поставили, null если уже существовало
  return result === 'OK' || result === true;
}

// Снимает claim с события — вызываем при ошибке обработки, чтобы ретрай Stripe
// не был отброшен дедупом и платёж не потерялся.
async function releaseEvent(eventId) {
  const kv = getKv();
  if (!kv) return;
  await kv.del('evt:' + eventId);
}

module.exports = {
  isEnabled: () => !!getKv(),
  readTotals,
  writeTotals,
  incrementTotal,
  tryClaimEvent,
  releaseEvent,
  checkRateLimit,
  VIDEO_IDS,
};
