/**
 * Appearance controls: colour theme and accent.
 *
 * Both are stored as a NAME and applied as a data attribute on <html>, so the
 * actual colour values live in tokens.css. That keeps light/dark variants of
 * each accent in CSS — where the theme already lives — instead of doing colour
 * maths in JS.
 *
 * The initial stamp happens in an inline script in the layout <head>; this file
 * only handles switching after load. Loaded once, by app.js — settings.ejs
 * used to load it a second time, which bound every control twice.
 */
export function initTheme() {
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

  // data-theme always holds a RESOLVED theme (light or dark) — the inline head
  // script sees to that. data-theme-source records whether we got there by
  // following the OS, which is what "system" being selected actually means.
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const stampTheme = (choice) => {
    if (choice === 'system') {
      root.dataset.themeSource = 'system';
      root.dataset.theme = systemDark.matches ? 'dark' : 'light';
    } else {
      delete root.dataset.themeSource;
      root.dataset.theme = choice;
    }
  };

  // Following the OS means following it live, not until the next reload.
  const onSystemChange = () => {
    if (root.dataset.themeSource === 'system') stampTheme('system');
  };
  if (systemDark.addEventListener) systemDark.addEventListener('change', onSystemChange);
  else if (systemDark.addListener) systemDark.addListener(onSystemChange);

  // Two controls can drive the theme and both may be on the page: the
  // segmented System|Light|Dark group (account dropdown, settings) and the
  // single cycling button in the signed-out navbar. Neither owns the state —
  // applyTheme does, and syncAll pushes it back out to whichever exist.
  const CYCLE = ['system', 'light', 'dark'];

  const themeGroup = document.querySelector('[data-theme-toggle]');
  const groupButtons = themeGroup ? themeGroup.querySelectorAll('[data-theme-value]') : [];
  const cycleBtn = document.querySelector('[data-theme-cycle]');

  const syncAll = (value) => {
    groupButtons.forEach((btn) => {
      const active = btn.dataset.themeValue === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (cycleBtn) {
      const next = CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
      cycleBtn.dataset.themeChoice = value;
      // The name states where you are and where one more press takes you —
      // the only way a single control announces a three-way setting.
      cycleBtn.setAttribute('aria-label', `Theme: ${value}. Switch to ${next}.`);
      cycleBtn.setAttribute('title', `Theme: ${value}`);
    }
  };

  const applyTheme = (value) => {
    stampTheme(value);
    // "system" is stored as the ABSENCE of a preference, so a later OS change
    // is honoured instead of today's setting being frozen into storage.
    write('theme', value, value === 'system');
    syncAll(value);
  };

  groupButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      applyTheme(btn.dataset.themeValue);
    });
  });

  if (cycleBtn) {
    cycleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Read the current choice off the button rather than tracking it in a
      // second place that could drift from what is rendered.
      const current = CYCLE.indexOf(cycleBtn.dataset.themeChoice);
      applyTheme(CYCLE[(current + 1) % CYCLE.length]);
    });
  }

  syncAll(read('theme', 'system'));

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
}
