(function () {
  const params = new URLSearchParams(location.search);
  const app = document.getElementById('app');
  const footer = document.querySelector('.apply-panel');
  const inspector = document.querySelector('.inspector');
  const preview = document.querySelector('.preview-column');
  const heading = document.querySelector('.preview-heading');
  const description = document.getElementById('effect-description');
  function wantsStage() {
    return document.body.dataset.surface !== 'sidebar';
  }
  function sync() {
    if (!document.body.dataset.surface) return;
    preview.hidden = !wantsStage();
    if (preview.hidden) MotionPreview.pause();
  }
  function syncToggle() {
    const button = document.getElementById('surface-toggle');
    if (!button) return;
    const sidebar = document.body.dataset.surface === 'sidebar';
    const label = sidebar ? '切换为悬浮窗' : '停靠到右侧';
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
    button.innerHTML = sidebar
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6-8 8M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 12h6m-2-2 2 2-2 2"/></svg>';
  }
  function set(mode) {
    if (!['floating', 'sidebar'].includes(mode)) return;
    const previous = document.body.dataset.surface;
    document.body.dataset.surface = mode;
    const pin = document.getElementById('pin-toggle');
    if (pin) pin.closest('label').hidden = mode === 'sidebar';
    app.appendChild(footer);
    inspector.prepend(heading, description, preview);
    syncToggle();
    sync();
    if (mode === 'floating' && previous === 'sidebar' && MotionPreview.getState().autoplay) {
      MotionPreview.seek(0);
      MotionPreview.play();
    }
  }
  globalThis.PangSurface = { set, sync, wantsStage };
  document.getElementById('surface-toggle')?.addEventListener('click', () => {
    globalThis.PangPlugin?.changeSurface(document.body.dataset.surface === 'sidebar' ? 'floating' : 'sidebar');
  });
  set(params.get('surface') || 'floating');
})();
