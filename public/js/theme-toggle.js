/**
 * Appearance controls: colour theme and accent.
 *
 * Both are stored as a NAME and applied as a data attribute on <html>, so the
 * actual colour values live in tokens.css. That keeps light/dark variants of
 * each accent in CSS — where the theme already lives — instead of doing colour
 * maths in JS.
 *
 * The initial stamp happens in an inline script in the layout <head>; this file
 * only handles switching after load.
 */
document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;

  function read(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value, isDefault) {
    try {
      if (isDefault) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (err) {
      // Private mode — the choice still applies for this page view.
    }
  }

  // ---- theme: system | light | dark ---------------------------------------

  const themeGroup = document.querySelector('[data-theme-toggle]');
  if (themeGroup) {
    const buttons = themeGroup.querySelectorAll('[data-theme-value]');

    const applyTheme = (value) => {
      // "system" means REMOVE the attribute and let the prefers-color-scheme
      // block decide, rather than freezing today's OS setting into storage.
      if (value === 'system') delete root.dataset.theme;
      else root.dataset.theme = value;
      write('theme', value, value === 'system');
      syncTheme(value);
    };

    const syncTheme = (value) => {
      buttons.forEach((btn) => {
        const active = btn.dataset.themeValue === value;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        applyTheme(btn.dataset.themeValue);
      });
    });

    syncTheme(read('theme', 'system'));
  }

  // ---- accent -------------------------------------------------------------

  const accentGroup = document.querySelector('[data-accent-picker]');
  if (accentGroup) {
    const swatches = accentGroup.querySelectorAll('[data-accent-value]');

    const applyAccent = (value) => {
      if (!value || value === 'default') delete root.dataset.accent;
      else root.dataset.accent = value;
      write('accent', value, !value || value === 'default');
      syncAccent(value || 'default');
    };

    const syncAccent = (value) => {
      swatches.forEach((btn) => {
        const active = btn.dataset.accentValue === value;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    swatches.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        applyAccent(btn.dataset.accentValue);
      });
    });

    syncAccent(read('accent', 'default'));
  }
});
