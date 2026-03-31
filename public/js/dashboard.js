document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('addListingModal');
  const openBtn = document.getElementById('openAddModal');
  const closeBtn = modal?.querySelector('.modal-close');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const backBtn = document.getElementById('backToStep1');
  const previewForm = document.getElementById('previewForm');
  const previewError = document.getElementById('previewError');
  const previewErrorText = document.getElementById('previewErrorText');
  const linkInput = document.getElementById('link');

  if (!modal || !openBtn) return;

  let lastFocusedElement = null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function openModal() {
    lastFocusedElement = document.activeElement;
    modal.style.display = 'flex';
    modal.removeAttribute('aria-hidden');
    showStep(1);
    previewError.style.display = 'none';
    linkInput.value = '';
    // Defer focus so display:flex has rendered
    requestAnimationFrame(() => linkInput.focus());
  }

  function closeModal() {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (lastFocusedElement) lastFocusedElement.focus();
  }

  function showStep(n) {
    step1.style.display = n === 1 ? 'block' : 'none';
    step2.style.display = n === 2 ? 'block' : 'none';
    // Update stepper indicators
    modal.querySelectorAll('.modal-stepper .step').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.step) === n);
    });
  }

  function showError(message) {
    previewErrorText.textContent = message;
    previewError.style.display = 'flex';
  }

  // ── Open / Close ─────────────────────────────────────────────────────────

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
  });

  // ── Focus trap ───────────────────────────────────────────────────────────

  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ── Back button ───────────────────────────────────────────────────────────

  backBtn.addEventListener('click', () => showStep(1));

  // ── Preview form submission ───────────────────────────────────────────────

  previewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = linkInput.value;
    const btn = previewForm.querySelector('button[type="submit"]');

    // Set loading state
    btn.classList.add('btn-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    linkInput.disabled = true;
    previewError.style.display = 'none';

    try {
      const res = await fetch('/items/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to preview listing');
      }

      // Populate preview card
      document.getElementById('previewTitle').textContent = data.title || 'Untitled';
      document.getElementById('previewPrice').textContent = data.price ? '$' + data.price : '';

      const conditionEl = document.getElementById('previewCondition');
      conditionEl.textContent = data.condition || '';

      const locationEl = document.getElementById('previewLocation');
      locationEl.textContent = data.location || '';

      document.getElementById('previewDesc').textContent = data.description || '';

      const imgEl = document.getElementById('previewImage');
      if (data.imageLinks?.[0]) {
        imgEl.src = data.imageLinks[0];
        imgEl.style.display = 'block';
      } else {
        imgEl.src = '';
        imgEl.style.display = 'none';
      }

      // Cache values in hidden fields
      document.getElementById('finalLink').value = link;
      document.getElementById('cachedTitle').value = data.title || '';
      document.getElementById('cachedPrice').value = data.price || '';
      document.getElementById('cachedCondition').value = data.condition || '';
      document.getElementById('cachedDescription').value = data.description || '';
      document.getElementById('cachedLocation').value = data.location || '';
      document.getElementById('cachedImageLinks').value = JSON.stringify(data.imageLinks || []);
      document.getElementById('cachedAvailable').value = data.available ? 'true' : 'false';

      showStep(2);

    } catch (err) {
      showError(err.message);
    } finally {
      btn.classList.remove('btn-loading');
      btn.setAttribute('aria-busy', 'false');
      btn.disabled = false;
      linkInput.disabled = false;
    }
  });
});
