document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('manageCategoryModal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.modal-close');
  const renameForm = document.getElementById('renameForm');
  const deleteBtn = document.getElementById('deleteBtn');
  const nameInput = document.getElementById('newName');
  const deleteResting = document.getElementById('deleteResting');
  const deleteConfirm = document.getElementById('deleteConfirm');
  const deleteConfirmName = document.getElementById('deleteConfirmName');
  const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
  const deleteCancelBtn = document.getElementById('deleteCancelBtn');

  let currentCategoryId = null;

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


  // Open modal
  document.querySelectorAll('.manage-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      currentCategoryId = btn.dataset.id;
      nameInput.value = btn.dataset.name;
      // Reset first: reopening after a cancelled delete would otherwise show
      // the confirm row, still naming the previous collection.
      showDeleteResting();
      openDialog();
      nameInput.focus();
      nameInput.select();
    });
  });

  // Close modal
  closeBtn.addEventListener('click', () => closeDialog());
  modal.addEventListener('click', (e) => {
    if (isBackdropClick(e)) closeDialog();
  });
  // Escape is handled natively by <dialog>.

  // Rename. Submitting a synthetic form navigates the page, so there is no
  // error path to recover from here — the previous try/catch was unreachable.
  renameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = renameForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/categories/${currentCategoryId}/edit`;

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'name';
    input.value = nameInput.value;

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  });

  // Delete — two-step, inside the modal.
  //
  // This used to be a browser confirm(), which looks like the OS rather than
  // the app and leaves no room to say what survives the delete. The confirm row
  // names the collection and states that its items are kept.
  function showDeleteResting() {
    deleteResting.classList.remove('is-hidden');
    deleteConfirm.classList.add('is-hidden');
  }

  function showDeleteConfirm() {
    deleteConfirmName.textContent = nameInput.value || 'this collection';
    deleteResting.classList.add('is-hidden');
    deleteConfirm.classList.remove('is-hidden');
    deleteCancelBtn.focus();
  }

  deleteBtn.addEventListener('click', showDeleteConfirm);
  deleteCancelBtn.addEventListener('click', showDeleteResting);

  deleteConfirmBtn.addEventListener('click', () => {
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/categories/${currentCategoryId}?_method=DELETE`;
    document.body.appendChild(form);
    form.submit();
  });
});
