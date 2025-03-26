document.addEventListener('DOMContentLoaded', () => {
    if (typeof itemData === 'undefined') return;
  
    const deduped = {};
  
    itemData.forEach(entry => {
      const item = entry.item;
      const link = item.link;
      const title = item.title || 'Untitled';
      const priceText = item.price || '';
      const platform = item.platform || 'Unknown';
      const addedAt = new Date(entry.addedAt || entry.item.addedAt || Date.now());
  
      if (!link || !priceText) return;
  
      const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      if (isNaN(price)) return;
  
      // Only keep most recent version of a duplicate link
      if (!deduped[link] || addedAt > deduped[link].addedAt) {
        deduped[link] = { platform, price, addedAt, title };
      }
    });
  
    // Build platform -> items[] map
    const platformGroups = {};
    let total = 0;
  
    Object.values(deduped).forEach(({ platform, price, title }) => {
      if (!platformGroups[platform]) platformGroups[platform] = [];
      platformGroups[platform].push({ title, price });
      total += price;
    });
  
    // Render result block
    const container = document.createElement('div');
    container.className = 'price-summary';
    container.style.marginTop = '2rem';
  
    Object.entries(platformGroups).forEach(([platform, items]) => {
      const subtotal = items.reduce((sum, i) => sum + i.price, 0);
      container.innerHTML += `<p><strong>${platform}:</strong> $${subtotal.toFixed(2)}</p>`;
  
      items.forEach(({ title, price }) => {
        container.innerHTML += `<p style="margin-left: 1rem;">${title} — $${price.toFixed(2)}</p>`;
      });
    });
  
    container.innerHTML += `<p style="margin-top: 1em;"><strong>Total:</strong> $${total.toFixed(2)}</p>`;
  
    const main = document.querySelector('main');
    if (main) main.appendChild(container);
  });
  