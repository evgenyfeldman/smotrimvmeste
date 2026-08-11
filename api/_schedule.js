// Расписание автоматического перехода видео в архив.
// archiveAt — UTC-инстант (эфир + 2 часа), когда:
//   - карточка на лендинге уходит из основной сетки в секцию «Архив» (клиентский JS),
//   - на /api/checkout видео начинает продаваться как запись (state 'past'),
//   - на success-странице покупателю показывается ссылка на запись.
// Фронт дублирует эти же моменты в data-атрибутах карточки (static-сайт не может
// require этот модуль) — при смене времени правь ОБА места.
const SCHEDULE = {
  '1960': {
    archiveAt: '2026-07-24T19:00:00Z', // 22:00 Мск — эфир 20:00 Мск + 2ч
    recording: 'https://youtube.com/live/_Pug1m4CGSU',
  },
  '1992': {
    archiveAt: '2026-08-29T20:00:00Z', // 23:00 Мск — эфир 21:00 Мск + 2ч
    recording: null, // ссылки на запись пока нет — проставить до 23:00 Мск 29 августа
  },
};

// Видео уже перешло в архив (эфир прошёл, запись доступна)?
function isArchived(videoId, now = Date.now()) {
  const s = SCHEDULE[videoId];
  if (!s || !s.archiveAt) return false;
  return now >= Date.parse(s.archiveAt);
}

// Ссылка на запись показа (null если её нет).
function recordingUrl(videoId) {
  return SCHEDULE[videoId]?.recording || null;
}

module.exports = { SCHEDULE, isArchived, recordingUrl };
