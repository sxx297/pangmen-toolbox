/* MotionEngine: dependency-free, deterministic and seekable. No timers are created.
 * const view = MotionEngine.create(stage, options); view.render(seconds);
 * view.duration includes stagger. Loop recipes describe exactly one cycle.
 * Call destroy() before replacing a specimen. All DOM and styles are scoped. */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const anvilDropTime = seconds => Math.min(.2, seconds * .4);
  const PRIORITY_RECIPES = new Set('pivot-in pivot-out line-draw-in line-draw-out flip-once jack-in roll-in roll-out color-sweep grid-in grid-out flow-dots text-read text-cycle'.split(' '));
  const RECIPES = new Set(('anvil spring float-in bounce-in brake-in zoom-in impact-in flip-in rotate-in wipe-in fold-in fade-in fade-out hop jelly wobble shake focus shine hover breathe pendulum spin heartbeat ripple slide-out shrink-out launch-out rotate-out fall-out wipe-out fold-out typewriter text-spring text-lines-in text-float text-flip text-tracking text-drop text-gather text-keyword text-wave-once text-highlight text-underline text-wave text-breathe text-shine text-type-loop text-delete text-fade-out text-sink text-lines-out text-flip-out text-fall-apart text-scatter text-collapse number-roll').split(' ').concat(Array.from(PRIORITY_RECIPES)));
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const out = p => 1 - Math.pow(1 - clamp(p), 3);
  const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
  const spring = p => p <= 0 ? 0 : p >= 1 ? 1 : (1 - Math.exp(-7 * p) * Math.cos(11.5 * p)) / (1 - Math.exp(-7) * Math.cos(11.5));
  const back = p => { p -= 1; return 1 + 2.70158 * p * p * p + 1.70158 * p * p; };
  function bounce(p) {
    const n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + .75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + .9375;
    return n * (p -= 2.625 / d) * p + .984375;
  }
  function keys(p, points) {
    for (let j = 1; j < points.length; j++) {
      if (p <= points[j][0]) {
        const [a, va] = points[j - 1], [b, vb] = points[j];
        return va + (vb - va) * smooth((p - a) / (b - a));
      }
    }
    return points[points.length - 1][1];
  }
  function graphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text), s => s.segment);
    return Array.from(text);
  }
  function words(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(text), s => s.segment);
    return text.match(/\s+|[^\s]+/gu) || [''];
  }
  function node(tag, name, parent, text) {
    const el = document.createElement(tag); el.className = name;
    if (text !== undefined) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }
  const directionAngles = Object.freeze({ up: 0, 'up-right': 45, right: 90, 'down-right': 135, down: 180, 'down-left': 225, left: 270, 'up-left': 315 });
  function directionVector(direction, angle) {
    const degrees = direction === 'custom' ? finite(angle, 0) : (directionAngles[direction] ?? 0);
    const radians = degrees * Math.PI / 180;
    return [Math.sin(radians), -Math.cos(radians)];
  }
  function pose() { return { x: 0, y: 0, sx: 1, sy: 1, rx: 0, ry: 0, rz: 0, skew: 0, opacity: 1, blur: 0, clip: 'none', mark: 0, rule: 0, glow: 0, light: 1 }; }
  function diagonalClip(p, direction, angle) {
    p = clamp(p);
    if (p <= 0) return 'inset(50%)';
    if (p >= 1) return 'none';
    const [dx, dy] = directionVector(direction, angle), source = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const project = point => (point[0] - 50) * dx + (point[1] - 50) * dy;
    const values = source.map(project), threshold = Math.min(...values) + (Math.max(...values) - Math.min(...values)) * p;
    const output = [];
    for (let i = 0; i < source.length; i++) {
      const a = source[i], b = source[(i + 1) % source.length], pa = project(a), pb = project(b), insideA = pa <= threshold, insideB = pb <= threshold;
      const cross = () => { const t = (threshold - pa) / (pb - pa); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
      if (insideA && insideB) output.push(b);
      else if (insideA && !insideB) output.push(cross());
      else if (!insideA && insideB) output.push(cross(), b);
    }
    return `polygon(${output.map(point => `${point[0].toFixed(3)}% ${point[1].toFixed(3)}%`).join(',')})`;
  }
  function clipAt(p, direction, angle) {
    if (!['up', 'down', 'left', 'right'].includes(direction)) return diagonalClip(p, direction, angle);
    const v = (100 * (1 - clamp(p))).toFixed(3);
    return direction === 'left' ? `inset(0 0 0 ${v}%)` : direction === 'right' ? `inset(0 ${v}% 0 0)` : direction === 'down' ? `inset(0 0 ${v}% 0)` : `inset(${v}% 0 0 0)`;
  }
  function compute(recipe, p, i, n, intensity, direction, metrics = {}, directionAngle = 0) {
    const s = pose(), e = out(p), q = 1 - p, a = intensity;
    const [dx, dy] = directionVector(direction, directionAngle);
    const wave = Math.sin(TAU * p), pulse = Math.sin(Math.PI * p);
    switch (recipe) {
      case 'arc-in': case 'arc-out': {
        const u=recipe==='arc-in'?1-e:p*p, distance=180*a, bend=finite(metrics.curvature,.5)*distance*4*u*(1-u), sign=recipe==='arc-in'?-1:1;
        s.x=sign*dx*distance*u-dy*bend;s.y=sign*dy*distance*u+dx*bend;s.opacity=recipe==='arc-in'?e:1-smooth(p);break;
      }
      case 'alternate-in': s.x=(i%2?1:-1)*150*a*(1-e);s.opacity=e;break;
      case 'orbit': {const theta=TAU*p*(direction==='left'?-1:1);s.x=22*a*Math.sin(theta);s.y=12*a*(1-Math.cos(theta));break;}
      case 'fade-in': s.opacity = smooth(p); break;
      case 'float-in': s.opacity = out(p); s.x = -dx * 55 * a * (1 - e); s.y = -dy * 55 * a * (1 - e); break;
      case 'spring': s.sx = s.sy = Math.max(.02, 1 + (spring(p) - 1) * (.8 + .2 * a)); s.opacity = clamp(p * 9); break;
      case 'anvil': {
        const hit = metrics.hitProgress || .2;
        if (p < hit) {
          const fall = clamp(p / hit);
          s.y = -(metrics.dropDistance || 400) * (1 - fall * fall);
          s.opacity = p === 0 ? 0 : 1;
        } else {
          // The export applies its contact vibration to the object, leaving smoke anchored.
          const shakeProgress = (p - hit) / (metrics.shakeProgress || .25);
          if (shakeProgress > 0 && shakeProgress < 1 && metrics.jitter) {
            const point = shakeProgress * 10, i = Math.floor(point), f = point - i;
            const current = metrics.jitter[i], next = metrics.jitter[i + 1];
            const objectScale = Math.min(metrics.objectWidth || 186, metrics.size || 186) / 186;
            s.x = (current.x + (next.x - current.x) * f) * Math.min(metrics.width, 960 * objectScale) * intensity;
            s.y = (current.y + (next.y - current.y) * f) * Math.min(metrics.height, 540 * objectScale) * intensity;
          }
        }
        break;
      }
      case 'bounce-in': s.y = -220 * a * (1 - bounce(p)); s.opacity = clamp(p * 12); break;
      case 'brake-in': s.x = -dx * 230 * a * (1 - back(p)); s.y = -dy * 230 * a * (1 - back(p)); s.skew = dx * 8 * a * Math.sin(Math.PI * p) * q; s.opacity = clamp(p * 7); break;
      case 'zoom-in': s.sx = s.sy = .12 + .88 * e; s.opacity = smooth(p); break;
      case 'impact-in': s.sx = s.sy = 1 + 2.1 * a * Math.pow(q, 4); s.opacity = clamp(p * 5); s.blur = 10 * a * Math.pow(q, 4); break;
      case 'flip-in': if (dx) s.ry = -dx * 100 * (1 - e); else s.rx = dy * 100 * (1 - e); s.opacity = clamp(p * 6); break;
      case 'rotate-in': s.rz = -75 * a * (1 - e); s.y = 90 * a * (1 - e); s.sx = s.sy = .6 + .4 * e; s.opacity = out(p); break;
      case 'wipe-in': s.clip = clipAt(smooth(p), direction, directionAngle); break;
      case 'fold-in': if (dx) { s.sx = .015 + .985 * e; s.ry = -dx * 80 * (1 - e); } else { s.sy = .015 + .985 * e; s.rx = dy * 80 * (1 - e); } s.opacity = clamp(p * 5); break;
      case 'hop': s.y = -48 * a * Math.pow(pulse, 1.6); s.sx = 1 + .075 * a * Math.sin(TAU * p); s.sy = 1 - .075 * a * Math.sin(TAU * p); break;
      case 'jelly': { const j = Math.sin(5 * Math.PI * p) * Math.pow(q, 2) * .3 * a; s.sx = 1 + j; s.sy = 1 - .7 * j; s.skew = Math.sin(7 * Math.PI * p) * q * q * 6 * a; break; }
      case 'wobble': s.rz = Math.sin(5 * Math.PI * p) * 19 * a * q * q; s.x = Math.sin(5 * Math.PI * p) * 14 * a * q * q; break;
      case 'shake': s.x = Math.sin(10 * Math.PI * p) * 13 * a * Math.sin(Math.PI * p); break;
      case 'focus': s.sx = s.sy = 1 + .22 * a * Math.pow(pulse, 2); break;
      case 'shine': s.glow = Math.sin(Math.PI * p); break;
      case 'hover': s.y = -14 * a * wave; s.rz = 1.8 * a * Math.sin(TAU * p); break;
      case 'breathe': s.sx = s.sy = 1 + .055 * a * (1 - Math.cos(TAU * p)); break;
      case 'pendulum': s.rz = 15 * a * wave; break;
      case 'spin': s.rz = (direction === 'left' ? -1 : 1) * 360 * p; break;
      case 'heartbeat': { const k = keys(p, [[0, 0], [.08, .12], [.17, 0], [.28, .19], [.41, 0], [1, 0]]); s.sx = s.sy = 1 + k * a; break; }
      case 'ripple': s.sx = s.sy = 1 + .025 * a * (1 - Math.cos(TAU * p)); break;
      case 'fade-out': s.opacity = 1 - smooth(p); break;
      case 'slide-out': s.x = dx * 320 * a * p * p; s.y = dy * 320 * a * p * p; s.opacity = 1 - Math.pow(p, 3); break;
      case 'shrink-out': { const scale = keys(p, [[0, 1], [.2, 1.12], [1, 0]]); s.sx = s.sy = scale; s.opacity = 1 - Math.pow(p, 4); break; }
      case 'launch-out': { const k = keys(p, [[0, 0], [.3, -.11], [.45, -.08], [1, 1]]); s.x = dx * 420 * a * k; s.y = dy * 420 * a * k; s.sx = 1 + Math.abs(dx) * .2 * a * Math.sin(Math.PI * p); s.sy = 1 + Math.abs(dy) * .2 * a * Math.sin(Math.PI * p); s.opacity = 1 - Math.pow(p, 6); break; }
      case 'rotate-out': s.rz = 180 * a * p * p; s.sx = s.sy = q * q; s.opacity = q; break;
      case 'fall-out': s.rz = 35 * a * p; s.y = 330 * a * p * p * p; s.x = 35 * a * p * p; s.opacity = 1 - Math.pow(p, 5); break;
      case 'wipe-out': s.clip = clipAt(1 - smooth(p), direction, directionAngle); s.opacity = p === 1 ? 0 : 1; break;
      case 'fold-out': if (dx) { s.sx = Math.pow(q, 2); s.ry = dx * 88 * p; } else { s.sy = Math.pow(q, 2); s.rx = -dy * 88 * p; } s.opacity = 1 - Math.pow(p, 5); break;
      case 'typewriter': s.opacity = p > .01 ? 1 : 0; break;
      case 'text-spring': s.y = 25 * a * (1 - spring(p)); s.sx = s.sy = Math.max(.02, .2 + .8 * spring(p)); s.opacity = clamp(p * 8); break;
      case 'text-lines-in': s.y = 50 * a * (1 - e); s.clip = `inset(0 0 ${(100 * (1 - e)).toFixed(3)}% 0)`; s.opacity = clamp(p * 6); break;
      case 'text-float': s.x = -dx * 30 * a * (1 - e); s.y = -dy * 30 * a * (1 - e); s.opacity = smooth(p); break;
      case 'text-flip': s.sx=.015+.985*e;s.rz=-8*(1-e);s.opacity=clamp(p*5);break;
      case 'text-tracking': s.x = (i - (n - 1) / 2) * 15 * a * (1 - e); s.opacity = smooth(p); break;
      case 'text-drop': { const k = bounce(p); s.y = -160 * a * (1 - k); s.rz = (i % 2 ? 1 : -1) * 13 * a * (1 - k); s.opacity = clamp(p * 12); break; }
      case 'text-gather': { const angle = i * 2.39996323; s.x = Math.cos(angle) * 180 * a * (1 - e); s.y = Math.sin(angle) * 110 * a * (1 - e); s.rz = Math.sin(angle) * 70 * a * (1 - e); s.opacity = smooth(p); break; }
      case 'text-keyword': s.sx = s.sy = 1 + .24 * a * pulse * pulse; s.y = -5 * a * pulse; s.light = 1 + .25 * pulse; break;
      case 'text-wave-once': s.y = -18 * a * pulse; s.sx = s.sy = 1 + .18 * a * pulse; break;
      case 'text-highlight': s.mark = smooth(p); break;
      case 'text-underline': s.rule = smooth(p); break;
      case 'text-wave': s.y = -11 * a * Math.sin(TAU * p - i * .55); s.rz = 2 * a * Math.sin(TAU * p - i * .55); break;
      case 'text-breathe': s.opacity = 1 - .4 * a / 2 * (1 - Math.cos(TAU * p)); s.sx = s.sy = 1 + .025 * a * (1 - Math.cos(TAU * p)); break;
      case 'text-shine': s.light = 1 + .75 * Math.pow(Math.max(0, Math.cos(TAU * p - i * .23)), 8); break;
      case 'text-type-loop': s.opacity = 1; break; // Global reveal/deletion schedule is applied below.
      case 'text-delete': s.opacity = p < .1 ? 1 : 0; break;
      case 'text-fade-out': s.opacity = 1 - smooth(p); break;
      case 'text-sink': s.y = 38 * a * smooth(p); s.opacity = 1 - smooth(p); break;
      case 'text-lines-out': s.y = -44 * a * smooth(p); s.clip = `inset(0 0 ${(100 * smooth(p)).toFixed(3)}% 0)`; s.opacity = p === 1 ? 0 : 1; break;
      case 'text-flip-out': s.ry = 95 * smooth(p); s.sx = 1 - .4 * p; s.opacity = 1 - p; break;
      case 'text-fall-apart': s.y = 220 * a * p * p; s.rz = ((i * 37) % 95 - 47) * a * p * p; s.x = Math.sin(i * 17) * 35 * a * p; s.opacity = 1 - p * p; break;
      case 'text-scatter': { const angle = i * 2.39996323; s.x = Math.cos(angle) * 200 * a * p * p; s.y = Math.sin(angle) * 150 * a * p * p; s.rz = Math.sin(angle) * 150 * p * p; s.opacity = 1 - smooth(p); break; }
      case 'text-collapse': s.x = -(i - (n - 1) / 2) * 23 * a * smooth(p); s.sx = s.sy = 1 - Math.pow(p, 3); s.opacity = 1 - Math.pow(p, 3); break;
    }
    s.skew = 0; s.blur = 0;
    if (['flip-in','fold-in','fold-out'].includes(recipe)) {
      if (dx) s.sx = Math.max(.012, Math.abs(Math.cos(s.ry * Math.PI / 180))) * s.sx;
      else s.sy = Math.max(.012, Math.abs(Math.cos(s.rx * Math.PI / 180))) * s.sy;
      s.rx = s.ry = 0;
    }
    if (recipe === 'text-wave-once') s.y = 0;
    if (['text-lines-in','text-lines-out'].includes(recipe)) s.y = 0;
    return s;
  }
  ['number-count','arc-in','arc-out','alternate-in','orbit'].forEach(id=>RECIPES.add(id));
  function create(container, options = {}) {
    if (!container || !container.appendChild) throw new TypeError('MotionEngine.create requires a DOM container.');
    const effect = options.effect || {}, recipe = effect.recipe || effect.id || 'fade-in';
    if (!RECIPES.has(recipe)) throw new RangeError(`Unknown motion recipe: ${recipe}`);
    if (PRIORITY_RECIPES.has(recipe)) {
      if (!global.PriorityMotion) throw new Error('首批动画资源未载入');
      return global.PriorityMotion.create(container, options);
    }
    if (recipe === 'number-roll' || recipe === 'number-count') {
      options = { ...options, numberStyle: recipe === 'number-count' ? 'count' : 'roll' };
      if (!global.MotionNumbers) throw new Error('数字动画资源未载入');
      return global.MotionNumbers.create(container, options);
    }
    const isText = effect.mode === 'text' || recipe.startsWith('text-') || recipe === 'typewriter';
    const isLoop = effect.category === 'loop' || ['hover', 'breathe', 'pendulum', 'spin', 'heartbeat', 'ripple', 'text-wave', 'text-breathe', 'text-shine', 'text-type-loop'].includes(recipe);
    const base = clamp(finite(options.duration, 1.2), .15, 12);
    const gap = clamp(finite(options.stagger, .06), 0, .5);
    let intensity = clamp(finite(options.intensity, 1), .1, 3);
    let direction = Object.prototype.hasOwnProperty.call(directionAngles, options.direction) || options.direction === 'custom' ? options.direction : 'up';
    let directionAngle = finite(options.directionAngle, directionAngles[direction] ?? 0);
    const shape = ['card', 'circle', 'diamond', 'image'].includes(options.shape) ? options.shape : 'card';
    const color = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(options.color || '') ? options.color : '#ff5500';
    const scene = node('div', recipe === 'anvil' ? 'me-scene me-scene-anvil' : 'me-scene', container); scene.style.setProperty('--me-color', color);
    scene.setAttribute('aria-hidden', 'true');
    if(/^#[0-9a-f]{6}$/i.test(options.markColor||''))scene.style.setProperty('--me-mark-color',options.markColor);
    const specimen = node('div', isText ? 'me-specimen me-text' : `me-specimen me-${shape}`, scene);
    const units = [], rings = [];
    const metrics = { curvature:finite(options.curvature,.5), width: 0, height: 0, size: 0, objectWidth: 0, dropDistance: 400,
      hitProgress: anvilDropTime(base) / base, shakeProgress: Math.min(.25, base * .5) / base,
      jitter: Array.from({ length: 11 }, (_, i) => {
        const seed = Math.sin((i + 1) * 127.1 + 31.7) * 43758.5453;
        const envelope = Math.pow(1 - i / 10, 2);
        return { x: .01 * ((seed - Math.floor(seed)) * 2 - 1) * envelope,
          y: -.025 * (i % 2 ? -1 : 1) * envelope };
      })
    };
    let dustCanvas = null, dustRenderer = null;
    let dead = false, lastTime = 0, resizeObserver = null, split = ['char', 'word', 'line'].includes(options.split) ? options.split : 'char';
    if (['typewriter', 'text-delete', 'text-type-loop'].includes(recipe)) split = 'char';
    if (['text-lines-in', 'text-lines-out','text-highlight'].includes(recipe)) split = 'line';
    if(['text-tracking','text-flip','text-scatter'].includes(recipe)) split='char';
    function addUnit(parent, value, line) {
      const outer = node('span', `me-unit${line ? ' me-line-unit' : ''}`, parent);
      const core = node('span', 'me-core', outer, value);
      const mark = node('span', 'me-marker', core), rule = node('span', 'me-rule', core), cursor = node('span', 'me-cursor', core);
      units.push({ outer, core, mark, rule, cursor, value });
    }
    if (isText) {
      let content = String(options.text == null ? '让灵感，自然发生' : options.text).replace(/\r\n?/g, '\n');
      content = graphemes(content).slice(0, 160).join('');
      if (graphemes(content).length > 34) specimen.classList.add('me-text-long');
      (content ? content.split('\n') : []).forEach(line => {
        const row = node('span', 'me-line', specimen);
        const pieces = split === 'line' ? [line || '\u00a0'] : split === 'word' ? words(line) : graphemes(line);
        pieces.forEach(value => addUnit(row, value, split === 'line'));
      });
    } else {
      for(let elementIndex=0;elementIndex<(recipe==='alternate-in'?3:1);elementIndex++){
      const outer = node('div', 'me-unit', specimen), core = node('div', 'me-core me-element', outer);
      const validImage = shape === 'image' && /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.test(options.imageData || '');
      if (validImage) { const img = node('img', '', core); img.alt = ''; img.src = options.imageData; }
      else {
        global.PangBrandCard.populate(core, options.previewCard);
      }
      const sheen = node('span', 'me-sheen', core);
      units.push({ outer, core, sheen, value: '' });
      }
      if(recipe==='alternate-in'){specimen.style.gap='12px';scene.style.setProperty('--me-size','clamp(36px,23cqw,100px)');}
      for (let j = 0; j < 3; j++) rings.push(node('span', 'me-ring', specimen));
      if (recipe === 'anvil') {
        scene.dataset.impactProgress = String(metrics.hitProgress);
        scene.dataset.motionReference = 'keynote-html-anvil';
        if (options.dust !== false) {
          dustCanvas = node('canvas', 'me-impact-dust', scene);
          if (!global.MotionImpact) throw new Error('冲击尘浪资源未载入');
          dustRenderer = global.MotionImpact.create(dustCanvas);
        }
      }
    }
    const n = units.length;
    const noStagger = isLoop || ['text-tracking', 'text-highlight', 'text-collapse', 'text-keyword'].includes(recipe);
    const step = noStagger ? 0 : gap;
    const duration = base + Math.max(0, n - 1) * step;
    const keywordIndices = units.map((u, i) => /\S/u.test(u.value) ? i : -1).filter(i => i >= 0);
    const keywordStart = keywordIndices[Math.floor(keywordIndices.length * .36)] ?? 0;
    const keywordEnd = keywordIndices[Math.max(0, Math.ceil(keywordIndices.length * .7) - 1)] ?? n - 1;
    // Fit long user text to its stage without changing glyphs or trimming newlines.
    // ResizeObserver only refreshes layout when the host changes; it owns no clock.
    function fitText() {
      if (!isText || dead || !scene.clientWidth || !scene.clientHeight || typeof global.getComputedStyle !== 'function') return;
      const previous = units.map(unit => unit.outer.style.transform);
      units.forEach(unit => unit.outer.style.transform = 'none');
      specimen.style.fontSize = '';
      const stageStyle = global.getComputedStyle(scene);
      const width = Math.max(1, scene.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight));
      const height = Math.max(1, scene.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom));
      let font = parseFloat(global.getComputedStyle(specimen).fontSize);
      for (let attempt = 0; attempt < 3; attempt++) {
        const ratio = Math.min(1, width / Math.max(1, specimen.scrollWidth), height / Math.max(1, specimen.scrollHeight));
        if (ratio >= .999) break;
        font = Math.max(.5, font * ratio * .98);
        specimen.style.fontSize = `${font.toFixed(3)}px`;
      }
      units.forEach((unit, i) => unit.outer.style.transform = previous[i]);
    }
    function measure() {
      if (dead) return;
      if (metrics.width === scene.clientWidth && metrics.height === scene.clientHeight) return;
      metrics.width = scene.clientWidth; metrics.height = scene.clientHeight;
      fitText();
      if (recipe !== 'anvil') return;
      metrics.width = scene.clientWidth; metrics.height = scene.clientHeight;
      metrics.size = units[0].core.offsetHeight || 248;
      metrics.objectWidth = units[0].core.offsetWidth || metrics.size;
      metrics.dropDistance = metrics.height / 2 + metrics.size / 2;
      if (dustRenderer) dustRenderer.resize(metrics.width, metrics.height, Math.min(1.5, global.devicePixelRatio || 1));
      // Resizing clears the bitmap; restore the paused frame using the same clock.
      render(lastTime);
    }
    measure();
    if ((isText || recipe === 'anvil') && typeof global.ResizeObserver === 'function') { resizeObserver = new global.ResizeObserver(measure); resizeObserver.observe(scene); }
    // render() resets every animated property, so forward/backward seeking is exact.
    function render(seconds) {
      if (dead) return;
      const time = clamp(finite(seconds, 0), 0, duration), globalP = duration ? time / duration : 0;
      lastTime = time;
      let cursorIndex = -1;
      if (recipe === 'typewriter') cursorIndex = clamp(Math.ceil(globalP * n) - 1, 0, n - 1);
      if (recipe === 'text-delete') cursorIndex = clamp(n - 1 - Math.floor(globalP * n), 0, n - 1);
      const typingCount = recipe === 'text-type-loop' ? globalP < .1 ? 0 : globalP < .45 ? Math.ceil((globalP - .1) / .35 * n) : globalP < .64 ? n : globalP < .92 ? Math.ceil((.92 - globalP) / .28 * n) : 0 : 0;
      units.forEach((unit, i) => {
        let index = recipe === 'text-delete' ? n - 1 - i : i;
        let p = isLoop ? globalP : clamp((time - index * step) / base);
        // Zero stagger still means sequential typewriter / backspace, distributed over base.
        if (step === 0 && ['typewriter', 'text-delete'].includes(recipe)) p = clamp(time / base * n - index);
        const targeted = recipe !== 'text-keyword' || (i >= keywordStart && i <= keywordEnd);
        const s = targeted ? compute(recipe, p, i, n, intensity, direction, metrics, directionAngle) : pose();
        if (recipe === 'typewriter') s.opacity = i < Math.ceil(globalP * n) ? 1 : 0;
        if (recipe === 'text-delete') s.opacity = i < n - Math.floor(globalP * n) ? 1 : 0;
        if (recipe === 'text-type-loop') s.opacity = i < typingCount ? 1 : 0;
        unit.outer.style.transform = `translate3d(${s.x.toFixed(4)}px,${s.y.toFixed(4)}px,0) rotateX(${s.rx.toFixed(4)}deg) rotateY(${s.ry.toFixed(4)}deg) rotate(${s.rz.toFixed(4)}deg) skewX(${s.skew.toFixed(4)}deg) scale(${s.sx.toFixed(5)},${s.sy.toFixed(5)})`;
        unit.outer.style.opacity = String(clamp(s.opacity));
        unit.outer.style.transformOrigin = recipe === 'pendulum' ? '50% -30%' : recipe === 'anvil' || recipe === 'bounce-in' ? '50% 100%' : '50% 50%';
        unit.outer.style.clipPath = s.clip;
        if (s.blur || s.light !== 1) unit.core.style.filter = `blur(${Math.max(0, s.blur).toFixed(3)}px) brightness(${s.light.toFixed(3)})`;
        else if (unit.core.style.filter) unit.core.style.filter = '';
        if (unit.mark) { unit.mark.style.opacity = s.mark > 0 ? '.22' : '0'; unit.mark.style.transform = `scaleX(${s.mark})`; }
        if (unit.rule) { unit.rule.style.opacity = s.rule > 0 ? '1' : '0'; unit.rule.style.transform = `scaleX(${s.rule})`; }
        if (unit.sheen) { unit.sheen.style.transform = `translateX(${(-65 + p * 130).toFixed(3)}%)`; unit.sheen.style.opacity = String(s.glow); }
        if (unit.cursor) {
          const currentCursor = recipe === 'text-type-loop' ? Math.max(0, typingCount - 1) : cursorIndex;
          const blink = Math.floor(time * 3) % 2 === 0;
          unit.cursor.style.opacity = ['typewriter', 'text-delete', 'text-type-loop'].includes(recipe) && i === currentCursor && blink ? '1' : '0';
        }
      });
      rings.forEach((ring, i) => {
        const p = (globalP + i / rings.length) % 1;
        ring.style.opacity = recipe === 'ripple' ? String(Math.pow(Math.sin(Math.PI * p), 2) * .5) : '0';
        ring.style.transform = `${shape === 'diamond' ? 'rotate(45deg) ' : ''}scale(${(1 + p * 1.2 * intensity).toFixed(5)})`;
      });
      if (recipe === 'anvil') {
        const hit = metrics.hitProgress;
        const impact = clamp((globalP - hit) / (1 - hit));
        const active = globalP >= hit && globalP < 1;
        scene.style.transform = 'none';
        if (dustRenderer) dustRenderer.render(active ? impact : 1, intensity, metrics.objectWidth, metrics.size, base);
      }
    }
    render(0);
    function update(next = {}) {
      if (Object.prototype.hasOwnProperty.call(next, 'intensity')) intensity = clamp(finite(next.intensity, intensity), .1, 3);
      if (Object.prototype.hasOwnProperty.call(next, 'direction') && (Object.prototype.hasOwnProperty.call(directionAngles, next.direction) || next.direction === 'custom')) direction = next.direction;
      if (Object.prototype.hasOwnProperty.call(next, 'directionAngle')) directionAngle = finite(next.directionAngle, directionAngle);
      render(lastTime);
    }
    return { render, update, duration, unitCount: n, destroy() { if (!dead) { dead = true; if (resizeObserver) resizeObserver.disconnect(); if (dustRenderer) dustRenderer.destroy(); scene.remove(); } } };
  }
  global.MotionEngine = Object.freeze({ create, sample: compute, recipes: Object.freeze(Array.from(RECIPES)) });
})(globalThis);
