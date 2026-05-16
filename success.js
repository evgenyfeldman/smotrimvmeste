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
    const [sessionRes, totalsRes] = await Promise.all([
      fetch('/api/session?sid=' + encodeURIComponent(sid)),
      fetch('/api/totals'),
    ]);

    if (!sessionRes.ok) throw new Error('session_fetch_failed');
    const session = await sessionRes.json();

    document.getElementById('video-name').textContent = session.video_name || vid || '—';
    document.getElementById('eur').textContent = '€' + (session.eur ?? '—');
    document.getElementById('email').textContent = session.email || '—';

    if (totalsRes.ok) {
      const { totals } = await totalsRes.json();
      const cents = (totals && totals[session.video_id]) || 0;
      const eur = Math.floor(cents / 100);
      const pct = Math.min(100, Math.floor((cents / 10000) * 100));
      document.getElementById('progress-text').textContent = `€${eur} из €100`;
      document.getElementById('progress-bar').style.width = pct + '%';

      const thisCents = Math.round((session.eur || 0) * 100);
      const justCrossed = cents >= 10000 && (cents - thisCents) < 10000;
      if (justCrossed) {
        const note = document.getElementById('note');
        if (note) {
          note.innerHTML = 'Благодаря вашему донату видео собрало €100 — совсем скоро я назначу эфир и пришлю вам на почту ссылку. Если вы почему-то не получите ссылку — смело пишите мне <a href="https://t.me/feldmanevgeny" target="_blank" rel="noopener">в личку</a>.';
        }
      }
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
