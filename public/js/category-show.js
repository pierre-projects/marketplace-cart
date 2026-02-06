document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const openBtn = document.getElementById('openSettingsModal');
  const closeBtn = modal.querySelector('.modal-close');

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      modal.style.display = 'none';
    }
  });
});
