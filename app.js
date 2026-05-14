(() => {
  showCancelBannerIfNeeded();

  document.querySelectorAll('.card').forEach((card) => {
    const btn = card.querySelector('.vote');
    if (btn) btn.addEventListener('click', () => openAmountForm(card));
  });

  loadTotals();

  function showCancelBannerIfNeeded() {
    const params = new URLSearchParams(location.search);
    if (params.get('canceled') !== '1') return;
    const banner = document.createElement('div');
    banner.className = 'cancel-banner';
    banner.innerHTML = `
      <span>Оплата отменена. Можно попробовать снова — голос пока не засчитан.</span>
      <button type="button" aria-label="Закрыть">×</button>
    `;
    const hero = document.querySelector('.hero');
    hero?.insertAdjacentElement('afterend', banner);
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    history.replaceState(null, '', location.pathname);
  }

  async function loadTotals() {
    try {
      const r = await fetch('/api/totals');
      if (!r.ok) return;
      const { totals } = await r.json();
      document.querySelectorAll('.card').forEach((card) => {
        if (card.querySelector('.row')?.dataset.expanded) return;
        const id = card.dataset.id;
        const cents = (totals && totals[id]) || 0;
        const eur = Math.floor(cents / 100);
        const pct = Math.min(100, Math.floor((cents / 10000) * 100));
        card.dataset.raised = String(eur);
        const bar = card.querySelector('.progress > span');
        if (bar) bar.style.width = pct + '%';
        const sumB = card.querySelector('.sum b');
        if (sumB) sumB.textContent = '€' + eur;
      });
    } catch (e) {
      console.error('totals load error', e);
    }
  }

  function openAmountForm(card) {
    const row = card.querySelector('.row');
    if (row.dataset.expanded) return;
    row.dataset.expanded = '1';
    const videoId = card.dataset.id;

    row.innerHTML = `
      <form class="vote-form" novalidate>
        <span class="vote-prefix">€</span>
        <input type="number" class="vote-amount" min="7" max="1000" step="1" value="7" inputmode="numeric" required />
        <button type="submit" class="vote vote-submit">Оплатить</button>
        <button type="button" class="vote-cancel" aria-label="Отмена">×</button>
      </form>
      <div class="vote-error" role="alert" hidden></div>
    `;

    const form = row.querySelector('.vote-form');
    const input = form.querySelector('.vote-amount');
    const submit = form.querySelector('.vote-submit');
    const cancel = form.querySelector('.vote-cancel');
    const errEl = row.querySelector('.vote-error');

    const showError = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
    const clearError = () => { errEl.hidden = true; errEl.textContent = ''; };

    input.addEventListener('input', clearError);

    setTimeout(() => { input.focus(); input.select(); }, 0);

    cancel.addEventListener('click', () => collapseForm(card));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const raw = input.value.trim();
      if (raw === '' || isNaN(Number(raw))) {
        showError('Введи целое число от 7 до 1000');
        input.focus();
        return;
      }
      const amount = Math.floor(Number(raw));
      if (amount < 7) {
        showError('Минимум — €7. Сумма меньше не засчитывается как голос.');
        input.focus();
        input.select();
        return;
      }
      if (amount > 1000) {
        showError('Максимум €1000 за раз. Если хочешь больше — сделай несколько голосов.');
        input.focus();
        input.select();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Открываем Stripe…';
      try {
        const r = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: videoId, amount }),
        });
        if (!r.ok) throw new Error('http_' + r.status);
        const { url } = await r.json();
        if (!url) throw new Error('no_url');
        window.location.href = url;
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        submit.textContent = 'Оплатить';
        showError('Не удалось открыть оплату. Попробуй ещё раз через минуту.');
      }
    });
  }

  function collapseForm(card) {
    const row = card.querySelector('.row');
    const videoId = card.dataset.id;
    const raised = card.dataset.raised || '0';
    row.removeAttribute('data-expanded');
    row.innerHTML = `
      <span class="sum"><b>€${raised}</b> из €100</span>
      <button class="vote" type="button" data-video="${videoId}">Проголосовать €7+</button>
    `;
    row.querySelector('.vote').addEventListener('click', () => openAmountForm(card));
  }
})();
