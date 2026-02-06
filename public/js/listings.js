document.addEventListener('DOMContentLoaded', () => {
  const items = document.querySelectorAll('.item-card');
  if (items.length === 0) return;

  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const chips = document.querySelectorAll('.chip');
  const noResults = document.getElementById('noResults');
  const itemList = document.querySelector('.item-list');

  let activeFilter = 'all';

  // Update stats based on visible items
  function updateStats() {
    const visible = document.querySelectorAll('.item-card:not([style*="display: none"])');
    let total = 0;
    let available = 0;

    visible.forEach(card => {
      const price = parseFloat(card.dataset.price) || 0;
      total += price;
      if (card.dataset.available === 'true') available++;
    });

    document.getElementById('statCount').textContent = visible.length;
    document.getElementById('statTotal').textContent = '$' + total.toFixed(2);
    document.getElementById('statAvailable').textContent = available;

    // Show/hide no results message
    if (visible.length === 0) {
      noResults.style.display = 'block';
      itemList.style.display = 'none';
    } else {
      noResults.style.display = 'none';
      itemList.style.display = '';
    }
  }

  // Filter items
  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();

    items.forEach(card => {
      const title = card.dataset.title || '';
      const description = card.dataset.description || '';
      const condition = card.dataset.condition || '';
      const available = card.dataset.available;

      // Search match
      const matchesSearch = !query || title.includes(query) || description.includes(query);

      // Filter match
      let matchesFilter = true;
      if (activeFilter === 'available') {
        matchesFilter = available === 'true';
      } else if (activeFilter === 'sold') {
        matchesFilter = available === 'false';
      } else if (activeFilter === 'new') {
        matchesFilter = condition === 'new';
      } else if (activeFilter === 'used') {
        matchesFilter = condition === 'used';
      }

      card.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
    });

    updateStats();
  }

  // Sort items
  function applySort() {
    const sortBy = sortSelect.value;
    const arr = Array.from(items);

    arr.sort((a, b) => {
      switch (sortBy) {
        case 'price-high':
          return (parseFloat(b.dataset.price) || 0) - (parseFloat(a.dataset.price) || 0);
        case 'price-low':
          return (parseFloat(a.dataset.price) || 0) - (parseFloat(b.dataset.price) || 0);
        case 'title':
          return (a.dataset.title || '').localeCompare(b.dataset.title || '');
        case 'oldest':
          // Reverse the current DOM order (items are newest-first by default)
          return -1;
        case 'newest':
        default:
          return 1;
      }
    });

    // Re-append in sorted order
    arr.forEach(card => itemList.appendChild(card));
    applyFilters();
  }

  // Search handler
  searchInput.addEventListener('input', applyFilters);

  // Sort handler
  sortSelect.addEventListener('change', applySort);

  // Filter chip handler
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      applyFilters();
    });
  });

  // Initial stats calculation
  updateStats();
});
