import { api } from './api.js';
import { toast } from './toast.js';
import { registerDisclosure, closeDisclosures } from './disclosure.js';

/**
 * Behaviour for item cards (views/partials/item-card.ejs): the kebab menu, the
 * "Add to collection" picker inside it, saving the picker, and Copy link.
 *
 * Event delegation from the document rather than listeners attached per card
 * in loops, so it costs the same for 5 cards or 500 and works for cards added
 * later.
 */

let installed = false;

async function saveAssignments(form) {
  const itemId = form.dataset.itemId;
  const categoryIds = [...form.querySelectorAll('input[name="categories"]:checked')].map(cb => cb.value);
  const btn = form.querySelector('.save-btn');

  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await api(`/items/${itemId}/assign-categories`, { method: 'POST', json: { categoryIds } });
    toast('Collections updated', { type: 'success' });
    const count = form.closest('.category-picker')?.querySelector('.cat-count');
    if (count) count.textContent = String(categoryIds.length);
    closeDisclosures(form);
  } catch (err) {
    toast(err.message || 'Could not update collections.', { type: 'error' });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function copyLink(button) {
  const link = button.dataset.copyLink;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied', { type: 'success', duration: 2500 });
  } catch (err) {
    // Clipboard needs a secure context and permission; say where to look.
    toast('Could not copy. The link opens from "View on…" instead.', { type: 'error' });
  }
  closeDisclosures(button);
}

export function initItemCards() {
  if (installed) return;
  installed = true;

  registerDisclosure({
    root: '.kebab-menu', trigger: '.kebab-btn', panel: '.kebab-dropdown', rootOpenClass: 'open',
  });
  registerDisclosure({
    root: '.category-picker', trigger: '.picker-toggle', panel: '.picker-dropdown', rootOpenClass: null,
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('.category-checkbox-form');
    if (!form) return;
    e.preventDefault();
    saveAssignments(form);
  });

  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-copy-link]');
    if (button) copyLink(button);
  });
}
