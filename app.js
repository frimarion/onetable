const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
function setRole(tab) {
  $$('.role-tab').forEach(b => { const on = b === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; $('#' + b.getAttribute('aria-controls')).hidden = !on; });
}
$$('.role-tab').forEach((tab, index, tabs) => {
  tab.addEventListener('click', () => setRole(tab));
  tab.addEventListener('keydown', e => {
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(index + 1) % tabs.length];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(index + tabs.length - 1) % tabs.length];
    if (e.key === 'Home') next = tabs[0];
    if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) { e.preventDefault(); setRole(next); next.focus(); }
  });
});
// Примерка цвета клуба: оттенок накладывается на реальный экран приложения
$$('.swatch').forEach(button => button.addEventListener('click', () => {
  const phone = $('#brand-phone');
  phone.style.setProperty('--club-color', button.dataset.color || 'transparent');
  phone.classList.toggle('is-tinted', Boolean(button.dataset.color));
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
$$('dialog').forEach(dialog => {
  $('.dialog-close', dialog)?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { document.body.style.overflow = ''; if (dialog === videoDialog) $('video', dialog).pause(); lastFocus?.focus(); });
});
const FORM_ENDPOINT = ''; // адрес приёма заявок (Formspree и т.п.); пока пусто — показываем запасной вариант
const form = $('#contact-form');
const formStatus = $('#form-status');
function showContactState(state) {
  form.hidden = state !== 'form';
  $('#form-done').hidden = state !== 'done';
  $('#form-fallback').hidden = state !== 'fallback';
  $$('#contact-dialog > p, #contact-dialog > h2, #contact-dialog > .eyebrow').forEach(el => el.hidden = state === 'done');
}
$$('[data-contact]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showContactState('form'); openDialog(contactDialog); }));
$('#contact-open').addEventListener('click', () => { showContactState('form'); openDialog(contactDialog); });
$$('[data-close-dialog]').forEach(b => b.addEventListener('click', () => contactDialog.close()));
function inquiryText(d) {
  return `Здравствуйте! Хочу посмотреть OneTable для клуба «${d.club}»${d.city ? ' (' + d.city + ')' : ''}. Связаться: ${d.contact}.${d.message ? ' ' + d.message : ''}`;
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  formStatus.textContent = '';
  if (!data.club.trim() || !data.contact.trim()) { formStatus.textContent = 'Укажите название клуба и контакт для связи.'; (data.club.trim() ? form.contact : form.club).focus(); return; }
  if (data.website) return;
  $('#inquiry-text').textContent = inquiryText(data);
  if (!FORM_ENDPOINT) { showContactState('fallback'); return; }
  const submit = $('button[type=submit]', form);
  submit.disabled = true; $('.submit-label', form).textContent = 'Отправляем…';
  try {
    const r = await fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ club: data.club, city: data.city, contact: data.contact, message: data.message }) });
    if (!r.ok) throw new Error(r.status);
    form.reset(); showContactState('done');
  } catch { showContactState('fallback'); }
  finally { submit.disabled = false; $('.submit-label', form).textContent = 'Отправить заявку'; }
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
 const mock = button.dataset.screen === 'player-mock';
 $('#screen-dialog-title').textContent = title;
 $('.screen-image-scroll .player-mock', screenDialog)?.remove();
 $('#screen-full-image').hidden = mock;
 if (mock) $('.screen-image-scroll', screenDialog).append($('.player-mock', button).cloneNode(true));
 else { $('#screen-full-image').src = button.dataset.screen; $('#screen-full-image').alt = title; }
 screenDialog.classList.toggle('portrait-screen', mock);
 openDialog(screenDialog);
});
$('.screen-close',screenDialog).addEventListener('click',()=>screenDialog.close());

// ===== Живые интерфейсы =====
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ');
const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
// Запускает fn, когда элемент виден на экране (once — один раз)
function whenVisible(el, fn, { once = true, threshold = 0.35 } = {}) {
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    fn(e.isIntersecting, e);
    if (once && e.isIntersecting) io.disconnect();
  }), { threshold });
  io.observe(el);
}
function countUp(el, ms = 1200) {
  const to = Number(el.dataset.count);
  if (reduceMotion) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / ms); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// 1. Админка: игроки отмечаются, реентри растут, уровень тикает; в герое на телефон приходит пуш
const waiting = [['ivan', 'Иван'], ['maria', 'Мария'], ['pavel', 'Павел'], ['ekaterina', 'Екатерина']];
$$('.admin-mock').forEach(mock => {
  const live = $('.am-live', mock);
  const clock = document.createElement('b');
  clock.className = 'am-clock';
  live.append(' · ', clock);
  const count = $('.am-count b', mock);
  const rows = $$('.am-row:not(.am-head)', mock);
  const last = rows[rows.length - 1];
  const push = mock.closest('.hero') && $('#hero-push');
  let left = 14 * 60 + 52, players = 24, step = 0, next = 0, visible = false;
  const flash = row => { row.classList.add('am-flash'); setTimeout(() => row.classList.remove('am-flash'), 1400); };
  const actions = [
    () => { // отметка прихода
      $('.am-check', last).classList.add('on');
      const st = $('.am-status', last); st.classList.remove('wait'); st.textContent = 'В игре';
      count.textContent = `${++players} / 45`;
      flash(last);
      if (push) { push.classList.add('show'); setTimeout(() => push.classList.remove('show'), 3200); }
    },
    () => { // реентри у случайного игрока в игре
      const row = rows[[0, 3, 1, 4][step % 4]];
      const re = $('.am-re', row);
      let n = $('small', re);
      if (!n) { n = document.createElement('small'); n.textContent = '×0'; re.append(n); }
      n.textContent = '×' + (Number(n.textContent.slice(1)) + 1);
      n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump');
      flash(row);
    },
    () => { // новый записавшийся игрок
      last.classList.add('am-swap');
      setTimeout(() => {
        const [file, name] = waiting[next++ % waiting.length];
        const player = $('.am-player', last);
        $('img', player).src = `avatars/${file}.webp`;
        player.lastChild.textContent = name;
        $('.am-check', last).classList.remove('on');
        const st = $('.am-status', last); st.classList.add('wait'); st.textContent = 'Записан';
        if (players >= 28) { players = 24; count.textContent = '24 / 45'; }
        last.classList.remove('am-swap');
      }, 320);
    }
  ];
  clock.textContent = mmss(left);
  whenVisible(mock, v => visible = v, { once: false, threshold: 0.2 });
  setInterval(() => {
    if (!visible || document.hidden) return;
    left = left > 0 ? left - 1 : 20 * 60;
    clock.textContent = mmss(left);
    if (left % 3 === 0) actions[step++ % actions.length]();
  }, 1000);
});

// 2. Таймер турнира: настоящий обратный отсчёт, смена уровней, пауза
(() => {
  const mock = $('#timer-mock');
  if (!mock) return;
  const levels = [[100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [600, 1200], [700, 1400], [800, 1600], [1000, 2000], [1200, 2400], [1500, 3000], [2000, 4000], [2500, 5000], [3000, 6000], [4000, 8000]];
  const LEN = 20 * 60, CHIPS = 3280000;
  let level = 8, left = 12, players = 52, paused = false, visible = false, ticks = 0;
  const el = id => $('#tm-' + id);
  const blinds = l => `${fmt(levels[l][0])} / ${fmt(levels[l][1])}`;
  function render(levelChanged) {
    el('level').textContent = level + 1;
    el('blinds').textContent = blinds(level);
    el('ante').textContent = `BB ANTE ${fmt(levels[level][1])}`;
    el('next').textContent = levels[level + 1] ? blinds(level + 1) : '—';
    el('clock').textContent = mmss(left);
    el('bar').style.transform = `scaleX(${(LEN - left) / LEN})`;
    const breakLevel = Math.ceil((level + 1) / 5) * 5; // перерыв после каждого 5-го уровня
    const breakIn = Math.floor((left + (breakLevel - level - 1) * LEN) / 60);
    el('break').textContent = `${Math.max(1, breakIn)} мин`;
    el('late').textContent = level < 10 ? `${Math.max(1, Math.floor((left + (9 - level) * LEN) / 60))} мин` : 'Закрыта';
    el('players').textContent = players;
    el('avg').textContent = fmt(CHIPS / players);
    if (levelChanged && !reduceMotion) { mock.classList.remove('level-up'); void mock.offsetWidth; mock.classList.add('level-up'); }
  }
  function nextLevel() {
    level = (level + 1) % levels.length;
    if (level === 0) players = 52;
    left = LEN;
    render(true);
  }
  render();
  whenVisible(mock, v => visible = v, { once: false, threshold: 0.3 });
  setInterval(() => {
    if (paused || !visible || document.hidden) return;
    if (--left < 0) return nextLevel();
    if (++ticks % 9 === 0 && players > 40) players--; // кто-то вылетел
    render();
  }, 1000);
  const toggle = el('toggle');
  toggle.addEventListener('click', () => {
    paused = !paused;
    mock.classList.toggle('paused', paused);
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.innerHTML = paused ? '▶ <span>Старт</span>' : '❚❚ <span>Пауза</span>';
  });
  el('skip').addEventListener('click', nextLevel);
})();

// 3. Вечер как лог системы: при появлении блока часы бегут, шаги загораются по очереди
(() => {
  const tl = $('.day-timeline');
  if (!tl || reduceMotion) return;
  const items = $$('.tl-list li', tl);
  const clock = $('#tl-clock');
  const toMin = t => { const [h, m] = t.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + m; };
  const times = items.map(li => toMin($('time', li).textContent));
  const show = m => { m = Math.round(m) % 1440; clock.textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  tl.classList.add('tl-anim');
  items.forEach(li => li.classList.remove('is-live'));
  show(times[0]);
  whenVisible(tl, () => {
    let i = 0;
    const reach = () => {
      const li = items[i];
      items.forEach(x => x.classList.remove('is-live'));
      li.classList.add('reached', 'is-live');
      $$('[data-count]', li).forEach(n => countUp(n, 900));
      if (i === items.length - 1) return;
      setTimeout(() => {
        li.classList.add('passed');
        const from = times[i], to = times[i + 1], t0 = performance.now();
        const run = t => { const k = Math.min(1, (t - t0) / 900); show(from + (to - from) * k); if (k < 1) requestAnimationFrame(run); else { i++; reach(); } };
        requestAnimationFrame(run);
      }, 700);
    };
    reach();
  }, { threshold: 0.45 });
})();

// 4. Микро-детали: метки печатаются, блоки проявляются, цифры отчёта досчитываются
if (!reduceMotion) {
  $$('main .eyebrow').forEach(eb => {
    const node = [...eb.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim());
    if (!node || eb.closest('.hero')) return;
    const full = node.textContent;
    eb.setAttribute('aria-label', full.trim());
    node.textContent = '';
    whenVisible(eb, () => {
      eb.classList.add('typing');
      let k = 0;
      const t = setInterval(() => { node.textContent = full.slice(0, ++k); if (k >= full.length) { clearInterval(t); setTimeout(() => eb.classList.remove('typing'), 600); } }, 28);
    }, { threshold: 1 });
  });
  $$('.section-heading, .app-art, .app-copy, .system-layout, .day-timeline, .video-preview, .faq-list, .contact-inner, .proof-inner').forEach(el => {
    el.classList.add('rv');
    whenVisible(el, () => el.classList.add('in'), { threshold: 0.12 });
  });
}
$$('.owner-report').forEach(report => {
  if (!reduceMotion) report.classList.add('pre');
  whenVisible(report, () => { report.classList.remove('pre'); $$('[data-count]', report).forEach(n => countUp(n)); }, { threshold: 0.5 });
});
