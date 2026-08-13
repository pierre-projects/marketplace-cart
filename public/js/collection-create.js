document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-collection-create]').forEach((creator) => {
    creator.addEventListener('toggle', () => {
      if (!creator.open) return;
      requestAnimationFrame(() => creator.querySelector('input[name="name"]')?.focus());
    });
  });
});
