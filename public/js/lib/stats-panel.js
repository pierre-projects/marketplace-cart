/**
 * The marketplace donut in views/partials/stats-panel.ejs: hovering or
 * focusing a row previews its slice, clicking pins it, Escape unpins.
 *
 * Listeners are delegated to the panel (pointerover/out and focusin/out
 * bubble; the enter/leave pairs used before needed five listeners per row).
 */

function setupStatsPanel(panel) {
  const controls = Array.from(panel.querySelectorAll('[data-chart-control]'));
  const segments = Array.from(panel.querySelectorAll('[data-chart-segment]'));
  const centerValue = panel.querySelector('[data-chart-center-value]');
  const centerLabel = panel.querySelector('[data-chart-center-label]');

  if (!controls.length || !segments.length || !centerValue || !centerLabel) return;

  const defaultValue = panel.dataset.defaultValue || String(controls.length);
  const defaultLabel = panel.dataset.defaultLabel || 'marketplaces';
  let previewIndex = null;
  let pinnedIndex = null;

  function render() {
    const activeIndex = previewIndex !== null ? previewIndex : pinnedIndex;
    const hasHighlight = activeIndex !== null;
    panel.classList.toggle('has-chart-highlight', hasHighlight);

    segments.forEach((segment) => {
      const index = Number(segment.dataset.chartSegment);
      segment.classList.toggle('is-highlighted', index === activeIndex);
      segment.classList.toggle('is-dimmed', hasHighlight && index !== activeIndex);
    });

    controls.forEach((control) => {
      const index = Number(control.dataset.chartControl);
      control.classList.toggle('is-highlighted', index === activeIndex);
      control.classList.toggle('is-dimmed', hasHighlight && index !== activeIndex);
      control.setAttribute('aria-pressed', index === pinnedIndex ? 'true' : 'false');
    });

    if (!hasHighlight) {
      centerValue.textContent = defaultValue;
      centerLabel.textContent = defaultLabel;
      return;
    }

    const activeControl = controls.find(control => Number(control.dataset.chartControl) === activeIndex);
    if (!activeControl) return;

    centerValue.textContent = activeControl.dataset.chartPercent || '0%';
    centerLabel.textContent = activeControl.dataset.chartPlatform || 'Marketplace';
  }

  const indexOf = (target) => {
    const control = target.closest?.('[data-chart-control]');
    return control && panel.contains(control) ? Number(control.dataset.chartControl) : null;
  };

  const preview = (e) => {
    const index = indexOf(e.target);
    if (index === null || index === previewIndex) return;
    previewIndex = index;
    render();
  };

  const unpreview = (e) => {
    // Moving between children of the same row is not leaving it.
    if (indexOf(e.target) === null || indexOf(e.relatedTarget || document.body) === previewIndex) return;
    previewIndex = null;
    render();
  };

  panel.addEventListener('pointerover', preview);
  panel.addEventListener('focusin', preview);
  panel.addEventListener('pointerout', unpreview);
  panel.addEventListener('focusout', unpreview);

  panel.addEventListener('click', (e) => {
    const index = indexOf(e.target);
    if (index === null) return;
    pinnedIndex = pinnedIndex === index ? null : index;
    previewIndex = null;
    render();
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pinnedIndex === null) return;
    e.preventDefault();
    pinnedIndex = null;
    previewIndex = null;
    render();
  });

  render();
}

export function initStatsPanels() {
  document.querySelectorAll('[data-stats-panel]').forEach(setupStatsPanel);
}
