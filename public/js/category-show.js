document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const openBtn = document.getElementById('openSettingsModal');
  const closeBtn = modal.querySelector('.modal-close');

  openBtn.addEventListener('click', () => {
    modal.classList.add('is-open');
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('is-open');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('is-open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      modal.classList.remove('is-open');
    }
  });
});
