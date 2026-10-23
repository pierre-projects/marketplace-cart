/**
 * Native <dialog> wiring shared by every modal: open/close with an attribute
 * fallback, the close button, and closing on a backdrop click. Three files
 * each carried their own copy.
 *
 * Escape, focus trapping and focus restore come from <dialog> itself.
 *
 * @param {HTMLDialogElement} dialog
 * @param {{onClose?: Function}} [opts]
 */
export function bindDialog(dialog, { onClose } = {}) {
  const open = () => {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  const close = () => {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  };

  dialog.querySelector('.modal-close')?.addEventListener('click', close);

  // A click on ::backdrop targets the dialog itself, so compare against its box.
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside) close();
  });

  if (onClose) dialog.addEventListener('close', onClose);

  return { open, close };
}
