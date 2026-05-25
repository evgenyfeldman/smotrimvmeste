(async () => {
  const params = new URLSearchParams(location.search);
  const sid = params.get('sid');
  const vid = params.get('vid');
  const lead = document.getElementById('lead');
  const details = document.getElementById('details');

  if (!sid) {
    lead.innerHTML = 'Не удалось определить твой платёж. Если списание прошло — напиши мне в <a href="https://t.me/feldmanevgeny" target="_blank" rel="noopener">Telegram</a>.';
    return;
  }

  try {
    const sessionRes = await fetch('/api/session?sid=' + encodeURIComponent(sid));
    if (!sessionRes.ok) throw new Error('session_fetch_failed');
    const session = await sessionRes.json();

    document.getElementById('video-name').textContent = session.video_name || vid || '—';
    document.getElementById('eur').textContent = session.eur != null && session.eur > 0 ? '€' + session.eur : '—';
    document.getElementById('email').textContent = session.email || '—';

    // Свежая сумма по видео уже посчитана сервером (без кэшей) — берём оттуда.
    const cents = session.video_total_cents ?? 0;
    const totalEur = Math.floor(cents / 100);
    const pct = Math.min(100, Math.floor((cents / 10000) * 100));
    document.getElementById('progress-text').textContent = `€${totalEur} из €100`;
    document.getElementById('progress-bar').style.width = pct + '%';

    const thisCents = Math.round((session.eur || 0) * 100);
    const note = document.getElementById('note');
    if (note && cents >= 10000) {
      const justCrossed = (cents - thisCents) < 10000;
      note.innerHTML = justCrossed
        ? 'Благодаря вашему донату видео собрало €100 — совсем скоро я назначу эфир и пришлю вам на почту ссылку. Если вы почему-то не получите ссылку — смело пишите мне <a href="https://t.me/feldmanevgeny" target="_blank" rel="noopener">в личку</a>.'
        : 'Это видео уже собрало необходимую сумму, и эфир назначен. Совсем скоро я пришлю вам на почту ссылку на трансляцию. Если это почему-то не произошло — смело пишите мне <a href="https://t.me/feldmanevgeny" target="_blank" rel="noopener">в личку</a>.';
    }

    details.hidden = false;

    if (!session.paid) {
      lead.textContent = 'Платёж пока не подтверждён. Если деньги списались — он появится в течение минуты.';
    }
  } catch (e) {
    console.error(e);
    lead.textContent = 'Платёж принят. Детали временно недоступны — обнови страницу через минуту.';
  }
})();
