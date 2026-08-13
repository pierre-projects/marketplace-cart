// Toast notification helper
// Delegates to the shared toast layer (public/js/toast.js) so client feedback
// and server-rendered flash messages are the same component.
function showToast(message, type = 'success') {
  if (typeof window.toast === 'function') return window.toast(message, { type });
  console.warn('toast layer unavailable:', message);
}

document.addEventListener('DOMContentLoaded', () => {
  // Kebab menu toggle
  document.querySelectorAll('.kebab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.closest('.kebab-menu');
      const dropdown = menu.querySelector('.kebab-dropdown');

      // Close all other kebab dropdowns
      document.querySelectorAll('.kebab-menu').forEach(m => {
        if (m !== menu) {
          m.classList.remove('open');
          m.querySelector('.kebab-dropdown').classList.remove('is-open');
          m.querySelector('.kebab-btn').setAttribute('aria-expanded', 'false');
        }
      });

      const nowOpen = dropdown.classList.toggle('is-open');
      menu.classList.toggle('open', nowOpen);
      btn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
    });
  });

  // Close kebab when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.kebab-menu')) {
      document.querySelectorAll('.kebab-menu').forEach(m => {
        m.classList.remove('open');
        m.querySelector('.kebab-dropdown').classList.remove('is-open');
        m.querySelector('.kebab-btn').setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Toggle category picker dropdown on button click
  document.querySelectorAll('.picker-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = btn.nextElementSibling;

      // Close all other picker dropdowns first
      document.querySelectorAll('.picker-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('is-open');
      });

      dropdown.classList.toggle('is-open');
    });
  });

  // Close picker dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.category-picker')) {
      document.querySelectorAll('.picker-dropdown').forEach(d => {
        d.classList.remove('is-open');
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
          form.closest('.picker-dropdown').classList.remove('is-open');
        } else {
          // Surface what the server actually said rather than collapsing every
          // 4xx/5xx into one generic string.
          let message = 'Failed to update';
          try {
            const body = await res.json();
            if (body && body.error) message = body.error;
          } catch (parseErr) {
            // Non-JSON response (e.g. a 302 to the login page on an expired
            // session) — keep the generic message.
          }
          showToast(message, 'error');
        }
      } catch (err) {
        showToast('Network error', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  });
});
