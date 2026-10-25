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
  if (!data.consent) { formStatus.textContent = 'Отметьте согласие на обработку персональных данных — без него заявку не отправить.'; form.consent.focus(); return; }
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

// 1. Админка: игроки отмечаются, реентри растут, уровень тикает
const waiting = [['ivan', 'Иван'], ['maria', 'Мария'], ['pavel', 'Павел'], ['ekaterina', 'Екатерина']];
$$('.admin-mock').forEach(mock => {
  if (mock.closest('.hero')) return; // в герое список живёт от нажатия на телефон (см. п. 3)
  const live = $('.am-live', mock);
  const clock = document.createElement('b');
  clock.className = 'am-clock';
  live.append(' · ', clock);
  const count = $('.am-count b', mock);
  const rows = $$('.am-row:not(.am-head)', mock);
  const last = rows[rows.length - 1];
  let left = 14 * 60 + 52, players = 24, step = 0, next = 0, visible = false;
  const flash = row => { row.classList.add('am-flash'); setTimeout(() => row.classList.remove('am-flash'), 1400); };
  const actions = [
    () => { // отметка прихода
      $('.am-check', last).classList.add('on');
      const st = $('.am-status', last); st.classList.remove('wait'); st.textContent = 'В игре';
      count.textContent = `${++players} / 45`;
      flash(last);
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
  let level = 8, left = 12, players = 52, paused = false, onBreak = false, finalTable = false, visible = false, ticks = 0;
  const el = id => $('#tm-' + id);
  const blinds = l => `${fmt(levels[l][0])} / ${fmt(levels[l][1])}`;
  function render(levelChanged) {
    el('level').textContent = level + 1;
    el('blinds').textContent = blinds(level);
    el('ante').textContent = onBreak ? 'ПЕРЕРЫВ' : `BB ANTE ${fmt(levels[level][1])}`;
    el('next').textContent = levels[level + 1] ? blinds(level + 1) : '—';
    el('clock').textContent = mmss(left);
    const rm = id => $('#rm-' + id);
    if (rm('clock')) {
      rm('clock').textContent = mmss(left);
      rm('level').textContent = level + 1;
      rm('bar').style.transform = `scaleX(${(LEN - left) / LEN})`;
      rm('blinds').textContent = blinds(level);
      rm('ante').textContent = `анте ${fmt(levels[level][1])}`;
      rm('next').textContent = levels[level + 1] ? blinds(level + 1) : '—';
      rm('state').textContent = onBreak ? 'Перерыв' : paused ? 'Пауза' : 'Идёт';
    }
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
  const toggle = el('toggle'), breakBtn = el('breakbtn'), finalBtn = el('final');
  const icon = (d, st) => `<svg viewBox="0 0 24 24" aria-hidden="true"${st ? ' class="st"' : ''}>${d}</svg>`;
  const PLAY = icon('<path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z"/>');
  const PAUSE = icon('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>');
  function setPaused(p) {
    paused = p;
    mock.classList.toggle('paused', p);
    $('#remote').classList.toggle('is-paused', p);
    toggle.setAttribute('aria-pressed', String(p));
    toggle.innerHTML = p ? PLAY + ' <span>Продолжить</span>' : PAUSE + ' <span>Пауза</span>';
    render();
  }
  function setBreak(b) {
    onBreak = b;
    breakBtn.setAttribute('aria-pressed', String(b));
    $('span', breakBtn).textContent = b ? 'Финиш брейка' : 'Перерыв';
    setPaused(b);
  }
  function setFinal(f) {
    finalTable = f;
    finalBtn.classList.toggle('on', f);
    finalBtn.setAttribute('aria-pressed', String(f));
    $('.tm-name', mock).textContent = f ? 'Финальный стол' : 'Friday Deep Stack';
    $('#rm-name').textContent = f ? 'Финальный стол' : 'Friday Deep Stack';
  }
  toggle.addEventListener('click', () => { if (onBreak) setBreak(false); else setPaused(!paused); });
  el('start').addEventListener('click', () => { if (onBreak) setBreak(false); else setPaused(false); });
  el('skip').addEventListener('click', () => { if (onBreak) setBreak(false); nextLevel(); });
  el('prev').addEventListener('click', () => { level = (level + levels.length - 1) % levels.length; left = LEN; render(true); });
  el('minus').addEventListener('click', () => { left = Math.max(0, left - 60); render(); });
  el('plus').addEventListener('click', () => { left = Math.min(LEN, left + 60); render(); });
  breakBtn.addEventListener('click', () => setBreak(!onBreak));
  finalBtn.addEventListener('click', () => setFinal(!finalTable));
  el('reset').addEventListener('click', () => { level = 0; left = LEN; if (onBreak) setBreak(false); setFinal(false); setPaused(false); render(true); });
})();

// 3. Игровой вечер: шаги слева, экран продукта справа; шаги сменяются сами, пока блок на экране
(() => {
  const root = $('.wf');
  if (!root) return;
  const steps = $$('.wf-step', root), panels = $$('.wf-panel', root), clock = $('#wf-clock');
  let cur = 0;
  function show(i, focus) {
    cur = (i + steps.length) % steps.length;
    steps.forEach((s, k) => {
      const on = k === cur;
      s.classList.toggle('on', on);
      s.setAttribute('aria-selected', String(on));
      s.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (clock) clock.textContent = steps[cur].dataset.time;
    $$('[data-count]', panels[cur]).forEach(n => countUp(n, 900));
    if (focus) steps[cur].focus();
  }
  steps.forEach((s, k) => {
    s.addEventListener('click', () => show(k));
    s.addEventListener('keydown', e => {
      const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (move) { e.preventDefault(); show(k + move, true); }
    });
  });
  if (reduceMotion) return;
  // полоса под активным шагом заполняется за 6 секунд, по её окончании включается следующий шаг
  root.addEventListener('animationend', e => { if (e.animationName === 'wf-fill') show(cur + 1); });
  whenVisible(root, v => root.classList.toggle('is-run', v), { once: false, threshold: 0.4 });
  const hold = on => root.classList.toggle('is-hold', on);
  root.addEventListener('pointerenter', () => hold(true));
  root.addEventListener('pointerleave', () => hold(false));
  root.addEventListener('focusin', () => hold(true));
  root.addEventListener('focusout', () => hold(false));
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

// 3. Телефон в герое: нажатие записывает на турнир, повторное — отменяет; список на Mac следует за телефоном
(() => {
  const btn = $('.hero-phone [data-register]');
  const mac = $('.hero .admin-mock');
  if (!btn || !mac) return;
  const screen = btn.closest('.iphone-screen');
  const cta = $('.pm-cta', btn);
  const seats = $('.pm-meta span:last-child', btn).lastChild;
  const live = $('#reg-status');
  const head = $('.am-head', mac);
  const count = $('.am-count b', mac);
  const base = $$('.am-row:not(.am-head)', mac).length;
  const label = 'Приложение игрока Doyle: нажмите, чтобы ';
  let state = 'idle', me = null, timer = 0;
  const renumber = () => $$('.am-row:not(.am-head)', mac).forEach((row, i) => { row.firstElementChild.textContent = i + 1; });
  const total = n => { count.textContent = `${n} / 45`; seats.textContent = `${n} из 45`; };
  const bump = () => { const box = seats.parentNode; box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump'); };
  const addMe = () => {
    me = document.createElement('div');
    me.className = 'am-row am-in';
    me.innerHTML = '<span></span><span class="am-player"><img src="avatars/maksim.webp" alt="" width="160" height="160">Максим</span><span class="am-status wait">Записан</span><span class="am-check"></span><span class="am-re"><em>R−</em><em>R+</em></span><span>0</span>';
    head.after(me);
    renumber();
    total(base + 1);
    bump();
    setTimeout(() => me && me.classList.remove('am-in'), 700);
  };
  const removeMe = () => {
    const row = me; me = null;
    row.classList.add('am-gone');
    setTimeout(() => { row.remove(); renumber(); }, reduceMotion ? 0 : 450);
    total(base);
    bump();
  };
  const show = (s, text) => {
    state = s;
    cta.classList.remove('busy', 'done', 'hint');
    cta.classList.add(s === 'idle' ? 'hint' : s);
    cta.textContent = text;
    btn.setAttribute('aria-label', label + (s === 'done' ? 'отменить запись на турнир' : 'записаться на турнир Classic Tournament'));
  };
  show('idle', 'Записаться на турнир');
  btn.addEventListener('click', e => {
    if (state === 'busy') return;
    if (!reduceMotion) {
      const r = screen.getBoundingClientRect(), c = cta.getBoundingClientRect();
      const x = e.detail ? e.clientX : c.left + c.width / 2, y = e.detail ? e.clientY : c.top + c.height / 2;
      const dot = document.createElement('i');
      dot.className = 'tap-ripple';
      dot.style.left = (x - r.left) / r.width * 100 + '%';
      dot.style.top = (y - r.top) / r.height * 100 + '%';
      screen.append(dot);
      setTimeout(() => dot.remove(), 700);
    }
    const wasDone = state === 'done';
    show('busy', wasDone ? 'Отменяем…' : 'Записываем…');
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (wasDone) { show('idle', 'Записаться на турнир'); removeMe(); live.textContent = 'Запись отменена'; }
      else { show('done', '✓ Вы записаны'); addMe(); live.textContent = 'Вы записаны на Classic Tournament, завтра в 19:00'; }
    }, reduceMotion ? 0 : (wasDone ? 600 : 900));
  });
})();
