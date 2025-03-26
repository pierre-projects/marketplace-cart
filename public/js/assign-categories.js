document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.move-category-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
  
        const itemId = form.dataset.itemId;
        const select = form.querySelector('select[name="categories"]');
        const selectedValues = Array.from(select.selectedOptions).map(opt => opt.value);
  
        const res = await fetch(`/items/${itemId}/assign-categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryIds: selectedValues })
        });
  
        const result = await res.json();
        if (result.success) {
          alert('✅ Categories updated!');
        } else {
          alert('❌ Failed to update categories.');
        }
      });
    });
  });
  