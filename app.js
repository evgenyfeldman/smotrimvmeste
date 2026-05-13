(() => {
  document.querySelectorAll('.card').forEach((card) => {
    const btn = card.querySelector('.vote');
    if (btn) btn.addEventListener('click', () => openAmountForm(card));
  });

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
    `;

    const form = row.querySelector('.vote-form');
    const input = form.querySelector('.vote-amount');
    const submit = form.querySelector('.vote-submit');
    const cancel = form.querySelector('.vote-cancel');

    setTimeout(() => { input.focus(); input.select(); }, 0);

    cancel.addEventListener('click', () => collapseForm(card));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Math.floor(Number(input.value));
      if (!Number.isFinite(amount) || amount < 7 || amount > 1000) {
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
        alert('Не удалось открыть оплату. Попробуй ещё раз через минуту.');
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
