document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('manageCategoryModal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.modal-close');
  const renameForm = document.getElementById('renameForm');
  const deleteBtn = document.getElementById('deleteBtn');
  const nameInput = document.getElementById('newName');

  let currentCategoryId = null;

  // Open modal
  document.querySelectorAll('.manage-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      currentCategoryId = btn.dataset.id;
      nameInput.value = btn.dataset.name;
      modal.classList.add('is-open');
      nameInput.focus();
      nameInput.select();
    });
  });

  // Close modal
  closeBtn.addEventListener('click', () => modal.classList.remove('is-open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('is-open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      modal.classList.remove('is-open');
    }
  });

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

  // Delete
  deleteBtn.addEventListener('click', () => {
    if (confirm('Delete this category? Items will remain in All Listings.')) {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `/categories/${currentCategoryId}?_method=DELETE`;
      document.body.appendChild(form);
      form.submit();
    }
  });
});
