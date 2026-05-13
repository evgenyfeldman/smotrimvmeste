(async () => {
  const params = new URLSearchParams(location.search);
  const sid = params.get('sid');
  const vid = params.get('vid');
  const lead = document.getElementById('lead');
  const details = document.getElementById('details');

  if (!sid) {
    lead.textContent = 'Не удалось определить твой платёж. Если списание прошло — напиши нам.';
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
