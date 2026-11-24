import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, X, type LucideIcon } from 'lucide-react';

type NavItem = { label: string; Icon: LucideIcon; action: () => void; active?: boolean; expanded?: boolean };

export function MobileNav({ label, items, busy }: { label: string; items: NavItem[]; busy: boolean }) {
  return <nav className="mobile-nav" aria-label={label}>
    {items.map(({ label, Icon, action, active, expanded }) => <button key={label} type="button"
      aria-current={active ? 'page' : undefined} aria-expanded={expanded} aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      disabled={busy} onClick={action}>
      <Icon size={20} aria-hidden="true" /><span>{label}</span>
    </button>)}
  </nav>;
}

export function MobileSections({ children, close }: { children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const mobile = window.matchMedia('(max-width: 680px)');
    mobile.addEventListener('change', close);
    return () => {
      mobile.removeEventListener('change', close);
      element.close();
    };
  }, [close]);

  return <dialog className="mobile-sections" ref={dialog} aria-labelledby="mobile-sections-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="mobile-sections-inner">
      <div className="dialog-head"><h2 id="mobile-sections-title">Разделы и действия</h2>
        <button type="button" className="button icon" aria-label="Закрыть разделы" onClick={close}><X size={19} /></button>
      </div>
      {children}
    </div>
  </dialog>;
}

export function MobileSection({ label, Icon, action, active }: NavItem) {
  return <button type="button" className="mobile-section" aria-current={active ? 'page' : undefined} onClick={action}>
    <Icon size={19} aria-hidden="true" /><span>{label}</span><ChevronRight size={16} aria-hidden="true" />
  </button>;
}
