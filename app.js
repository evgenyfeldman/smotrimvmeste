(() => {
  const GOAL_CENTS = 10000;

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
      <span>Оплата отменена. Попробуй снова</span>
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
        if (card.dataset.preview === '1') return;
        if (card.querySelector('.row')?.dataset.expanded) return;
        const id = card.dataset.id;
        const cents = (totals && totals[id]) || 0;
        const eur = Math.floor(cents / 100);
        const pct = Math.min(100, Math.floor((cents / 10000) * 100));
        const isWon = cents >= GOAL_CENTS;
        card.dataset.raised = String(eur);
        card.classList.toggle('is-won', isWon);
        const bar = card.querySelector('.progress > span');
        if (bar) bar.style.width = pct + '%';
        renderCollapsedRow(card);
      });
    } catch (e) {
      console.error('totals load error', e);
    }
  }

  function renderCollapsedRow(card) {
    const row = card.querySelector('.row');
    if (row.dataset.expanded) return;
    const id = card.dataset.id;
    const raised = card.dataset.raised || '0';
    const isWon = card.classList.contains('is-won');
    const airDate = card.dataset.airDate || '';
    if (isWon) {
      row.dataset.won = '1';
      row.innerHTML = `
        <div class="won-info">
          ${airDate ? `<div class="won-date">Эфир ${escapeHtml(airDate)}</div>` : ''}
          <div class="sum sum-won">✅ <b>€${raised}</b> собрано · билеты в продаже</div>
        </div>
        <button class="vote" type="button" data-video="${id}">Купить билет €7+</button>
      `;
    } else {
      row.removeAttribute('data-won');
      row.innerHTML = `
        <span class="sum"><b>€${raised}</b> из €100</span>
        <button class="vote" type="button" data-video="${id}">Проголосовать €7+</button>
      `;
    }
    row.querySelector('.vote').addEventListener('click', () => openAmountForm(card));
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openAmountForm(card) {
    const row = card.querySelector('.row');
    if (row.dataset.expanded) return;
    row.dataset.expanded = '1';
    const videoId = card.dataset.id;
    const isWon = card.classList.contains('is-won');
    const submitLabel = isWon ? 'Купить' : 'Оплатить';

    row.innerHTML = `
      <form class="vote-form" novalidate>
        <span class="vote-prefix">€</span>
        <input type="number" class="vote-amount" min="7" step="1" value="7" inputmode="numeric" required />
        <button type="submit" class="vote vote-submit">${submitLabel}</button>
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
        showError('Введи целое число от 7 и больше.');
        input.focus();
        return;
      }
      const amount = Math.floor(Number(raw));
      if (amount < 7) {
        showError('Минимум — €7');
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
        submit.textContent = submitLabel;
        showError('Не удалось открыть страницу оплаты. Попробуй ещё раз через минуту.');
      }
    });
  }

  function collapseForm(card) {
    const row = card.querySelector('.row');
    row.removeAttribute('data-expanded');
    renderCollapsedRow(card);
  }
})();
