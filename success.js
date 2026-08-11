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

  // Session-данные и общая сумма по видео — независимы, грузим параллельно.
  // Сначала показываем то что пришло первым, чтобы пользователь не сидел перед прочерками.
  const sessionPromise = fetch('/api/session?sid=' + encodeURIComponent(sid)).then(r => r.ok ? r.json() : null);
  // .catch здесь, а не только в try ниже: при архивной покупке мы выходим раньше,
  // не дождавшись промиса, и его reject остался бы необработанным.
  const totalsPromise = fetch('/api/totals?fresh=1')
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  let session = null;
  let totalsData = null;

  try {
    session = await sessionPromise;
    if (!session) throw new Error('session_fetch_failed');

    document.getElementById('video-name').textContent = session.video_name || vid || '—';
    document.getElementById('eur').textContent = session.eur != null && session.eur > 0 ? '€' + session.eur : '—';
    document.getElementById('email').textContent = session.email || '—';
    details.hidden = false;

    // Архивная покупка: эфир уже прошёл — «голосовательные» блоки (прогресс,
    // призыв собрать €100) неуместны, прячем их. Ссылку показываем если она есть;
    // если эфир прошёл, а ссылку ещё не проставили — честно обещаем письмо.
    if (session.archived) {
      document.getElementById('title').textContent = 'Спасибо за покупку!';
      const emailLabel = document.getElementById('email-label');
      const note = document.getElementById('note');
      const progressRow = document.getElementById('progress-row');
      const progressWrap = document.getElementById('progress-wrap');
      if (note) note.hidden = true;
      if (progressRow) progressRow.hidden = true;
      if (progressWrap) progressWrap.hidden = true;

      if (session.recording) {
        lead.textContent = 'Запись показа уже доступна — смотрите по ссылке ниже. Она также придёт вам в чеке на email.';
        const recordLink = document.getElementById('record-link');
        recordLink.href = session.recording;
        recordLink.textContent = session.recording;
        document.getElementById('record').hidden = false;
        if (emailLabel) emailLabel.textContent = 'Чек придёт на';
      } else {
        lead.textContent = 'Запись ещё готовится — пришлю ссылку на неё вам на почту, как только она будет готова.';
        if (emailLabel) emailLabel.textContent = 'Ссылка на запись придёт на';
      }
    }

    if (!session.paid) {
      lead.textContent = 'Платёж пока не подтверждён. Если деньги списались — он появится в течение минуты.';
    }
  } catch (e) {
    console.error('session load error', e);
    lead.textContent = 'Платёж принят. Детали временно недоступны — обнови страницу через минуту.';
    return;
  }

  // Дальше — прогресс, когда totals подгрузятся. Для архивной покупки он не
  // нужен (блоки уже скрыты выше) — не тратим время и не трогаем тексты.
  if (session.archived) return;

  try {
    totalsData = await totalsPromise;
    if (!totalsData) return;

    const cents = (totalsData.totals && totalsData.totals[session.video_id]) || 0;
    // Если сумма по этому видео в кэше меньше суммы только что прошедшего платежа,
    // значит кэш устарел и не учёл наш платёж — берём по крайней мере его сумму.
    const safeCents = Math.max(cents, session.amount_total_cents || 0);
    const eur = Math.floor(safeCents / 100);
    const pct = Math.min(100, Math.floor((safeCents / 10000) * 100));
    document.getElementById('progress-text').textContent = `€${eur} из €100`;
    document.getElementById('progress-bar').style.width = pct + '%';

    const thisCents = session.amount_total_cents || 0;
    const note = document.getElementById('note');
    if (note && safeCents >= 10000) {
      const justCrossed = (safeCents - thisCents) < 10000;
      note.innerHTML = justCrossed
        ? 'Благодаря вашему донату видео собрало €100 — совсем скоро я назначу эфир и пришлю вам на почту ссылку. Если вы почему-то не получите ссылку — смело пишите мне <a href="https://t.me/feldmanevgeny" target="_blank" rel="noopener">в личку</a>.'
        : 'Это видео уже собрало необходимую сумму, и эфир назначен. Совсем скоро я пришлю вам на почту ссылку на трансляцию. Если это почему-то не произошло — смело пишите мне <a href="https://t.me/feldmanevgeny" target="_blank" rel="noopener">в личку</a>.';
    }
  } catch (e) {
    console.error('totals load error', e);
  }
})();
