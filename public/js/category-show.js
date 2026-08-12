document.addEventListener('DOMContentLoaded', () => {
  setupInlineRename();
  setupSettingsModal();
});

/**
 * Click the collection title to rename it in place.
 *
 * Deliberately set up BEFORE the settings-modal guard below: that block
 * early-returns when the modal is absent, and hanging the rename off it would
 * silently disable renaming on any page rendered without one.
 *
 * Submits a real form rather than fetch(): the server responds with a redirect
 * and a flash, so a full navigation is the behaviour we actually want, and it
 * keeps working without JS-side error handling to get wrong.
 */
function setupInlineRename() {
  const title = document.getElementById('collectionTitle');
  if (!title) return;   // not the owner

  const categoryId = title.dataset.categoryId;
  let editing = false;

  function beginEdit() {
    if (editing) return;
    editing = true;

    const original = title.dataset.name || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'collection-title__input';
    input.value = original;
    input.maxLength = 60;
    input.setAttribute('aria-label', 'Collection name');

    title.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const revert = () => {
      if (done) return;
      done = true;
      editing = false;
      window.location.reload();
    };

    const commit = () => {
      if (done) return;
      const next = input.value.trim();
      // Nothing to save — restore the heading without a round trip.
      if (!next || next === original) return revert();
      done = true;

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/categories/' + categoryId + '/edit';
      form.appendChild(hidden('name', next));
      form.appendChild(hidden('returnTo', window.location.pathname));
      document.body.appendChild(form);
      form.submit();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); revert(); }
    });
    input.addEventListener('blur', commit);
  }

  function hidden(name, value) {
    const el = document.createElement('input');
    el.type = 'hidden';
    el.name = name;
    el.value = value;
    return el;
  }

  title.addEventListener('click', beginEdit);
  // Keyboard parity: the heading is role="button", so it must answer to both.
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginEdit(); }
  });
}

function setupSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const openBtn = document.getElementById('openSettingsModal');
  const closeBtn = modal.querySelector('.modal-close');

  // Native <dialog> where available; the attribute fallback keeps the markup
  // usable if showModal() is missing.
  function openDialog() {
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  }

  function closeDialog() {
    if (typeof modal.close === 'function' && modal.open) modal.close();
    else modal.removeAttribute('open');
  }

  // A click on ::backdrop targets the dialog itself, so compare against its box.
  function isBackdropClick(e) {
    if (e.target !== modal) return false;
    const r = modal.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right ||
           e.clientY < r.top  || e.clientY > r.bottom;
  }


  openBtn.addEventListener('click', () => {
    openDialog();
  });

  closeBtn.addEventListener('click', () => {
    closeDialog();
  });

  modal.addEventListener('click', (e) => {
    if (isBackdropClick(e)) closeDialog();
  });

  // Escape is handled natively by <dialog>.
}
