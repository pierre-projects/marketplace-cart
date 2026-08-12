(function () {
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

      const activeControl = controls.find(
        (control) => Number(control.dataset.chartControl) === activeIndex
      );
      if (!activeControl) return;

      centerValue.textContent = activeControl.dataset.chartPercent || '0%';
      centerLabel.textContent = activeControl.dataset.chartPlatform || 'Marketplace';
    }

    controls.forEach((control) => {
      const index = Number(control.dataset.chartControl);

      control.addEventListener('pointerenter', () => {
        previewIndex = index;
        render();
      });

      control.addEventListener('pointerleave', () => {
        previewIndex = null;
        render();
      });

      control.addEventListener('focus', () => {
        previewIndex = index;
        render();
      });

      control.addEventListener('blur', () => {
        previewIndex = null;
        render();
      });

      control.addEventListener('click', () => {
        pinnedIndex = pinnedIndex === index ? null : index;
        previewIndex = null;
        render();
      });
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || pinnedIndex === null) return;
      event.preventDefault();
      pinnedIndex = null;
      previewIndex = null;
      render();
    });

    render();
  }

  function init() {
    document.querySelectorAll('[data-stats-panel]').forEach(setupStatsPanel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
