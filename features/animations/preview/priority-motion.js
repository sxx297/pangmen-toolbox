/* First production candidates. A frame is derived entirely from elapsed seconds;
 * the host owns playback. No timers, network calls, or persistent document edits. */
(function (global) {
  'use strict';
  const recipes = Object.freeze(['pivot-in', 'pivot-out', 'line-draw-in', 'line-draw-out', 'flip-once', 'jack-in', 'roll-in', 'roll-out', 'color-sweep', 'grid-in', 'grid-out', 'flow-dots', 'text-read', 'text-cycle']);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const ease = p => 1 - Math.pow(1 - clamp(p), 3);
  const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
  const chars = value => typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(value), item => item.segment) : Array.from(value);
  const directionAngles = Object.freeze({ up: 0, 'up-right': 45, right: 90, 'down-right': 135, down: 180, 'down-left': 225, left: 270, 'up-left': 315 });
  function directionVector(direction, angle) {
    const degrees = direction === 'custom' ? finite(angle, 0) : (directionAngles[direction] ?? 0), radians = degrees * Math.PI / 180;
    return [Math.sin(radians), -Math.cos(radians)];
  }
  const ns = 'http://www.w3.org/2000/svg';
  function node(tag, cls, parent, value) {
    const el = document.createElement(tag); el.className = cls;
    if (value !== undefined) el.textContent = value;
    if (parent) parent.appendChild(el); return el;
  }
  function svgNode(tag, attributes, parent) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
    if (parent) parent.appendChild(el); return el;
  }
  function pose(el, x = 0, y = 0, angle = 0, scale = 1, opacity = 1, axis = 'z') {
    el.style.transform = `translate3d(${x.toFixed(4)}px,${y.toFixed(4)}px,0) rotate${axis.toUpperCase()}(${angle.toFixed(4)}deg) scale(${scale.toFixed(5)})`;
    el.style.opacity = String(clamp(opacity));
  }
  function clip(p, direction) {
    const hidden = ((1 - clamp(p)) * 100).toFixed(4);
    return direction === 'left' ? `inset(0 0 0 ${hidden}%)` : direction === 'down' ? `inset(0 0 ${hidden}% 0)` : direction === 'up' ? `inset(${hidden}% 0 0 0)` : `inset(0 ${hidden}% 0 0)`;
  }
  function interpolate(p, points) {
    for (let i = 1; i < points.length; i++) if (p <= points[i][0]) {
      const [a, x] = points[i - 1], [b, y] = points[i]; return x + (y - x) * smooth((p - a) / (b - a));
    }
    return points[points.length - 1][1];
  }
  function readingPieces(content) {
    const result = [];
    for (const phrase of content.match(/[^\n，,。.!！？?；;：:]+|[\n，,。.!！？?；;：:]+/gu) || []) {
      if (/^[\n，,。.!！？?；;：:]+$/u.test(phrase)) { result.push({ value: phrase, punctuation: true }); continue; }
      if (chars(phrase).length <= 10) { result.push({ value: phrase }); continue; }
      const words = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(phrase), item => item.segment) : chars(phrase);
      let group = '';
      for (const word of words) {
        if (group && chars(group + word).length > 6) { result.push({ value: group }); group = ''; }
        if (chars(word).length > 10) {
          if (group) { result.push({ value: group }); group = ''; }
          const glyphs = chars(word); for (let i = 0; i < glyphs.length; i += 6) result.push({ value: glyphs.slice(i, i + 6).join('') });
        } else group += word;
      }
      if (group) result.push({ value: group });
    }
    return result;
  }
  function create(container, options = {}) {
    if (!container || !container.appendChild) throw new TypeError('PriorityMotion.create requires a DOM container.');
    const recipe = options.effect?.recipe || options.effect?.id;
    if (!recipes.includes(recipe)) throw new RangeError(`Unknown priority recipe: ${recipe}`);
    const base = clamp(finite(options.duration, 1.2), .15, 12), gap = clamp(finite(options.stagger, .06), 0, .5);
    let intensity = clamp(finite(options.intensity, 1), .1, 3);
    let direction = Object.prototype.hasOwnProperty.call(directionAngles, options.direction) || ['custom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(options.direction) ? options.direction : 'up';
    let directionAngle = finite(options.directionAngle, directionAngles[direction] ?? 0);
    const color = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(options.color || '') ? options.color : '#ff5500';
    const shape = ['card', 'circle', 'diamond', 'image'].includes(options.shape) ? options.shape : 'card';
    const content = chars(String(options.text == null ? '让想法，跃然眼前' : options.text).replace(/\r\n?/g, '\n')).slice(0, 160).join('');
    const scene = node('div', `pm-scene pm-${recipe}`, container);
    scene.setAttribute('aria-hidden', 'true'); scene.style.setProperty('--pm-color', color); scene.dataset.recipe = recipe;
    const isGrid = recipe.startsWith('grid-'), isLine = recipe.startsWith('line-draw-');
    let duration = base, unitCount = 1, dead = false, lastTime = 0, observer = null;
    let single, core, sweep, drawing, drawingPath, drawingTip, lineLength = 1, grid, read, cycle, cycleWrap, cycleFront, cycleNext;
    let cycleWords = [], activeFront = null, activeNext = null;
    const gridUnits = [], flowRoutes = [], readUnits = [];
    const metrics = { width: 1, height: 1, objectWidth: 1, objectHeight: 1 };
    function card(parent, extra = '') {
      const card = node('div', `pm-card pm-shape-${shape} ${extra}`, parent);
      const validImage = shape === 'image' && /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.test(options.imageData || '');
      if (validImage) { const img = node('img', 'pm-upload', card); img.alt = ''; img.src = options.imageData; }
      else {
        global.PangBrandCard.populate(card, options.previewCard);
      }
      return card;
    }
    if (isGrid) {
      grid = node('div', 'pm-grid', scene); unitCount = 9; duration = base + 8 * gap;
      const centerOrder = [4, 1, 5, 7, 3, 0, 2, 8, 6];
      for (let i = 0; i < 9; i++) {
        const tile = node('div', `pm-tile${i === 4 ? ' pm-tile-featured' : ''}`, grid);
        global.PangBrandCard.populate(tile, options.previewCard);
        gridUnits.push({ tile, order: centerOrder.indexOf(i), row: Math.floor(i / 3) - 1, col: i % 3 - 1 });
      }
    } else if (isLine) {
      drawing = svgNode('svg', { class: 'pm-drawing', viewBox: '0 0 400 230', fill: 'none' }, scene);
      const d = 'M 40 164 C 96 164 79 64 134 64 C 183 64 165 173 222 139 C 265 113 250 54 303 76 C 330 87 333 123 359 83';
      svgNode('path', { d, class: 'pm-draw-guide', 'stroke-width': 1 }, drawing);
      drawingPath = svgNode('path', { d, class: 'pm-draw-path', 'stroke-width': 4.5, pathLength: 1, 'stroke-dasharray': 1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, drawing);
      drawingTip = svgNode('circle', { r: 5, class: 'pm-draw-tip' }, drawing);
      lineLength = drawingPath.getTotalLength();
    } else if (recipe === 'flow-dots') {
      const svg = svgNode('svg', { class: 'pm-flow', viewBox: '0 0 500 260', fill: 'none' }, scene);
      const paths = ['M 88 130 L 226 130', 'M 274 130 C 335 130 328 66 408 66', 'M 274 130 C 335 130 328 194 408 194'];
      for (let i = 0; i < paths.length; i++) {
        const path = svgNode('path', { d: paths[i], class: 'pm-flow-path', 'stroke-width': 1.7 }, svg);
        const dots = Array.from({ length: 3 }, () => svgNode('circle', { r: 3.8, class: 'pm-flow-dot' }, svg));
        flowRoutes.push({ path, dots, length: path.getTotalLength(), index: i });
      }
      for (const [x, y, label, central] of [[64, 130, 'IN', false], [250, 130, 'P', true], [432, 66, '01', false], [432, 194, '02', false]]) {
        svgNode('rect', { x: x - 24, y: y - 24, width: 48, height: 48, rx: 13, class: central ? 'pm-flow-node pm-flow-hub' : 'pm-flow-node' }, svg);
        const text = svgNode('text', { x, y: y + 1, class: central ? 'pm-flow-label pm-flow-label-hub' : 'pm-flow-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, svg); text.textContent = label;
      }
      unitCount = 9;
    } else if (recipe === 'text-read') {
      read = node('div', 'pm-read', scene);
      for (const piece of readingPieces(content)) {
        if (piece.punctuation) {
          const punctuation = node('span', 'pm-read-punctuation', read, piece.value); punctuation.style.whiteSpace = 'pre-wrap';
        } else {
          const unit = node('span', 'pm-read-piece', read, piece.value);
          const accent = node('span', 'pm-read-accent', unit, piece.value);
          const underline = node('span', 'pm-read-rule', unit);
          readUnits.push({ unit, accent, underline });
        }
      }
      unitCount = readUnits.length;
    } else if (recipe === 'text-cycle') {
      cycleWords = content.split(/[\n,，、;；]+/u).map(value => value.trim()).filter(Boolean);
      cycleWrap = node('div', 'pm-cycle-wrap', scene);
      node('span', 'pm-cycle-prefix', cycleWrap, cycleWords.length ? '让表达更' : '');
      cycle = node('div', 'pm-cycle', cycleWrap);
      cycleFront = node('div', 'pm-cycle-word', cycle); cycleNext = node('div', 'pm-cycle-word pm-cycle-next', cycle);
      unitCount = cycleWords.length;
    } else {
      single = node('div', 'pm-single', scene); core = card(single);
      if (recipe === 'flip-once') {
        single.classList.add('pm-two-sided'); core.classList.add('pm-front');
        const rear = card(single, 'pm-rear'); rear.style.transform = `rotate${direction === 'left' || direction === 'right' ? 'Y' : 'X'}(180deg)`;
      }
      if (recipe === 'color-sweep') {
        core.classList.add('pm-uncolored'); sweep = card(single, 'pm-sweep');
      }
    }
    function measure() {
      if (dead) return;
      metrics.width = scene.clientWidth || 1; metrics.height = scene.clientHeight || 1;
      metrics.objectWidth = single?.offsetWidth || 1; metrics.objectHeight = single?.offsetHeight || 1;
      if (read && global.getComputedStyle) {
        read.style.fontSize = '';
        let font = parseFloat(global.getComputedStyle(read).fontSize) || 20;
        for (let i = 0; i < 3; i++) {
          const ratio = Math.min(1, metrics.width * .84 / Math.max(1, read.scrollWidth), metrics.height * .75 / Math.max(1, read.scrollHeight));
          if (ratio > .998) break; font *= ratio * .97; read.style.fontSize = `${Math.max(.5, font).toFixed(3)}px`;
        }
      }
      if (cycle) {
        // Measure the actual font, including emoji and wide Latin glyphs; character
        // counts cannot safely predict the width of an arbitrary user keyword.
        const context = document.createElement('canvas').getContext('2d');
        context.font = '700 54px Geist, "Segoe UI", "Microsoft YaHei", sans-serif';
        const longest = Math.max(1, ...cycleWords.map(word => context.measureText(word).width));
        const prefixWidth = cycleWords.length ? context.measureText('让表达更').width + 13 : 0;
        const font = Math.max(.5, Math.min(54, metrics.width * .82 / (longest + prefixWidth) * 54, metrics.height * .29));
        cycleWrap.style.fontSize = `${font.toFixed(3)}px`;
        cycle.style.width = `${(longest / 54 * font + 1).toFixed(3)}px`;
      }
      render(lastTime);
    }
    function render(seconds) {
      if (dead) return;
      lastTime = clamp(finite(seconds, 0), 0, duration);
      const p = lastTime / duration, eased = ease(p);
      scene.dataset.progress = p.toFixed(6);
      if (single) {
        let x = 0, y = 0, angle = 0, scale = 1, opacity = 1, axis = 'z', origin = '50% 50%';
        const [dx, dy] = directionVector(direction, directionAngle), horizontal = Math.abs(dx) >= Math.abs(dy);
        const sign = horizontal ? Math.sign(dx || 1) : Math.sign(dy || -1);
        if (recipe.startsWith('pivot-')) {
          const exiting = recipe === 'pivot-out', progress = exiting ? p * p : 1 - eased;
          const corner = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(direction) ? direction : 'bottom-left';
          origin = { 'top-left': '0% 0%', 'top-right': '100% 0%', 'bottom-left': '0% 100%', 'bottom-right': '100% 100%' }[corner];
          angle = (corner.endsWith('right') ? 1 : -1) * 88 * progress * (.75 + .25 * intensity);
          opacity = exiting ? 1 - p*p*(3-2*p) : clamp(p * 7);
        } else if (recipe === 'flip-once') {
          axis = horizontal ? 'y' : 'x'; angle = sign * 360 * smooth(p);
          scale = 1 - .12 * intensity * Math.pow(Math.sin(Math.PI * p), 2);
        } else if (recipe === 'jack-in') {
          scale = interpolate(p, [[0, .06], [.5, 1.03], [.7, .985], [1, 1]]);
          angle = interpolate(p, [[0, 30], [.45, -10], [.7, 4], [1, 0]]) * intensity;
          opacity = clamp(p * 4); origin = '50% 100%';
        } else if (recipe.startsWith('roll-')) {
          const exiting = recipe === 'roll-out', progress = exiting ? p * p : 1 - eased;
          const distance = Math.hypot((metrics.width + metrics.objectWidth) * dx, (metrics.height + metrics.objectHeight) * dy) * .58;
          const travelSign = exiting ? 1 : -1;
          x = dx * travelSign * distance * progress; y = dy * travelSign * distance * progress;
          angle = travelSign * sign * 135 * progress * intensity; opacity = exiting ? 1 - p*p*(3-2*p) : clamp(p * 5);
        } else if (sweep) sweep.style.clipPath = clip(smooth(p), direction);
        single.style.transformOrigin = origin;
        if(recipe==='flip-once'){pose(single,0,0,0,scale,opacity); single.style.transform += ` scale${horizontal?'X':'Y'}(${Math.max(.012,Math.abs(Math.cos(angle*Math.PI/180)))})`;}
        else pose(single, x, y, angle, scale, opacity, axis);
      }
      if (isGrid) for (const item of gridUnits) {
        const q = clamp((lastTime - item.order * gap) / base), entering = recipe === 'grid-in';
        const hidden = entering ? 1 - ease(q) : smooth(q);
        pose(item.tile, item.col * 16 * hidden * intensity, (entering ? 22 : -22) * hidden * intensity + item.row * 10 * hidden, 0, 1 - .18 * hidden * intensity, 1 - hidden);
        item.tile.dataset.order = String(item.order);
      }
      if (drawingPath) {
        const reveal = recipe === 'line-draw-in' ? smooth(p) : 1 - smooth(p);
        drawingPath.style.strokeDashoffset = String(1 - reveal);
        drawingPath.style.opacity = reveal === 0 ? '0' : '1';
        const tip = drawingPath.getPointAtLength(lineLength * reveal);
        drawingTip.setAttribute('transform', `translate(${tip.x.toFixed(4)} ${tip.y.toFixed(4)})`);
        drawingTip.style.opacity = reveal > 0 && reveal < 1 ? '.9' : '0';
        drawing.dataset.reveal = reveal.toFixed(6);
      }
      for (const route of flowRoutes) route.dots.forEach((dot, index) => {
        const q = ((p === 1 ? 0 : p) + index / 3 + route.index * .13) % 1;
        const point = route.path.getPointAtLength(route.length * q);
        dot.setAttribute('transform', `translate(${point.x.toFixed(4)} ${point.y.toFixed(4)}) scale(${(.7 + .3 * intensity).toFixed(4)})`);
        dot.style.opacity = String(Math.pow(Math.sin(Math.PI * q), .5));
      });
      readUnits.forEach((unit, index) => {
        const local = clamp(p * readUnits.length - index);
        unit.accent.style.clipPath = clip(local, 'right');
        unit.underline.style.transform = `scaleX(${local.toFixed(5)})`;
        unit.underline.style.opacity = local > 0 ? '.42' : '0';
        unit.unit.dataset.read = local.toFixed(4);
      });
      if (read) scene.dataset.activePiece = String(Math.min(Math.max(0, readUnits.length - 1), Math.floor(p * readUnits.length)));
      if (cycle) {
        const slot = (p === 1 ? 0 : p) * cycleWords.length, index = Math.floor(slot), phase = slot - index;
        const current = cycleWords[index] || '', next = cycleWords[(index + 1) % cycleWords.length] || '';
        if (activeFront !== current) { cycleFront.textContent = current; activeFront = current; }
        if (activeNext !== next) { cycleNext.textContent = next; activeNext = next; }
        const q = smooth((phase - .68) / .32), distance = Math.min(68, metrics.height * .2);
        pose(cycleFront, 0, -distance * q, 0, 1, current ? 1 - q : 0);
        pose(cycleNext, 0, distance * (1 - q), 0, 1, next ? q : 0);
        scene.dataset.activeWord = current; scene.dataset.cycleIndex = String(index);
      }
    }
    measure();
    if (typeof global.ResizeObserver === 'function') { observer = new global.ResizeObserver(measure); observer.observe(scene); }
    function update(next = {}) {
      if (Object.prototype.hasOwnProperty.call(next, 'intensity')) intensity = clamp(finite(next.intensity, intensity), .1, 3);
      if (Object.prototype.hasOwnProperty.call(next, 'direction') && (Object.prototype.hasOwnProperty.call(directionAngles, next.direction) || ['custom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(next.direction))) {
        direction = next.direction;
        if (recipe === 'flip-once') rear.style.transform = `rotate${direction === 'left' || direction === 'right' ? 'Y' : 'X'}(180deg)`;
      }
      if (Object.prototype.hasOwnProperty.call(next, 'directionAngle')) directionAngle = finite(next.directionAngle, directionAngle);
      render(lastTime);
    }
    return { render, update, duration, unitCount, destroy() { if (!dead) { dead = true; observer?.disconnect(); scene.remove(); } } };
  }
  global.PriorityMotion = Object.freeze({ create, recipes });
})(globalThis);
