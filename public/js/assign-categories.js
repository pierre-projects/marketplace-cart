// Toast notification helper
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  // Toggle dropdown on button click
  document.querySelectorAll('.picker-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = btn.nextElementSibling;

      // Close all other dropdowns first
      document.querySelectorAll('.picker-dropdown').forEach(d => {
        if (d !== dropdown) d.style.display = 'none';
      });

      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.category-picker')) {
      document.querySelectorAll('.picker-dropdown').forEach(d => {
        d.style.display = 'none';
      });
    }
  });

  // Handle checkbox form submit
  document.querySelectorAll('.category-checkbox-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const itemId = form.dataset.itemId;
      const checkboxes = form.querySelectorAll('input[name="categories"]:checked');
      const categoryIds = Array.from(checkboxes).map(cb => cb.value);
      const btn = form.querySelector('.save-btn');

      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const res = await fetch(`/items/${itemId}/assign-categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryIds })
        });

        if (res.ok) {
          showToast('Categories updated');
          // Update count in toggle button
          const toggle = form.closest('.category-picker').querySelector('.cat-count');
          toggle.textContent = categoryIds.length;
          // Close dropdown
          form.closest('.picker-dropdown').style.display = 'none';
        } else {
          showToast('Failed to update', 'error');
        }
      } catch (err) {
        showToast('Network error', 'error');
      }

      btn.disabled = false;
      btn.textContent = 'Save';
    });
  });
});
