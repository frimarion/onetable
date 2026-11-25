import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check, ChevronDown, Eye, EyeOff, Laptop, Link2, LogOut, Monitor, Moon, RotateCcw,
  Shield, SlidersHorizontal, Smartphone, Sun, User, X,
} from 'lucide-react';
import type { MemberRole } from '../shared/access';
import { request, type ProdAuthState } from './api';
import { useTheme, type ThemePreference } from './Theme';
import {
  usePreferences, type AvatarTone, type Density, type StartView, type TournamentsPerPage,
} from './preferences';

type SessionItem = {
  id: string;
  current: boolean;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
};

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  floor: 'Флор',
  dealer: 'Дилер',
};

const AVATAR_TONES: { value: AvatarTone; label: string }[] = [
  { value: 'default', label: 'Стандартный' },
  { value: 'emerald', label: 'Изумрудный' },
  { value: 'cobalt', label: 'Синий' },
  { value: 'amber', label: 'Янтарный' },
  { value: 'plum', label: 'Сливовый' },
];

const SOCIAL_PROVIDERS = [
  { id: 'telegram', name: 'Telegram', hint: 'Вход через бота клуба и уведомления о сменах' },
  { id: 'google', name: 'Google', hint: 'Быстрый вход через аккаунт Google' },
  { id: 'yandex', name: 'Яндекс', hint: 'Вход через Яндекс ID' },
];

const sessionDateFmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

function describeAgent(ua: string): { label: string; mobile: boolean } {
  const s = ua || '';
  const mobile = /iPhone|Android|Mobile|iPad/i.test(s);
  const browser = /Edg\//i.test(s) ? 'Edge'
    : /OPR\//i.test(s) ? 'Opera'
    : /YaBrowser/i.test(s) ? 'Яндекс Браузер'
    : /Chrome\//i.test(s) ? 'Chrome'
    : /Firefox\//i.test(s) ? 'Firefox'
    : /Safari\//i.test(s) ? 'Safari'
    : 'Браузер';
  const os = /iPhone/i.test(s) ? 'iPhone'
    : /iPad/i.test(s) ? 'iPad'
    : /Android/i.test(s) ? 'Android'
    : /Windows/i.test(s) ? 'Windows'
    : /Mac OS X/i.test(s) ? 'macOS'
    : /Linux/i.test(s) ? 'Linux'
    : '';
  return { label: os ? `${browser} · ${os}` : browser, mobile };
}

function ThemeSegmented({ value, onChange }: { value: ThemePreference; onChange: (next: ThemePreference) => void }) {
  const options: { value: ThemePreference; label: string; Icon: typeof Moon }[] = [
    { value: 'dark', label: 'Тёмная', Icon: Moon },
    { value: 'light', label: 'Светлая', Icon: Sun },
    { value: 'system', label: 'Системная', Icon: Monitor },
  ];
  return (
    <div className="segmented" role="radiogroup" aria-label="Тема оформления">
      {options.map(({ value: opt, label, Icon }) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          className={value === opt ? 'active' : ''}
          onClick={() => onChange(opt)}
        >
          <Icon size={14} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function ProfileSettingsDialog({
  prodMode,
  prodAuth,
  displayName,
  email,
  roleLabel,
  onSaveName,
  onClose,
}: {
  prodMode: boolean;
  prodAuth: ProdAuthState | null;
  displayName: string;
  email: string;
  roleLabel: string;
  onSaveName: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const [tab, setTab] = useState<'interface' | 'account'>('interface');

  // Профиль
  const [name, setName] = useState(displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Пароль
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [passMsg, setPassMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Сессии
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsErr, setSessionsErr] = useState('');
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [sessionsMsg, setSessionsMsg] = useState('');

  useEffect(() => { setName(displayName); }, [displayName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'account' || !prodMode || !prodAuth) return;
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsErr('');
    request<{ sessions: SessionItem[] }>('/api/auth/sessions')
      .then(res => { if (!cancelled) setSessions(res.sessions || []); })
      .catch(err => { if (!cancelled) setSessionsErr(err instanceof Error ? err.message : 'Не удалось загрузить сессии'); })
      .finally(() => { if (!cancelled) setSessionsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, prodMode, prodAuth]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) {
      setNameMsg({ kind: 'err', text: 'Имя должно содержать минимум 2 символа' });
      return;
    }
    setNameBusy(true);
    setNameMsg(null);
    try {
      await onSaveName(clean);
      setNameMsg({ kind: 'ok', text: 'Имя сохранено' });
    } catch (err) {
      setNameMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось сохранить имя' });
    } finally {
      setNameBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPassMsg(null);
    if (newPassword !== confirmPassword) {
      setPassMsg({ kind: 'err', text: 'Новые пароли не совпадают' });
      return;
    }
    setPassBusy(true);
    try {
      await request('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassMsg({ kind: 'ok', text: 'Пароль обновлён. Остальные сессии завершены.' });
      // Обновим список сессий
      const res = await request<{ sessions: SessionItem[] }>('/api/auth/sessions');
      setSessions(res.sessions || []);
    } catch (err) {
      setPassMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось сменить пароль' });
    } finally {
      setPassBusy(false);
    }
  }

  async function revokeOthers() {
    setRevokeBusy(true);
    setSessionsMsg('');
    try {
      const res = await request<{ ok: boolean; revoked: number }>('/api/auth/sessions', { method: 'DELETE' });
      setSessions(prev => prev.filter(item => item.current));
      setSessionsMsg(res.revoked > 0 ? `Завершено сессий: ${res.revoked}` : 'Других активных сессий нет');
    } catch (err) {
      setSessionsErr(err instanceof Error ? err.message : 'Не удалось завершить сессии');
    } finally {
      setRevokeBusy(false);
    }
  }

  const otherSessionsCount = sessions.filter(item => !item.current).length;
  const initial = (name.trim()[0] || email[0] || 'А').toUpperCase();

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="settings-dialog-title">
            <h2 id="profile-settings-title">Настройки профиля</h2>
            <small>{roleLabel}{email ? ` · ${email}` : ''}</small>
          </div>
          <button type="button" className="button icon" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="tabs settings-tabs" role="tablist" aria-label="Разделы настроек">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'interface'}
            onClick={() => setTab('interface')}
          >
            <SlidersHorizontal size={15} /> Интерфейс
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'account'}
            onClick={() => setTab('account')}
          >
            <User size={15} /> Учётная запись
          </button>
        </div>

        <div className="settings-dialog-body">
          {tab === 'interface' && (
            <div className="settings-stack">
              <div className="pref-row">
                <div>
                  <strong>Тема оформления</strong>
                  <small>Переключает палитру кабинета или следует системе</small>
                </div>
                <ThemeSegmented value={theme} onChange={setTheme} />
              </div>

              <div className="pref-row">
                <div>
                  <strong>Плотность интерфейса</strong>
                  <small>Компактный режим уменьшает отступы в списках и таблицах</small>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Плотность интерфейса">
                  {([['comfortable', 'Обычная'], ['compact', 'Компактная']] as [Density, string][]).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      role="radio"
                      aria-checked={prefs.density === val}
                      className={prefs.density === val ? 'active' : ''}
                      onClick={() => updatePrefs({ density: val })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pref-row">
                <div>
                  <strong>Стартовый экран</strong>
                  <small>Какой раздел открывать сразу после входа в кабинет</small>
                </div>
                <select
                  aria-label="Стартовый экран"
                  className="pref-select"
                  value={prefs.startView}
                  onChange={event => updatePrefs({ startView: event.target.value as StartView })}
                >
                  <option value="live">Текущий турнир (Live)</option>
                  <option value="tournaments">Список турниров</option>
                  <option value="crm">CRM клуба</option>
                </select>
              </div>

              <div className="pref-row">
                <div>
                  <strong>Турниров на странице</strong>
                  <small>Количество строк на одной странице в списке турниров</small>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Турниров на странице">
                  {([10, 20, 50] as TournamentsPerPage[]).map(size => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={prefs.tournamentsPerPage === size}
                      className={prefs.tournamentsPerPage === size ? 'active' : ''}
                      onClick={() => updatePrefs({ tournamentsPerPage: size })}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <label className="pref-row pref-toggle-row">
                <div>
                  <strong>Снизить анимации</strong>
                  <small>Отключает плавные переходы — полезно на планшетах в зале</small>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.reducedMotion}
                  onChange={event => updatePrefs({ reducedMotion: event.target.checked })}
                />
              </label>

              <div className="pref-footer">
                <button
                  type="button"
                  className="button compact"
                  onClick={() => { resetPrefs(); setTheme('dark'); }}
                >
                  <RotateCcw size={14} /> Сбросить настройки интерфейса
                </button>
              </div>
            </div>
          )}

          {tab === 'account' && (
            <div className="settings-stack">
              <section className="account-block">
                <h3>Профиль</h3>
                <form className="admin-form" onSubmit={saveProfile}>
                  <div className="profile-identity-edit">
                    <span className={`avatar avatar-lg tone-${prefs.avatarTone}`}>{initial}</span>
                    <label style={{ flex: 1 }}>
                      Отображаемое имя
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={80}
                        value={name}
                        disabled={nameBusy}
                        onChange={event => setName(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="avatar-tone-picker">
                    <span className="muted">Цвет аватара</span>
                    <div className="tone-swatches" role="radiogroup" aria-label="Цвет аватара">
                      {AVATAR_TONES.map(tone => (
                        <button
                          key={tone.value}
                          type="button"
                          role="radio"
                          aria-checked={prefs.avatarTone === tone.value}
                          aria-label={tone.label}
                          title={tone.label}
                          className={`tone-swatch tone-${tone.value}${prefs.avatarTone === tone.value ? ' active' : ''}`}
                          onClick={() => updatePrefs({ avatarTone: tone.value })}
                        >
                          {prefs.avatarTone === tone.value && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  {nameMsg && (
                    <p className={nameMsg.kind === 'err' ? 'alert' : 'inline-ok'} role="status">{nameMsg.text}</p>
                  )}
                  <div className="actions">
                    <button className="button primary compact" type="submit" disabled={nameBusy || name.trim() === displayName}>
                      {nameBusy ? 'Сохраняем…' : 'Сохранить имя'}
                    </button>
                  </div>
                </form>
              </section>

              <section className="account-block">
                <h3><Link2 size={15} /> Способы входа</h3>
                <p className="muted">Привязка соцсетей позволит входить в OneTable без пароля с любого устройства.</p>
                <div className="social-list">
                  {SOCIAL_PROVIDERS.map(provider => (
                    <div key={provider.id} className="social-row">
                      <div>
                        <strong>{provider.name}</strong>
                        <small>{provider.hint}</small>
                      </div>
                      <span className="state">Скоро</span>
                    </div>
                  ))}
                </div>
              </section>

              {prodMode && prodAuth ? (
                <>
                  <section className="account-block">
                    <h3><Shield size={15} /> Смена пароля</h3>
                    <form className="admin-form" onSubmit={submitPassword}>
                      <label>
                        Текущий пароль
                        <span className="password-field">
                          <input
                            type={showPass ? 'text' : 'password'}
                            required
                            autoComplete="current-password"
                            value={currentPassword}
                            disabled={passBusy}
                            onChange={event => setCurrentPassword(event.target.value)}
                          />
                          <button
                            type="button"
                            className="password-toggle"
                            aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}
                            onClick={() => setShowPass(v => !v)}
                          >
                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </span>
                      </label>
                      <label>
                        Новый пароль
                        <input
                          type={showPass ? 'text' : 'password'}
                          required
                          minLength={10}
                          autoComplete="new-password"
                          placeholder="Минимум 10 символов, буква и цифра"
                          value={newPassword}
                          disabled={passBusy}
                          onChange={event => setNewPassword(event.target.value)}
                        />
                      </label>
                      <label>
                        Повторите новый пароль
                        <input
                          type={showPass ? 'text' : 'password'}
                          required
                          minLength={10}
                          autoComplete="new-password"
                          value={confirmPassword}
                          disabled={passBusy}
                          onChange={event => setConfirmPassword(event.target.value)}
                        />
                      </label>
                      {passMsg && (
                        <p className={passMsg.kind === 'err' ? 'alert' : 'inline-ok'} role="status">{passMsg.text}</p>
                      )}
                      <div className="actions">
                        <button className="button primary compact" type="submit" disabled={passBusy}>
                          {passBusy ? 'Обновляем…' : 'Обновить пароль'}
                        </button>
                      </div>
                    </form>
                  </section>

                  <section className="account-block">
                    <div className="account-block-head">
                      <h3>Активные сессии</h3>
                      {otherSessionsCount > 0 && (
                        <button
                          type="button"
                          className="button compact"
                          disabled={revokeBusy}
                          onClick={() => void revokeOthers()}
                        >
                          {revokeBusy ? 'Завершаем…' : `Выйти с остальных (${otherSessionsCount})`}
                        </button>
                      )}
                    </div>
                    {sessionsErr && <p className="alert" role="alert">{sessionsErr}</p>}
                    {sessionsMsg && <p className="inline-ok" role="status">{sessionsMsg}</p>}
                    {sessionsLoading ? (
                      <p className="muted">Загружаем список устройств…</p>
                    ) : sessions.length ? (
                      <div className="session-list">
                        {sessions.map(item => {
                          const info = describeAgent(item.userAgent);
                          return (
                            <div key={item.id} className="session-row">
                              {info.mobile ? <Smartphone size={16} /> : <Laptop size={16} />}
                              <div className="session-info">
                                <strong>{info.label}</strong>
                                <small>
                                  {sessionDateFmt.format(new Date(item.createdAt))}
                                  {item.ip ? ` · ${item.ip}` : ''}
                                </small>
                              </div>
                              {item.current && <span className="state live"><i />Текущее</span>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="muted">Нет данных об активных сессиях.</p>
                    )}
                  </section>
                </>
              ) : (
                <section className="account-block">
                  <h3><Shield size={15} /> Безопасность и сессии</h3>
                  <p className="muted">Смена пароля и управление активными устройствами доступны при входе в рабочий кабинет клуба.</p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProfileMenu({
  prodMode,
  prodAuth,
  doyleEmail,
  onLogout,
  onSaveName,
}: {
  prodMode: boolean;
  prodAuth: ProdAuthState | null;
  doyleEmail?: string | null;
  onLogout?: () => void;
  onSaveName: (name: string) => Promise<void>;
}) {
  const { theme, setTheme } = useTheme();
  const { prefs, updatePrefs } = usePreferences();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const displayName = prodAuth
    ? (prodAuth.user.name || prodAuth.user.email)
    : (prefs.demoName || doyleEmail || 'Администратор');
  const email = prodAuth?.user.email || doyleEmail || '';
  const roleLabel = prodAuth ? ROLE_LABELS[prodAuth.role] : 'Демо-режим';
  const initial = (displayName[0] || email[0] || 'А').toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleSaveName(nextName: string) {
    if (prodMode && prodAuth) {
      await onSaveName(nextName);
    } else {
      updatePrefs({ demoName: nextName });
    }
  }

  return (
    <>
      <div className="profile-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className={'profile profile-trigger' + (open ? ' open' : '')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          <span className={`avatar tone-${prefs.avatarTone}`}>{initial}</span>
          <span className="profile-name">{displayName}</span>
          <ChevronDown size={14} className="profile-chevron" aria-hidden="true" />
        </button>

        {open && (
          <div className="profile-popover" role="menu" aria-label="Меню профиля">
            <div className="profile-popover-head">
              <span className={`avatar tone-${prefs.avatarTone}`}>{initial}</span>
              <div className="profile-popover-meta">
                <strong>{displayName}</strong>
                {email && <small>{email}</small>}
                <span className="profile-role-badge">{roleLabel}</span>
              </div>
            </div>

            <div className="profile-popover-section">
              <span className="profile-popover-label">Тема оформления</span>
              <ThemeSegmented value={theme} onChange={setTheme} />
            </div>

            <div className="profile-popover-actions">
              <button
                type="button"
                role="menuitem"
                className="profile-menu-item"
                onClick={() => { setOpen(false); setSettingsOpen(true); }}
              >
                <SlidersHorizontal size={15} />
                <span>Настройки профиля</span>
              </button>

              {onLogout && (
                <>
                  <div className="profile-popover-divider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="profile-menu-item danger"
                    onClick={() => { setOpen(false); onLogout(); }}
                  >
                    <LogOut size={15} />
                    <span>Выйти из аккаунта</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {settingsOpen && (
        <ProfileSettingsDialog
          prodMode={prodMode}
          prodAuth={prodAuth}
          displayName={displayName}
          email={email}
          roleLabel={roleLabel}
          onSaveName={handleSaveName}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
