document.addEventListener('DOMContentLoaded', () => {
    const openBtn = document.getElementById('openAddForm');
    const addForm = document.getElementById('addForm');
    const previewForm = document.getElementById('previewForm');
  
    if (openBtn && addForm) {
      openBtn.onclick = () => {
        addForm.style.display = 'block';
      };
    }
  
    if (previewForm) {
      previewForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const link = document.getElementById('link').value;
  
        const res = await fetch('/items/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link })
        });
  
        const data = await res.json();
        if (data.error) {
          alert(data.error);
          return;
        }
  
        // Fill preview content
        document.getElementById('previewTitle').textContent = data.title || 'N/A';
        document.getElementById('previewImage').src = data.imageLinks[0] || '';
        document.getElementById('previewPrice').textContent = data.price || 'N/A';
        document.getElementById('previewCondition').textContent = data.condition || 'N/A';
        document.getElementById('previewDesc').textContent = data.description || 'N/A';
        document.getElementById('previewLocation').textContent = data.location || 'N/A';
        document.getElementById('previewAvailable').textContent = data.available ? 'Yes' : 'No';
  
        document.getElementById('finalLink').value = link;
        document.getElementById('previewContainer').style.display = 'block';
      });
    }
  });
