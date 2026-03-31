document.addEventListener('DOMContentLoaded', () => {
  const menus = Array.from(document.querySelectorAll('[data-account-menu]'));
  if (!menus.length) return;

  const closeMenu = (menu) => {
    const trigger = menu.querySelector('[data-account-trigger]');
    const dropdown = menu.querySelector('[data-account-dropdown]');
    if (!trigger || !dropdown) return;

    menu.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.hidden = true;
  };

  const openMenu = (menu) => {
    const trigger = menu.querySelector('[data-account-trigger]');
    const dropdown = menu.querySelector('[data-account-dropdown]');
    if (!trigger || !dropdown) return;

    menu.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.hidden = false;
  };

  menus.forEach((menu, index) => {
    const trigger = menu.querySelector('[data-account-trigger]');
    const dropdown = menu.querySelector('[data-account-dropdown]');
    if (!trigger || !dropdown) return;

    if (!dropdown.id) dropdown.id = `account-dropdown-${index + 1}`;
    trigger.setAttribute('aria-controls', dropdown.id);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('is-open');
      menus.forEach(closeMenu);
      if (!isOpen) openMenu(menu);
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      }
    });
  });

  document.addEventListener('click', (e) => {
    menus.forEach((menu) => {
      if (!menu.contains(e.target)) closeMenu(menu);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    menus.forEach(closeMenu);
  });
});
