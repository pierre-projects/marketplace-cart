/**
 * Loaded on every page by views/layouts/main.ejs. Page-specific behaviour
 * lives in pages/*.js, which each view loads itself; shared pieces live in
 * lib/ and are imported where needed, so no script depends on another having
 * been loaded first.
 */
import { initTheme } from './lib/theme.js';
import { registerDisclosure } from './lib/disclosure.js';
import { installFormBehaviours } from './lib/forms.js';

initTheme();
installFormBehaviours();

// Account menu in the signed-out navbar.
registerDisclosure({
  root: '[data-account-menu]',
  trigger: '[data-account-trigger]',
  panel: '[data-account-dropdown]',
  useHidden: true,
});
