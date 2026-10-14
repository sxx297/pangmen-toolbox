/* Original cloud-sprite implementation informed by observed Keynote HTML-export
 * behavior. Apple renderer code and texture pixels are NOT included.
 * API: create(canvas,{light?,smokeTexture?,speckTexture?}) -> resize(w,h,dpr),
 * render(J,intensity,W,H,T=1.8), destroy(). Texture overrides accept decoded image/canvas
 * objects for isolated local reference comparisons; no assets are fetched or retained.
 * J describes the interval after contact. Contact J=0 is exactly transparent;
 * subsequent frames expand the cloud immediately. T is the FULL effect duration.
 */
(function (global) {
  'use strict';
  const PI = Math.PI, TAU = PI * 2, resources = new Map();
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
  function random(i, salt) {
    let h = Math.imul(i + 211, 374761393) + Math.imul(salt + 127, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967295;
  }
  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), a = smooth(x - ix), b = smooth(y - iy);
    const h = (xx, yy) => random(xx * 271 + yy * 917, seed);
    return (h(ix, iy) * (1 - a) + h(ix + 1, iy) * a) * (1 - b) + (h(ix, iy + 1) * (1 - a) + h(ix + 1, iy + 1) * a) * b;
  }
  function fbm(x, y, seed) {
    return .5 * noise(x, y, seed) + .27 * noise(x * 2.03, y * 2.11, seed + 13) + .15 * noise(x * 4.17, y * 4.03, seed + 29) + .08 * noise(x * 8.23, y * 8.41, seed + 43);
  }
  function createSmokeSprite(light) {
    const size = 256, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'), bitmap = ctx.createImageData(size, size), field = new Float32Array(size * size);
    let peak = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = (x - 126) / 116, py = (y - 135) / 117;
      const coarse = fbm(px * 2.45 + 5, py * 2.6 + 9, 47);
      const fine = fbm(px * 13.7 + 17, py * 14.1 + 3, 83);
      const warpX = px + (coarse - .5) * .34;
      const warpY = py + (fbm(px * 3.2 + 1, py * 2.8 + 14, 107) - .5) * .28;
      const radius = Math.sqrt(warpX * warpX + warpY * warpY);
      // Irregular, overlapping cloud lobes with a fine airy interior, never a hard disk.
      const lobes = .42 + .58 * coarse;
      const envelope = Math.exp(-2.45 * radius * radius) * (1 - smooth((radius - .77) / .42));
      const granular = .72 + .52 * fine;
      const mass = envelope * lobes * granular;
      field[y * size + x] = mass; peak = Math.max(peak, mass);
    }
    // Match only measured aggregate transparency (white RGB, max 124, mean ~32/255).
    // The noise, shape, pixel positions and specks are wholly generated here.
    // A histogram keeps density calibration cheap on the first preview (~18k powers
    // instead of >1 million); both colors and every later instance reuse the sprite.
    const histogram = new Uint32Array(1025);
    for (const value of field) histogram[Math.round(value / peak * 1024)]++;
    let lo = .3, hi = 2.8;
    const meanTarget = 32.277 / 124;
    for (let pass = 0; pass < 18; pass++) {
      const gamma = (lo + hi) / 2; let mean = 0;
      for (let bin = 1; bin < histogram.length; bin++) if (histogram[bin]) mean += histogram[bin] * Math.pow(bin / 1024, gamma);
      mean /= field.length;
      if (mean > meanTarget) lo = gamma; else hi = gamma;
    }
    const gamma = (lo + hi) / 2, tint = light ? 110 : 255;
    for (let i = 0; i < field.length; i++) {
      bitmap.data[i * 4] = bitmap.data[i * 4 + 1] = bitmap.data[i * 4 + 2] = tint;
      bitmap.data[i * 4 + 3] = Math.round(124 * Math.pow(field[i] / peak, gamma));
    }
    ctx.putImageData(bitmap, 0, 0);
    return canvas;
  }
  function createSpeckSprite(light) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = light ? '#6e6e6e' : '#fff';
    for (let i = 0; i < 7; i++) {
      const x = 15 + random(i, 301) * 226, y = 12 + random(i, 302) * 228;
      const r = .65 + random(i, 303) ** 2 * 2.7;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (.7 + random(i, 304) * .4), random(i, 305) * PI, 0, TAU); ctx.fill();
    }
    return canvas;
  }
  function getResources(light) {
    const key = light ? 'light' : 'white';
    if (!resources.has(key)) resources.set(key, { smoke: createSmokeSprite(light), speck: createSpeckSprite(light) });
    return resources.get(key);
  }
  const cloudSeeds = Array.from({ length: 300 }, (_, i) => ({
    u: i / 300 * 2 - 1, position: i / 300,
    horizontal: .25 + random(i, 11) * .75,
    vertical: -1 + random(i, 17) * 1.1,
    rotation: .5 + random(i, 23) * .5,
    size: 1 + 1.5 * random(i, 29) ** 3,
    lifetime: .15 + random(i, 31) * .85
  }));
  const speckSeeds = Array.from({ length: 40 }, (_, i) => ({
    u: i / 40 * 2 - 1, position: i / 40, flat: i % 3 !== 1,
    vertical: .2 + random(i, 61) * .8,
    sign: random(i, 67) < .5 ? -1 : 1,
    size: 3 + random(i, 71) * 2,
    lifetime: .2 + random(i, 73) * .3
  }));
  function fastSine(angle) {
    const x = ((angle + PI) % TAU + TAU) % TAU - PI;
    return 4 / PI * x - 4 / (PI * PI) * x * Math.abs(x);
  }
  function create(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('MotionImpact.create requires a canvas.');
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!ctx) throw new Error('A 2D canvas is required for the cloud preview.');
    const defaults = options.smokeTexture && options.speckTexture ? null : getResources(options.light === true);
    const sprites = { smoke: options.smokeTexture || defaults.smoke, speck: options.speckTexture || defaults.speck };
    let width = 1, height = 1, dpr = 1, dead = false, lastArgs = null;
    function resize(w, h, density = 1) {
      if (dead) return;
      width = clamp(finite(w, 1), 1, 8192); height = clamp(finite(h, 1), 1, 8192); dpr = clamp(finite(density, 1), .5, 3);
      canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      canvas.dataset.impactSize = `${width}x${height}`;
      if (lastArgs) render(...lastArgs);
    }
    function sprite(image, x, y, w, h, angle, opacity) {
      if (opacity <= 0 || w <= 0 || h <= 0) return;
      const c = Math.cos(angle), s = Math.sin(angle);
      ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, x * dpr, y * dpr);
      ctx.globalAlpha = clamp(opacity);
      ctx.drawImage(image, -w / 2, -h / 2, w, h);
    }
    function render(progress, intensity = 1, objectWidth = 248, objectHeight = 248, totalDuration = 1.8) {
      if (dead) return;
      lastArgs = [progress, intensity, objectWidth, objectHeight, totalDuration];
      const J = clamp(finite(progress, 1)), strength = clamp(finite(intensity, 1), .1, 3);
      const W = clamp(finite(objectWidth, 248), 1, width * 1.5), H = clamp(finite(objectHeight, 248), 1, height * 1.5);
      const T = clamp(finite(totalDuration, 1.8), .15, 12);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.impactProgress = J.toFixed(4); canvas.dataset.impactClouds = '300'; canvas.dataset.impactSpecks = '40';
      canvas.dataset.impactLayers = J > 0 && J < 1 ? 'cloud-billboards,specks' : 'clear';
      canvas.dataset.impactDraws = '0';
      if (J <= 0 || J >= 1) return;
      const scale = (1.25 - .5 * W / width) * W / 7;
      const left = (width - W) / 2, ground = (height + H) / 2;
      // The original 16px particle-centre correction cancels the baseline offset.
      // A small late upward drift belongs to the entire smoke system, not the object.
      const lift = (ground + 16) * .02 * J * J;
      let draws = 0;
      for (const seed of cloudSeeds) {
        const life = T * seed.lifetime;
        const age = Math.sqrt(clamp(J / life));
        const alpha = (1 - J * J) * (1 - age) * Math.min(1, age * 20);
        if (alpha <= 0) continue;
        const radial = Math.sign(seed.u) * Math.sqrt(Math.abs(seed.u));
        const vx = 5.6 * scale * radial * seed.horizontal;
        const vy = -5 * scale * (Math.abs(radial) + .25) * seed.vertical;
        const extent = (Math.abs(seed.u) + 1.25) * seed.size * scale;
        const size = extent * (.1 + .9 * age);
        const x = left + seed.position * W + vx * Math.sqrt(age) * strength;
        const y = ground - lift - vy * age * age * strength;
        sprite(sprites.smoke, x, y, size, size, -seed.u * seed.rotation * PI * T * age, alpha);
        draws++;
      }
      if (J < .5) {
        for (const seed of speckSeeds) {
          const life = Math.min(1, T) * seed.lifetime * (seed.flat ? 10 : 1);
          const age = clamp(J / life);
          const alpha = Math.max(0, Math.cos(PI * J)) * (1 - age) * Math.min(1, age * 20);
          if (alpha <= 0) continue;
          const vx = seed.u * (seed.flat ? 10 : 1) * 5.25 * scale;
          const vy = seed.vertical * (seed.flat ? .25 * seed.sign : 1) * 4 * scale;
          const size = seed.size * (seed.flat ? 3 : 1) * scale * (.1 + .9 * age);
          const x = left + seed.position * W + vx * age * strength;
          const y = ground - vy * fastSine(PI * .85 * age) * strength;
          sprite(sprites.speck, x, y, size, size * (seed.flat ? .2 : 1), 0, alpha);
          draws++;
        }
      }
      canvas.dataset.impactDraws = String(draws);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
    }
    resize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1, 1);
    return { resize, render, destroy() { if (!dead) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); dead = true; lastArgs = null; } } };
  }
  global.MotionImpact = Object.freeze({ create });
})(globalThis);
