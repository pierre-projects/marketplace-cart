/**
 * Collections index: the "Manage" dialog (rename, two-step delete) and the
 * inline "New collection" form.
 */
import { bindDialog } from '../lib/dialog.js';
import { postForm } from '../lib/forms.js';
import { initCollectionCreate } from '../lib/collection-create.js';

initCollectionCreate();

(function initManageDialog() {
  const modal = document.getElementById('manageCategoryModal');
  if (!modal) return;

  const renameForm = document.getElementById('renameForm');
  const deleteBtn = document.getElementById('deleteBtn');
  const nameInput = document.getElementById('newName');
  const deleteResting = document.getElementById('deleteResting');
  const deleteConfirm = document.getElementById('deleteConfirm');
  const deleteConfirmName = document.getElementById('deleteConfirmName');
  const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
  const deleteCancelBtn = document.getElementById('deleteCancelBtn');

  const dialog = bindDialog(modal);
  let currentCategoryId = null;

  // Delete is two-step, inside the modal. A browser confirm() looks like the
  // OS rather than the app and leaves no room to say what survives the
  // delete; the confirm row names the collection and says its items are kept.
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

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.manage-btn');
    if (!btn) return;
    e.preventDefault();
    currentCategoryId = btn.dataset.id;
    nameInput.value = btn.dataset.name;
    // Reset first: reopening after a cancelled delete would otherwise show
    // the confirm row, still naming the previous collection.
    showDeleteResting();
    dialog.open();
    nameInput.focus();
    nameInput.select();
  });

  // Submitting navigates the page; the server answers with a redirect + flash.
  renameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = renameForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    postForm(`/collections/${currentCategoryId}/edit`, { name: nameInput.value });
  });

  deleteBtn.addEventListener('click', showDeleteConfirm);
  deleteCancelBtn.addEventListener('click', showDeleteResting);

  deleteConfirmBtn.addEventListener('click', () => {
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Deleting...';
    postForm(`/collections/${currentCategoryId}?_method=DELETE`);
  });
})();
