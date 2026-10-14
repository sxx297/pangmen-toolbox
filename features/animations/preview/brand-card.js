/* One specimen for the main stage, static thumbnails and animated thumbnails. */
(function () {
  globalThis.PangBrandCard = {
    populate(parent, source) {
      parent.classList.add('pang-preview-card');
      if (source?.classList.contains('pang-preview-card')) {
        parent.append(...Array.from(source.children, child => child.cloneNode(true)));
        return;
      }
      const logo = document.createElement('img');
      logo.className = 'pang-card-symbol'; logo.alt = '';
      logo.src = document.getElementById('preview-brand-glyph').src;
      const detail = document.createElement('span');
      detail.className = 'pang-card-detail'; detail.textContent = '01 / MOTION';
      const caption = document.createElement('span');
      caption.className = 'pang-card-english'; caption.textContent = 'PANGMEN DESIGN';
      parent.append(logo, detail, caption);
    }
  };
})();
