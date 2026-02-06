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
      modal.style.display = 'flex';
      nameInput.focus();
      nameInput.select();
    });
  });

  // Close modal
  closeBtn.addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      modal.style.display = 'none';
    }
  });

  // Rename
  renameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = renameForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
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
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
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
