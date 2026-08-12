/**
 * Client-side feedback layer.
 *
 * Renders into the same live region for every action, and into markup that
 * matches flash-alert.ejs — so a server-rendered flash and a client toast are
 * one component with two entry points rather than two unrelated systems.
 *
 * Exposed on window because the page scripts are plain scripts, not modules.
 */
(function () {
  function region() {
    return document.getElementById('toasts');
  }

  /**
   * @param {string} message
   * @param {{type?: 'info'|'success'|'error', action?: {label: string, onClick: Function}, duration?: number}} opts
   */
  function toast(message, opts) {
    const { type = 'info', action = null, duration = 4500 } = opts || {};
    const host = region();
    if (!host) return;

    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    // Errors interrupt; everything else is polite.
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.className = 'toast__msg';
    text.textContent = message;          // never innerHTML — messages can carry scraped text
    el.append(text);

    let timer;
    function dismiss() {
      clearTimeout(timer);
      el.style.animation = 'toast-out var(--dur-base) var(--ease-out) forwards';
      el.addEventListener('animationend', () => el.remove(), { once: true });
      // Guard against animationend never firing (reduced motion, hidden tab).
      setTimeout(() => el.remove(), 500);
    }

    if (action && action.label) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        try { action.onClick && action.onClick(); } finally { dismiss(); }
      });
      el.append(btn);
    }

    host.append(el);
    timer = setTimeout(dismiss, duration);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2000); });

    return dismiss;
  }

  window.toast = toast;
})();
