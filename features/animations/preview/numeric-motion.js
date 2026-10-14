/* Fixed digit slots and finite vertical reels. Playback depends on time, not frame count. */
(function (global) {
  'use strict';
  const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
  const safe = (n, fallback) => Number.isFinite(n) ? n : fallback;
  const smooth = n => { n = clamp(n); return n ** 3 * (n * (n * 6 - 15) + 10); };
  const scaled = (n, scale) => Math.sign(n) * Math.round(Math.abs(n) * scale + 1e-7);
  const affix = n => typeof n === 'string' ? Array.from(n.replace(/[\r\n]/g, '')).slice(0, 40).join('') : '';
  function node(tag, className, parent, value) {
    const el = document.createElement(tag); el.className = className;
    if (value !== undefined) el.textContent = value;
    parent.appendChild(el); return el;
  }
  function reel(p, column, columns, target) {
    const start = .025 * column / Math.max(1, columns - 1), finish = .76 + .12 * column / Math.max(1, columns - 1);
    return (10 + target) * smooth((p - start) / (finish - start));
  }
  function create(container, options = {}) {
    if (!container?.appendChild) throw new TypeError('MotionNumbers.create requires a DOM container.');
    const decimals = clamp(Math.round(safe(options.numberDecimals, 0)), 0, 6), scale = 10 ** decimals;
    const start = scaled(clamp(safe(options.numberStart, 0), -999999999, 999999999), scale);
    const end = scaled(clamp(safe(options.numberEnd, 12860), -999999999, 999999999), scale);
    const prefix = affix(options.numberPrefix), suffix = affix(options.numberSuffix), grouping = options.numberGrouping !== false;
    const style = options.numberStyle === 'count' ? 'count' : 'roll', duration = clamp(safe(options.duration, 1.6), .15, 12);
    const minDigits=clamp(Math.round(safe(options.numberMinDigits,1)),1,40);
    const integerCount = Math.max(minDigits, String(Math.floor(Math.max(Math.abs(start), Math.abs(end)) / scale)).length);
    const digitCount = integerCount + decimals, target = String(Math.abs(end)).padStart(digitCount, '0');
    const scene = node('div', 'mn-scene', container), line = node('div', `mn-line mn-${style}`, scene);
    scene.setAttribute('role', 'img'); scene.dataset.style = style;
    if (/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(options.color || '')) scene.style.setProperty('--mn-color', options.color);
    if (options.fontFamily) line.style.fontFamily = options.fontFamily;
    const digits = [], separators = [];
    if (prefix) node('span', 'mn-affix', line, prefix);
    const sign = (start < 0 || end < 0 || options.numberSign==='+') ? node('span', 'mn-sign', line, options.numberSign==='+'?'+':'−') : null;
    for (let i = 0; i < digitCount; i++) {
      if (i === integerCount && decimals) node('span', 'mn-separator', line, '.');
      else if (grouping && i > 0 && i < integerCount && (integerCount - i) % 3 === 0) {
        separators.push({ el: node('span', 'mn-separator', line, ','), preceding: i - 1 });
      }
      const window = node('span', 'mn-digit-window', line), track = node('span', 'mn-track', window);
      if (style === 'roll') for (let d = 0; d <= 20; d++) node('span', 'mn-glyph', track, String(d % 10));
      else node('span', 'mn-glyph', track, '0');
      digits.push({ window, track });
    }
    if (suffix) node('span', 'mn-affix', line, suffix);
    let dead = false, observer = null;
    function format(integer) {
      const parts = (Math.abs(integer) / scale).toFixed(decimals).split('.');parts[0]=parts[0].padStart(minDigits,'0');
      if (grouping) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return prefix + (integer < 0 ? '−' : options.numberSign==='+'?'+':'') + parts.join('.') + suffix;
    }
    function fit() {
      if (dead || !scene.clientWidth || !scene.clientHeight) return;
      line.style.fontSize = '';
      const css = global.getComputedStyle(scene), font = parseFloat(global.getComputedStyle(line).fontSize);
      const width = scene.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const height = scene.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      const box = line.getBoundingClientRect(), ratio = Math.min(1, width / Math.max(1, box.width), height / Math.max(1, box.height));
      if (ratio < 1) line.style.fontSize = `${Math.max(1, font * ratio * .98)}px`;
    }
    function render(seconds) {
      if (dead) return;
      const p = clamp(safe(seconds, 0) / duration), ease = 1 - (1 - clamp(p / .86)) ** 3;
      const value = p >= .86 ? end : scaled(start + (end - start) * ease, 1);
      const label = format(value), magnitude = String(Math.abs(value)).padStart(decimals + 1, '0').padStart(digitCount, minDigits>1?'0':' ');
      scene.dataset.value = label;
      scene.setAttribute('aria-label', style === 'roll' && p < .88 ? `滚动至 ${format(end)}` : label);
      if (sign) sign.style.opacity = options.numberSign==='+'?'1':style === 'roll' ? String(end < 0 ? 1 : 0) : String(value < 0 ? 1 : 0);
      digits.forEach(({ track }, i) => {
        if (style === 'roll') track.style.transform = `translate3d(0,${-reel(p, i, digitCount, Number(target[i])) * 1.2}em,0)`;
        else if (track.firstChild.textContent !== magnitude[i]) track.firstChild.textContent = magnitude[i];
      });
      separators.forEach(({ el, preceding }) => { el.style.opacity = style === 'roll' || magnitude[preceding] !== ' ' ? '1' : '0'; });
    }
    render(0); fit();
    if (global.ResizeObserver) { observer = new global.ResizeObserver(fit); observer.observe(scene); }
    return { render, duration, unitCount: digitCount, destroy() { if (!dead) { dead = true; observer?.disconnect(); scene.remove(); } } };
  }
  global.MotionNumbers = Object.freeze({ create, reel });
})(globalThis);
