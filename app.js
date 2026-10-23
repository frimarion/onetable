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
 $('#screen-dialog-title').textContent = title;
 $('#screen-full-image').src = button.dataset.screen;
 $('#screen-full-image').alt = title;
 screenDialog.classList.toggle('portrait-screen', button.dataset.screen.includes('player-home'));
 openDialog(screenDialog);
});
$('.screen-close',screenDialog).addEventListener('click',()=>screenDialog.close());
