/**
 * Dropdowns that toggle from a trigger and close on an outside click or
 * Escape: the item kebab, the collection picker, the account menu, the
 * filters panel.
 *
 * Each used to add its own document listeners, and the kebab and picker
 * re-queried every menu on the page on every click. Here there is one
 * delegated click listener and one keydown listener for the whole page, and
 * only the panels actually open are touched when closing.
 */

const kinds = [];
const open = new Set();   // entries: { kind, root }
let installed = false;

function setState(kind, root, isOpen) {
  const trigger = root.querySelector(kind.trigger);
  const panel = kind.panel ? root.querySelector(kind.panel) : null;
  if (kind.rootOpenClass) root.classList.toggle(kind.rootOpenClass, isOpen);
  if (panel) {
    if (kind.useHidden) panel.hidden = !isOpen;
    else panel.classList.toggle(kind.panelOpenClass, isOpen);
  }
  trigger?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeEntry(entry) {
  setState(entry.kind, entry.root, false);
  open.delete(entry);
}

/** Close everything except `keep` and the disclosures containing it. */
function closeAllExcept(keep) {
  for (const entry of [...open]) {
    if (keep && (entry.root === keep || entry.root.contains(keep))) continue;
    closeEntry(entry);
  }
}

function onClick(e) {
  for (const kind of kinds) {
    const trigger = e.target.closest(kind.trigger);
    const root = trigger?.closest(kind.root);
    if (!root) continue;

    e.preventDefault();
    const current = [...open].find(entry => entry.root === root);
    // Opening one closes the others, but not its own ancestors (the picker
    // lives inside the kebab menu).
    closeAllExcept(root);
    if (current) {
      closeEntry(current);
    } else {
      setState(kind, root, true);
      open.add({ kind, root });
    }
    return;
  }

  // A click inside an open panel leaves it open; anywhere else closes all.
  const inside = [...open].some(entry => entry.root.contains(e.target));
  if (!inside) closeAllExcept(null);
}

function onKeydown(e) {
  if (e.key !== 'Escape' || !open.size) return;
  const last = [...open].pop();
  closeAllExcept(null);
  last.root.querySelector(last.kind.trigger)?.focus();
}

/**
 * Register a kind of disclosure by selectors. Safe to call from several
 * modules; the document listeners are installed once.
 *
 * @param {{root: string, trigger: string, panel?: string, rootOpenClass?: string|null,
 *          panelOpenClass?: string, useHidden?: boolean}} kind
 */
export function registerDisclosure(kind) {
  if (kinds.some(k => k.root === kind.root && k.trigger === kind.trigger)) return;
  kinds.push({ rootOpenClass: 'is-open', panelOpenClass: 'is-open', useHidden: false, ...kind });
  if (installed) return;
  installed = true;
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
}

/** Close the open disclosures inside (or around) `root`; all of them if omitted. */
export function closeDisclosures(root) {
  for (const entry of [...open]) {
    if (!root || root.contains(entry.root) || entry.root.contains(root)) closeEntry(entry);
  }
}
