import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Check, ChevronDown, Eye, EyeOff, Laptop, Link2, LogOut, Monitor, Moon, RotateCcw,
  Shield, SlidersHorizontal, Smartphone, Sun, Trash2, Upload, User, X,
} from 'lucide-react';
import type { MemberRole } from '../shared/access';
import {
  request, type LinkedIdentity, type OAuthProvider, type OAuthProvidersStatus, type ProdAuthState,
} from './api';
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

const SOCIAL_PROVIDERS: { id: OAuthProvider; name: string; hint: string; envHint: string }[] = [
  { id: 'telegram', name: 'Telegram', hint: 'Быстрый вход через Telegram-бота клуба', envHint: 'TELEGRAM_BOT_USERNAME, TELEGRAM_BOT_TOKEN' },
  { id: 'vk', name: 'VK ID', hint: 'Вход в один клик через аккаунт ВКонтакте', envHint: 'VK_CLIENT_ID' },
  { id: 'yandex', name: 'Яндекс ID', hint: 'Вход через учётную запись Яндекса', envHint: 'YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET' },
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

/** Сжимает выбранное изображение в квадрат 160×160 (WebP/JPEG, обычно 5–25 КБ). */
async function compressAvatarFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    throw new Error('Выберите изображение в формате PNG, JPEG или WebP');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Исходный файл слишком большой (максимум 10 МБ)');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      el.src = objectUrl;
    });
    const size = 160;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не поддерживает обработку изображений');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    let dataUrl = canvas.toDataURL('image/webp', 0.82);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    }
    if (dataUrl.length > 150_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    }
    if (dataUrl.length > 150_000) {
      throw new Error('Не удалось сжать аватарку до 120 КБ. Попробуйте другое фото.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function TelegramWidget({
  botUsername,
  size = 'medium',
  onAuth,
}: {
  botUsername: string;
  size?: 'small' | 'medium' | 'large';
  onAuth: (user: Record<string, unknown>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onAuth);
  cbRef.current = onAuth;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !botUsername) return;
    const cbName = '__onetableTgAuth_' + Math.random().toString(36).slice(2, 10);
    (window as unknown as Record<string, unknown>)[cbName] = (user: Record<string, unknown>) => {
      cbRef.current(user);
    };
    el.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', size);
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', `${cbName}(user)`);
    el.appendChild(script);
    return () => {
      delete (window as unknown as Record<string, unknown>)[cbName];
      el.innerHTML = '';
    };
  }, [botUsername, size]);

  return <div className="tg-widget-slot" ref={containerRef} />;
}

function AvatarBadge({
  avatarUrl,
  initial,
  tone,
  large = false,
}: {
  avatarUrl: string;
  initial: string;
  tone: AvatarTone;
  large?: boolean;
}) {
  const cls = `avatar${large ? ' avatar-lg' : ''}${avatarUrl ? ' has-photo' : ` tone-${tone}`}`;
  return (
    <span className={cls}>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
    </span>
  );
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
  avatarUrl,
  email,
  roleLabel,
  onUpdateProfile,
  onIdentitiesChange,
  onClose,
}: {
  prodMode: boolean;
  prodAuth: ProdAuthState | null;
  displayName: string;
  avatarUrl: string;
  email: string;
  roleLabel: string;
  onUpdateProfile: (patch: { name?: string; avatarUrl?: string }) => Promise<void>;
  onIdentitiesChange: (identities: LinkedIdentity[]) => void;
  onClose: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const [tab, setTab] = useState<'interface' | 'account'>('interface');

  // Профиль и аватарка
  const [name, setName] = useState(displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Способы входа (OAuth)
  const [providers, setProviders] = useState<OAuthProvidersStatus | null>(null);
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null);
  const [oauthMsg, setOauthMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
    request<OAuthProvidersStatus>('/api/auth/providers')
      .then(res => { if (!cancelled) setProviders(res); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, prodMode, prodAuth]);

  async function saveProfileName(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) {
      setProfileMsg({ kind: 'err', text: 'Имя должно содержать минимум 2 символа' });
      return;
    }
    setNameBusy(true);
    setProfileMsg(null);
    try {
      await onUpdateProfile({ name: clean });
      setProfileMsg({ kind: 'ok', text: 'Имя сохранено' });
    } catch (err) {
      setProfileMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось сохранить имя' });
    } finally {
      setNameBusy(false);
    }
  }

  async function handleAvatarSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    setProfileMsg(null);
    try {
      const compressed = await compressAvatarFile(file);
      await onUpdateProfile({ avatarUrl: compressed });
      setProfileMsg({ kind: 'ok', text: 'Аватарка обновлена' });
    } catch (err) {
      setProfileMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось загрузить аватарку' });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarBusy(true);
    setProfileMsg(null);
    try {
      await onUpdateProfile({ avatarUrl: '' });
      setProfileMsg({ kind: 'ok', text: 'Аватарка удалена' });
    } catch (err) {
      setProfileMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось удалить аватарку' });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleTelegramLink(tgUser: Record<string, unknown>) {
    setOauthBusy('telegram');
    setOauthMsg(null);
    try {
      const res = await request<{ identities: LinkedIdentity[] }>('/api/auth/oauth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'link', auth: tgUser }),
      });
      onIdentitiesChange(res.identities);
      setOauthMsg({ kind: 'ok', text: 'Telegram успешно привязан' });
    } catch (err) {
      setOauthMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось привязать Telegram' });
    } finally {
      setOauthBusy(null);
    }
  }

  async function handleUnlink(provider: OAuthProvider) {
    setOauthBusy(provider);
    setOauthMsg(null);
    try {
      const res = await request<{ identities: LinkedIdentity[] }>(`/api/auth/identities/${provider}`, { method: 'DELETE' });
      onIdentitiesChange(res.identities);
      setOauthMsg({ kind: 'ok', text: 'Привязка удалена' });
    } catch (err) {
      setOauthMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось отвязать аккаунт' });
    } finally {
      setOauthBusy(null);
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

  const linkedMap = new Map((prodAuth?.identities || []).map(item => [item.provider, item]));
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

              <div className="pref-row pref-toggle-row">
                <div>
                  <strong>Снизить анимации</strong>
                  <small>Отключает плавные переходы — полезно на планшетах в зале</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.reducedMotion}
                  aria-label="Снизить анимации"
                  className={'ui-switch' + (prefs.reducedMotion ? ' checked' : '')}
                  onClick={() => updatePrefs({ reducedMotion: !prefs.reducedMotion })}
                >
                  <span className="ui-switch-thumb" />
                </button>
              </div>

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
                <h3>Профиль и аватар</h3>
                <div className="avatar-upload-row">
                  <AvatarBadge avatarUrl={avatarUrl} initial={initial} tone={prefs.avatarTone} large />
                  <div className="avatar-upload-meta">
                    <div className="actions">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={handleAvatarSelect}
                      />
                      <button
                        type="button"
                        className="button compact"
                        disabled={avatarBusy}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload size={14} /> {avatarBusy ? 'Сжимаем…' : avatarUrl ? 'Заменить фото' : 'Загрузить фото'}
                      </button>
                      {avatarUrl && (
                        <button
                          type="button"
                          className="button compact"
                          disabled={avatarBusy}
                          onClick={() => void handleAvatarRemove()}
                        >
                          <Trash2 size={14} /> Удалить
                        </button>
                      )}
                    </div>
                    <small>PNG, JPEG или WebP · автоматически сожмётся до 160×160</small>
                  </div>
                </div>

                {!avatarUrl && (
                  <div className="avatar-tone-picker">
                    <span className="muted">Цвет инициалов</span>
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
                )}

                <form className="admin-form" onSubmit={saveProfileName}>
                  <label>
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
                  {profileMsg && (
                    <p className={profileMsg.kind === 'err' ? 'alert' : 'inline-ok'} role="status">{profileMsg.text}</p>
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
                <p className="muted">Привяжите соцсети, чтобы входить в OneTable без пароля с любого устройства.</p>
                {oauthMsg && (
                  <p className={oauthMsg.kind === 'err' ? 'alert' : 'inline-ok'} role="status">{oauthMsg.text}</p>
                )}
                <div className="social-list">
                  {SOCIAL_PROVIDERS.map(provider => {
                    const linked = linkedMap.get(provider.id);
                    const status = providers?.[provider.id];
                    const enabled = Boolean(status?.enabled);
                    const isBusy = oauthBusy === provider.id;
                    return (
                      <div key={provider.id} className="social-row">
                        <div>
                          <strong>{provider.name}</strong>
                          <small>
                            {linked
                              ? (linked.username ? `${linked.displayName} (@${linked.username.replace(/^@/, '')})` : linked.displayName)
                              : provider.hint}
                          </small>
                        </div>
                        <div className="social-row-action">
                          {linked ? (
                            <>
                              <span className="state live"><i />Привязан</span>
                              <button
                                type="button"
                                className="button compact"
                                disabled={isBusy}
                                onClick={() => void handleUnlink(provider.id)}
                              >
                                {isBusy ? '…' : 'Отвязать'}
                              </button>
                            </>
                          ) : !prodMode ? (
                            <span className="state">В рабочем кабинете</span>
                          ) : !enabled ? (
                            <span className="state" title={`Добавьте на сервере: ${provider.envHint}`}>Не настроен</span>
                          ) : provider.id === 'telegram' && providers?.telegram.botUsername ? (
                            <TelegramWidget
                              botUsername={providers.telegram.botUsername}
                              size="small"
                              onAuth={user => { void handleTelegramLink(user); }}
                            />
                          ) : (
                            <a
                              className="button compact"
                              href={`/api/auth/oauth/${provider.id}/start?mode=link&returnTo=${encodeURIComponent(location.pathname)}`}
                            >
                              Привязать
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
  onLogout,
  onUpdateProfile,
  onIdentitiesChange,
}: {
  prodMode: boolean;
  prodAuth: ProdAuthState | null;
  onLogout?: () => void;
  onUpdateProfile: (patch: { name?: string; avatarUrl?: string }) => Promise<void>;
  onIdentitiesChange: (identities: LinkedIdentity[]) => void;
}) {
  const { theme, setTheme } = useTheme();
  const { prefs, updatePrefs } = usePreferences();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const displayName = prodAuth
    ? (prodAuth.user.name || prodAuth.user.email)
    : (prefs.demoName || 'Администратор');
  const avatarUrl = prodAuth ? (prodAuth.user.avatarUrl || '') : prefs.demoAvatar;
  const email = prodAuth?.user.email || '';
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

  async function handleUpdateProfile(patch: { name?: string; avatarUrl?: string }) {
    if (prodMode && prodAuth) {
      await onUpdateProfile(patch);
    } else {
      const localPatch: Partial<typeof prefs> = {};
      if (patch.name !== undefined) localPatch.demoName = patch.name;
      if (patch.avatarUrl !== undefined) localPatch.demoAvatar = patch.avatarUrl;
      updatePrefs(localPatch);
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
          <AvatarBadge avatarUrl={avatarUrl} initial={initial} tone={prefs.avatarTone} />
          <span className="profile-name">{displayName}</span>
          <ChevronDown size={14} className="profile-chevron" aria-hidden="true" />
        </button>

        {open && (
          <div className="profile-popover" role="menu" aria-label="Меню профиля">
            <div className="profile-popover-head">
              <AvatarBadge avatarUrl={avatarUrl} initial={initial} tone={prefs.avatarTone} />
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
          avatarUrl={avatarUrl}
          email={email}
          roleLabel={roleLabel}
          onUpdateProfile={handleUpdateProfile}
          onIdentitiesChange={onIdentitiesChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
