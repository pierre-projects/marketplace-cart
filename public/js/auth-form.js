/**
 * Auth form enhancements: password reveal and a double-submit guard.
 *
 * Progressive enhancement only. With JS off both forms still post and
 * authenticate exactly as before — nothing here is required to sign in.
 */
document.addEventListener('DOMContentLoaded', () => {
  // ---- password reveal ------------------------------------------------------

  document.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
    const wrap = toggle.closest('.field__control-wrap');
    const input = wrap && wrap.querySelector('[data-password-input]');
    if (!input) return;

    toggle.setAttribute('aria-label', 'Show password');

    toggle.addEventListener('click', () => {
      const revealed = input.type === 'text';
      input.type = revealed ? 'password' : 'text';
      toggle.textContent = revealed ? 'Show' : 'Hide';
      toggle.setAttribute('aria-pressed', revealed ? 'false' : 'true');
      toggle.setAttribute('aria-label', revealed ? 'Show password' : 'Hide password');
      // Clicking the toggle should not cost you your place in the field.
      input.focus();
    });
  });

  // ---- double-submit guard --------------------------------------------------

  document.querySelectorAll('[data-auth-form]').forEach((form) => {
    form.addEventListener('submit', () => {
      const submit = form.querySelector('button[type="submit"]');
      if (!submit) return;

      // Deferred by a tick: disabling a control during the submit event can
      // drop it from the payload in some browsers. The form is already on its
      // way by the time this runs.
      setTimeout(() => {
        submit.disabled = true;
        submit.classList.add('btn-loading');
      }, 0);
    });
  });
});
