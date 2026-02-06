document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('addListingModal');
  const openBtn = document.getElementById('openAddModal');
  const closeBtn = modal?.querySelector('.modal-close');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const backBtn = document.getElementById('backToStep1');
  const previewForm = document.getElementById('previewForm');
  const previewError = document.getElementById('previewError');

  if (!modal || !openBtn) return;

  // Open modal
  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    step1.style.display = 'block';
    step2.style.display = 'none';
    previewError.style.display = 'none';
    document.getElementById('link').value = '';
    document.getElementById('link').focus();
  });

  // Close modal
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      modal.style.display = 'none';
    }
  });

  // Back button
  backBtn.addEventListener('click', () => {
    step1.style.display = 'block';
    step2.style.display = 'none';
  });

  // Preview form submission
  previewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = document.getElementById('link').value;
    const btn = previewForm.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.textContent = 'Loading...';
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

      // Populate preview
      document.getElementById('previewTitle').textContent = data.title || 'Untitled';
      document.getElementById('previewPrice').textContent = '$' + (data.price || 0);
      document.getElementById('previewCondition').textContent = data.condition || 'N/A';
      document.getElementById('previewLocation').textContent = data.location || 'N/A';
      document.getElementById('previewDesc').textContent = data.description || '';
      document.getElementById('previewImage').src = data.imageLinks?.[0] || '';

      // Cache values in hidden fields
      document.getElementById('finalLink').value = link;
      document.getElementById('cachedTitle').value = data.title || '';
      document.getElementById('cachedPrice').value = data.price || '';
      document.getElementById('cachedCondition').value = data.condition || '';
      document.getElementById('cachedDescription').value = data.description || '';
      document.getElementById('cachedLocation').value = data.location || '';
      document.getElementById('cachedImageLinks').value = JSON.stringify(data.imageLinks || []);
      document.getElementById('cachedAvailable').value = data.available ? 'true' : 'false';

      // Switch to step 2
      step1.style.display = 'none';
      step2.style.display = 'block';

    } catch (err) {
      previewError.textContent = err.message;
      previewError.style.display = 'block';
    }

    btn.disabled = false;
    btn.textContent = 'Preview';
  });
});
