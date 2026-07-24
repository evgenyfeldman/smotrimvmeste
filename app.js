(() => {
  const GOAL_CENTS = 10000;

  showCancelBannerIfNeeded();

  document.querySelectorAll('.card').forEach((card) => {
    const btn = card.querySelector('.vote');
    if (btn) btn.addEventListener('click', () => openAmountForm(card));
  });

  // Сразу применяем последние известные значения из localStorage (мгновенный фидбек)
  applyCachedTotals();
  loadTotals();

  // Автопереходы по времени: во время эфира карточка скрывается, через 2 часа
  // после старта (archiveAt) уезжает в «Архив» как запись. Пересчитываем на
  // загрузке и по таймеру, чтобы открытая вкладка обновилась сама.
  applyLifecycle();

  function applyCachedTotals() {
    try {
      const raw = localStorage.getItem('lastTotals');
      if (!raw) return;
      const totals = JSON.parse(raw);
      if (!totals || typeof totals !== 'object') return;
      updateCardsFromTotals(totals);
    } catch (e) {
      // ignore
    }
  }

  function updateCardsFromTotals(totals) {
    document.querySelectorAll('.card').forEach((card) => {
      if (card.dataset.preview === '1') return;
      if (card.classList.contains('is-past')) return;
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
  }

  function showCancelBannerIfNeeded() {
    const params = new URLSearchParams(location.search);
    if (params.get('canceled') !== '1') return;
    const banner = document.createElement('div');
    banner.className = 'cancel-banner';
    banner.innerHTML = `
      <span>Оплата отменена. Попробуй снова</span>
      <button type="button" aria-label="Закрыть">×</button>
    `;
    document.body.appendChild(banner);
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    history.replaceState(null, '', location.pathname);
  }

  async function loadTotals() {
    try {
      const r = await fetch('/api/totals');
      if (!r.ok) return;
      const { totals } = await r.json();
      updateCardsFromTotals(totals);
      try { localStorage.setItem('lastTotals', JSON.stringify(totals)); } catch (e) { /* ignore */ }
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
    const isPast = card.classList.contains('is-past');
    const airDate = card.dataset.airDate || '';
    if (isPast) {
      row.innerHTML = `<button class="vote" type="button" data-video="${id}">Купить запись €5+</button>`;
    } else if (isWon) {
      row.dataset.won = '1';
      row.innerHTML = `
        <div class="won-info">
          ${airDate ? `<div class="won-date">${escapeHtml(airDate)}</div>` : ''}
          <div class="sum sum-won">Необходимая сумма собрана! Вы ещё можете купить билет</div>
        </div>
        <button class="vote" type="button" data-video="${id}">Купить билет €8+</button>
      `;
    } else {
      row.removeAttribute('data-won');
      row.innerHTML = `
        <span class="sum"><b>€${raised}</b> из €100</span>
        <button class="vote" type="button" data-video="${id}">Купить билет и проголосовать €7+</button>
      `;
    }
    row.querySelector('.vote').addEventListener('click', () => openAmountForm(card));
  }

  // --- Жизненный цикл карточки по времени (эфир → скрытие → архив) ---

  function applyLifecycle() {
    const now = Date.now();
    let nextBoundary = Infinity;

    document.querySelectorAll('.card[data-archive-at], .card[data-live-at]').forEach((card) => {
      const liveAt = card.dataset.liveAt ? Date.parse(card.dataset.liveAt) : NaN;
      const archiveAt = card.dataset.archiveAt ? Date.parse(card.dataset.archiveAt) : NaN;

      if (!Number.isNaN(archiveAt) && now >= archiveAt) {
        moveCardToArchive(card);
        return; // карточка пересобрана и убрана из сетки — таймеры ей больше не нужны
      }

      if (!Number.isNaN(liveAt) && now >= liveAt) {
        // Идёт эфир — прячем карточку до перехода в архив
        card.hidden = true;
      } else {
        card.hidden = false;
      }

      // Ближайшая будущая граница — чтобы перепланировать один таймер
      if (!Number.isNaN(liveAt) && liveAt > now) nextBoundary = Math.min(nextBoundary, liveAt);
      if (!Number.isNaN(archiveAt) && archiveAt > now) nextBoundary = Math.min(nextBoundary, archiveAt);
    });

    if (nextBoundary !== Infinity) {
      // +1с чтобы гарантированно перескочить границу; setTimeout ограничен ~24.8 дня
      const delay = nextBoundary - now + 1000;
      if (delay > 0 && delay < 2147483647) setTimeout(applyLifecycle, delay);
    }
  }

  function moveCardToArchive(card) {
    const grid = document.getElementById('archive-grid');
    const section = document.getElementById('archive');
    if (!grid || !section) return;

    const id = card.dataset.id;
    const year = card.querySelector('.card-year')?.textContent?.trim() || '';
    const title = card.querySelector('h2')?.textContent?.trim() || '';
    const desc = card.querySelector('.desc')?.textContent?.trim() || '';
    const img = card.querySelector('.card-image');
    const bgImage = img?.style.backgroundImage || '';
    const bgPos = img?.style.backgroundPosition || 'center';
    const meta = card.dataset.pastMeta || 'Эфир состоялся';

    const past = document.createElement('article');
    past.className = 'card card-past is-past';
    past.dataset.id = id;
    past.innerHTML = `
      <div class="past-img"></div>
      <div class="past-body">
        <div class="past-year">${escapeHtml(year)}</div>
        <h3>${escapeHtml(title)}</h3>
        <p class="desc">${escapeHtml(desc)}</p>
        <p class="past-meta">${escapeHtml(meta)}</p>
      </div>
      <div class="row"></div>
    `;
    // Стиль фона ставим через DOM, а не в атрибут: url("…") содержит кавычки,
    // которые оборвали бы style="…" в строке innerHTML.
    const pastImg = past.querySelector('.past-img');
    if (bgImage) pastImg.style.backgroundImage = bgImage;
    pastImg.style.backgroundPosition = bgPos;

    grid.appendChild(past);
    section.hidden = false;
    card.remove();
    renderCollapsedRow(past); // рисует кнопку «Купить запись €5+» (is-past)
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
    const isPast = card.classList.contains('is-past');
    const submitLabel = (isWon || isPast) ? 'Купить' : 'Оплатить';
    const minEur = isPast ? 5 : (isWon ? 8 : 7);
    const raised = card.dataset.raised || '0';
    const airDate = card.dataset.airDate || '';

    const formHtml = `
      <div class="form-wrap">
        <form class="vote-form" novalidate>
          <span class="vote-prefix">€</span>
          <input type="number" class="vote-amount" min="${minEur}" step="1" value="${minEur}" inputmode="numeric" required />
          <button type="submit" class="vote vote-submit">${submitLabel}</button>
          <button type="button" class="vote-cancel" aria-label="Отмена">×</button>
        </form>
        <div class="vote-error" role="alert" hidden></div>
      </div>
    `;

    if (isWon) {
      row.dataset.won = '1';
      row.innerHTML = `
        <div class="won-info">
          ${airDate ? `<div class="won-date">${escapeHtml(airDate)}</div>` : ''}
          <div class="sum sum-won">Необходимая сумма собрана! Вы ещё можете купить билет</div>
        </div>
        ${formHtml}
      `;
    } else if (isPast) {
      row.innerHTML = formHtml;
    } else {
      row.innerHTML = `
        <span class="sum"><b>€${raised}</b> из €100</span>
        ${formHtml}
      `;
    }

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
        showError(`Введи целое число от ${minEur} и больше.`);
        input.focus();
        return;
      }
      const amount = Math.floor(Number(raw));
      if (amount < minEur) {
        showError(`Минимум — €${minEur}`);
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
