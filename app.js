const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const demos = {
  tournament: { description: 'Панель администратора Doyle · демонстрационные данные', html: `<div class="actual-admin-demo"><div class="actual-demo-heading"><h3>Управление игроками</h3><p>Регистрация, отметка прихода, реентри и вылеты — в одной панели.</p></div><button class="screen-zoom" data-screen="doyle-admin-players.png" data-title="Doyle — панель управления игроками" aria-label="Увеличить панель управления игроками"><img src="doyle-admin-players.png" alt="Панель управления игроками Doyle"><span class="zoom-hint">↗ Открыть в полном размере</span></button></div>` },
  seating: { description: 'Пример интерфейса · рассадка и игровой таймер', html: `<div class="demo-screen seating-screen"><div class="screen-title"><h3>Рассадка и таймер</h3><span class="screen-tag">Турнир идёт</span></div><p class="screen-subtitle">Friday Deep Stack · Игроки и игровой таймер</p><div class="seating-inner"><div class="mini-table"><span class="table-num">СТОЛ 01</span><i class="seat s1">МК</i><i class="seat s2">АП</i><i class="seat s3">ДС</i><i class="seat s4">ЕВ</i><i class="seat s5">ОН</i><i class="seat s6">КМ</i></div><div class="timer-panel"><small>УРОВЕНЬ 6</small><strong>14<span>:</span>32</strong><div class="timer-progress"></div><span>Блайнды 500 / 1 000</span></div></div><div class="seating-summary"><span>3 активных стола</span><span>24 игрока в игре</span><span>Средний стек 45 000</span></div></div>` },
  finance: { description: 'Пример интерфейса · учёт оплат за игровой день', html: `<div class="demo-screen"><div class="screen-title"><h3>Отчёт по оплатам</h3><span class="screen-tag">Игровой день</span></div><div class="finance-stats"><div><small>УЧАСТИЯ</small><strong>36</strong></div><div><small>РЕЕНТРИ</small><strong>12</strong></div><div><small>УЧТЕНО ОПЛАТ</small><strong>48 000 ₽</strong></div></div><table class="finance-table"><thead><tr><th>Игрок</th><th>Участие</th><th>Реентри</th><th>Оплачено</th></tr></thead><tbody><tr><td>Максим К.</td><td>1 000 ₽</td><td>1 000 ₽</td><td>2 000 ₽</td></tr><tr><td>Анна П.</td><td>1 000 ₽</td><td>—</td><td>1 000 ₽</td></tr><tr><td>Дмитрий С.</td><td>1 000 ₽</td><td>1 000 ₽</td><td>2 000 ₽</td></tr></tbody></table><span class="screen-action">Выгрузка в таблицу <span>↗</span></span></div>` }
};
function setDemo(tab) {
  const name = tab.dataset.tab;
  $$('.feature-tab').forEach(b => { b.classList.toggle('active', b === tab); b.setAttribute('aria-selected', String(b === tab)); b.tabIndex = b === tab ? 0 : -1; });
  $('#demo-content').innerHTML = demos[name].html;
  $('#demo-description').textContent = demos[name].description;
  $('#feature-panel').setAttribute('aria-labelledby', tab.id);
}
$$('.feature-tab').forEach((tab, index, tabs) => {
  tab.addEventListener('click', () => setDemo(tab));
  tab.addEventListener('keydown', e => {
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(index + 1) % tabs.length];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(index + tabs.length - 1) % tabs.length];
    if (e.key === 'Home') next = tabs[0];
    if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) { e.preventDefault(); setDemo(next); next.focus(); }
  });
});
setDemo($('.feature-tab'));
$$('.swatch').forEach(button => button.addEventListener('click', () => {
  $('#theme-preview').style.setProperty('--club-color', button.dataset.color);
  $$('.swatch').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
}));
const videoDialog = $('#video-dialog');
const contactDialog = $('#contact-dialog');
let lastFocus;
function openDialog(dialog) { lastFocus = document.activeElement; dialog.showModal(); document.body.style.overflow = 'hidden'; }
$$('[data-video]').forEach(button => button.addEventListener('click', () => {
  openDialog(videoDialog);
  $('video', videoDialog).play().catch(() => {});
}));
$('#contact-open').addEventListener('click', () => openDialog(contactDialog));
$$('dialog').forEach(dialog => {
  $('.dialog-close', dialog)?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { document.body.style.overflow = ''; if (dialog === videoDialog) $('video', dialog).pause(); lastFocus?.focus(); });
});
$('#copy-inquiry').addEventListener('click', async () => {
  const value = $('#inquiry-text').textContent;
  try { await navigator.clipboard.writeText(value); $('#copy-status').textContent = 'Текст скопирован. Его можно отправить команде.'; }
  catch { const range = document.createRange(); range.selectNodeContents($('#inquiry-text')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); $('#copy-status').textContent = 'Текст выделен — скопируйте его вручную.'; }
});
const menuToggle = $('.menu-toggle');
menuToggle.addEventListener('click', () => { const open = menuToggle.getAttribute('aria-expanded') !== 'true'; menuToggle.setAttribute('aria-expanded', String(open)); menuToggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню'); $('.header-inner nav').classList.toggle('open', open); });
$$('.header-inner nav a').forEach(a => a.addEventListener('click', () => { $('.header-inner nav').classList.remove('open'); menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Открыть меню'); }));
$('#year').textContent = new Date().getFullYear();

const screenDialog = $('#screen-dialog');
document.addEventListener('click', e => {
 const button = e.target.closest('[data-screen]');
 if (!button) return;
 const title = button.dataset.title;
 $('#screen-dialog-title').textContent = title;
 $('#screen-full-image').src = button.dataset.screen;
 $('#screen-full-image').alt = title;
 screenDialog.classList.toggle('portrait-screen', button.dataset.screen.includes('player-home'));
 openDialog(screenDialog);
});
$('.screen-close',screenDialog).addEventListener('click',()=>screenDialog.close());
