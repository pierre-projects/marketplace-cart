/**
 * One collection: item cards and the stats panel for everyone who can view
 * it; the add-listing modal for editors; inline rename and the settings
 * dialog for the owner. Each init is a no-op when its markup is absent, so
 * the view no longer has to decide which scripts to load.
 */
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { bindDialog } from '../lib/dialog.js';
import { postForm } from '../lib/forms.js';
import { initItemCards } from '../lib/item-cards.js';
import { initStatsPanels } from '../lib/stats-panel.js';
import { initAddListing } from '../lib/add-listing.js';

initItemCards();
initStatsPanels();
initAddListing();
initInlineRename();
initSettingsDialog();

/**
 * Click the collection title to rename it in place.
 *
 * Submits a real form rather than fetch(): the server responds with a redirect
 * and a flash, so a full navigation is the behaviour we actually want.
 */
function initInlineRename() {
  const title = document.getElementById('collectionTitle');
  if (!title) return;   // not the owner

  const categoryId = title.dataset.categoryId;
  let editing = false;

  function beginEdit() {
    if (editing) return;
    editing = true;

    const original = title.dataset.name || '';
    // Kept so Escape can put the heading back exactly as it was. This used to
    // reload the whole page to undo.
    const originalNodes = [...title.childNodes];

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'collection-title__input';
    input.value = original;
    input.maxLength = 50;
    input.setAttribute('aria-label', 'Collection name');

    title.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const revert = () => {
      if (done) return;
      done = true;
      editing = false;
      title.replaceChildren(...originalNodes);
      title.focus();
    };

    const commit = () => {
      if (done) return;
      const next = input.value.trim();
      // Nothing to save — restore the heading without a round trip.
      if (!next || next === original) return revert();
      done = true;
      postForm(`/collections/${categoryId}/edit`, { name: next, returnTo: window.location.pathname });
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); revert(); }
    });
    input.addEventListener('blur', commit);
  }

  title.addEventListener('click', beginEdit);
  // Keyboard parity: the heading is role="button", so it must answer to both.
  title.addEventListener('keydown', (e) => {
    if (e.target !== title) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginEdit(); }
  });
}

function initSettingsDialog() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const dialog = bindDialog(modal);
  document.getElementById('openSettingsModal')?.addEventListener('click', dialog.open);
  initVisibilityToggle(modal);
}

function initVisibilityToggle(modal) {
  const form = modal.querySelector('.collection-settings-visibility-form');
  const checkbox = form?.querySelector('input[name="isPublic"]');
  if (!form || !checkbox) return;

  checkbox.addEventListener('change', async () => {
    const previous = !checkbox.checked;
    // Read the form BEFORE disabling the checkbox: a disabled control is left
    // out of FormData, which would always post "private".
    const data = new FormData(form);
    checkbox.disabled = true;
    form.setAttribute('aria-busy', 'true');

    try {
      const { isPublic } = await api(form.action, { method: 'POST', form: data });
      toast(isPublic ? 'Anyone with the link can now view this collection.' : 'This collection is private again.', { type: 'success' });
    } catch (err) {
      checkbox.checked = previous;
      toast(err.message || 'Could not update visibility.', { type: 'error' });
    } finally {
      checkbox.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}
