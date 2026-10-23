import { csrfToken } from './api.js';

/**
 * Submit a POST as a real navigation, for actions whose server response is a
 * redirect plus a flash. Builds a hidden form so the CSRF token goes along.
 *
 * @param {string} action
 * @param {Record<string, string>} [fields]
 */
export function postForm(action, fields = {}) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  const all = { _csrf: csrfToken(), ...fields };
  for (const [name, value] of Object.entries(all)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

/**
 * Page-wide form behaviours declared in markup, replacing inline
 * onclick/onchange attributes (which the Content-Security-Policy blocks):
 *
 *   data-confirm="Question?"  on a submit button or link: asks first
 *   data-autosubmit           on a select or checkbox: submits its form on change
 */
export function installFormBehaviours() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.dataset.confirm)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-autosubmit]');
    if (el?.form) el.form.requestSubmit();
  });
}
