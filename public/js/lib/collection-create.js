/**
 * Inline "New collection" disclosure (views/partials/collection-create.ejs):
 * focus the name field when it opens. `toggle` does not bubble, so it is
 * listened for in the capture phase once for the whole page.
 */
export function initCollectionCreate() {
  document.addEventListener('toggle', (e) => {
    const creator = e.target;
    if (!(creator instanceof HTMLElement) || !creator.matches('[data-collection-create]') || !creator.open) return;
    requestAnimationFrame(() => creator.querySelector('input[name="name"]')?.focus());
  }, true);
}
