(function () {
  function connectionError(message) {
    const panel = document.createElement('dialog');
    panel.setAttribute('aria-labelledby', 'doyle-office-error');
    const title = document.createElement('h2');
    title.id = 'doyle-office-error';
    title.textContent = 'Не удалось открыть Doyle';
    const detail = document.createElement('p');
    detail.textContent = message;
    const retry = document.createElement('button');
    retry.textContent = 'Повторить';
    retry.onclick = () => location.reload();
    const home = document.createElement('a');
    home.href = '/?workspace=onetable';
    home.textContent = 'Кабинет OneTable';
    panel.append(title, detail, retry, ' ', home);
    document.body.append(panel);
    panel.addEventListener('cancel', event => event.preventDefault());
    panel.showModal();
  }

  window.openDoyleOffice = function (scope) {
    const storageKey = 'onetable-doyle-office';
    if (sessionStorage.getItem(storageKey + '-scope') !== scope) {
      sessionStorage.removeItem(storageKey);
      sessionStorage.setItem(storageKey + '-scope', scope);
    }
    let signIn;
    const storage = {
      async getItem(key) {
        const saved = sessionStorage.getItem(key);
        if (saved !== null || key !== storageKey) return saved;
        signIn ??= fetch('/api/doyle/session', { method: 'POST' }).then(async response => {
          if (response.status === 401) {
            location.replace('/');
            return null;
          }
          const session = await response.json();
          if (!response.ok) throw new Error(session.error);
          const serialized = JSON.stringify(session);
          sessionStorage.setItem(storageKey, serialized);
          return serialized;
        }).catch(error => {
          connectionError(error.message || 'Попробуйте ещё раз.');
          return null;
        });
        return signIn;
      },
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: key => sessionStorage.removeItem(key),
    };
    const client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      global: { fetch: window.sbFetchFailover },
      auth: { storage, storageKey, detectSessionInUrl: false },
    });
    const signOut = client.auth.signOut.bind(client.auth);
    client.auth.signOut = async () => {
      try { await signOut({ scope: 'local' }); }
      finally {
        signIn = Promise.resolve(null);
        sessionStorage.removeItem(storageKey);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        location.replace('/');
      }
      return { error: null };
    };
    return client;
  };
}());
