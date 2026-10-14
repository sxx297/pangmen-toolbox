(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const library = globalThis.MotionCatalog;
  const engine = globalThis.MotionEngine;
  if (!library || !engine) {
    $('error-banner').hidden = false;
    $('error-banner').textContent = '预览资源未完整载入。请运行 build-preview.py 后打开生成的 index.html。';
    return;
  }
  const effects = library.effects;
  const byId = new Map(effects.map(effect => [effect.id, effect]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const numberDefaults = { numberMinDigits:1, numberSign:'', numberStart: 0, numberEnd: 12860, numberDecimals: 0, numberPrefix: '', numberSuffix: '', numberGrouping: true, numberStyle: 'count' };
  const defaults = { text: '让想法，跃然眼前', shape: 'card', imageData: null, color: '#ff5500', duration: 1.4, stagger: 0.06, intensity: 1, direction: 'up', directionAngle: 0, split: 'char', dust: true, curvature:.5,markColor:'#ffe066', ...numberDefaults };
  const directionPresets = Object.freeze({
    up: { angle: 0, label: '向上' }, 'up-right': { angle: 45, label: '向右上' }, right: { angle: 90, label: '向右' },
    'down-right': { angle: 135, label: '向右下' }, down: { angle: 180, label: '向下' }, 'down-left': { angle: 225, label: '向左下' },
    left: { angle: 270, label: '向左' }, 'up-left': { angle: 315, label: '向左上' }
  });
  const vectorDirections = new Set(['float-in', 'brake-in', 'slide-out', 'launch-out', 'text-float', 'roll-in', 'roll-out','arc-in','arc-out']);
  const edgeDirections = new Set(['wipe-in', 'wipe-out', 'text-lines-in', 'text-lines-out']);
  const axisDirections = new Set(['flip-in', 'fold-in', 'fold-out', 'flip-once']);
  const cornerDirections = new Set(['pivot-in', 'pivot-out']);
  const rotationDirections = new Set(['spin','orbit']);
  const state = { mode: 'element', category: 'entrance', effectId: 'anvil', options: { ...defaults }, background: 'dark', autoplay: !reduceMotion.matches, hover: !reduceMotion.matches, time: 0, playing: false };
  const thumbnailText = '让想法，\n跃然眼前';
  const drafts = new Map();
  let controller = null;
  let raf = 0;
  let lastFrame = null;
  let hoverFrame = 0;
  let hoverController = null;
  let hoverHost = null;
  const numericThumbnails = [];
  const operationToast=globalThis.PangToast.create($('toast'));
  let imageVersion = 0;
  let paramFrame = 0;
  let liveParamFrame = 0;
  let lastTransport = 0;
  const effect = () => byId.get(state.effectId);
  const normalizeAngle = value => ((Math.round(Number(value) || 0) % 360) + 360) % 360;
  function directionProfile(selected = effect()) {
    const id = selected.recipe || selected.id;
    return vectorDirections.has(id) ? 'vector' : edgeDirections.has(id) ? 'edge' : axisDirections.has(id) ? 'axis' : cornerDirections.has(id) ? 'corner' : rotationDirections.has(id) ? 'rotation' : 'none';
  }
  function normalizeDirection(profile) {
    const choices = profile === 'vector' ? [...Object.keys(directionPresets), 'custom'] : profile === 'edge' ? ['up','right','down','left'] : profile === 'axis' ? ['up', 'left'] : profile === 'corner' ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : profile === 'rotation' ? ['left', 'right'] : [];
    if (!choices.includes(state.options.direction)) state.options.direction = profile === 'corner' ? 'bottom-left' : profile === 'rotation' ? 'right' : 'up';
    if (directionPresets[state.options.direction]) state.options.directionAngle = directionPresets[state.options.direction].angle;
    else state.options.directionAngle = normalizeAngle(state.options.directionAngle);
  }
  const duration = () => Math.max(0.01, controller ? controller.duration : state.options.duration);
  const graphemes = text => {
    if (typeof Intl.Segmenter === 'function') return Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text), part => part.segment);
    return Array.from(text);
  };
  const trimText = text => graphemes(String(text).replace(/\r\n?/g, '\n')).slice(0, 100).join('');
  function toast(message) {
    operationToast.show(message);
  }
  function rangeProgress(input) {
    const progress = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
    input.style.setProperty('--progress', clamp(progress, 0, 100) + '%');
  }
  function syncTimeline() {
    const total = duration();
    const timeline = $('timeline');
    timeline.value = Math.round(state.time / total * 1000);
    rangeProgress(timeline);
  }
  function syncTransport() {
    const total = duration();
    $('play-toggle').textContent = state.playing ? '暂停' : '播放';
    $('play-toggle').setAttribute('aria-label', state.playing ? '暂停预览' : '播放预览');
    $('current-time').textContent = state.time.toFixed(2);
    $('total-time').textContent = total.toFixed(2) + ' s';
    $('timeline-mid').textContent = (total / 2).toFixed(2) + ' s';
    syncTimeline();
    $('stage-state').textContent = state.playing ? (effect().category === 'loop' ? '循环播放中' : '播放中') : state.time >= total ? '播放完成' : state.time > 0 ? '已暂停' : '就绪';
  }
  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = null;
    state.playing = false;
    syncTransport();
  }
  function render(forceTransport = true) {
    if (controller) controller.render(state.time);
    const now = performance.now();
    if (forceTransport || now - lastTransport >= 80) { syncTransport(); lastTransport = now; }
    else syncTimeline();
  }
  function tick(now) {
    if (!state.playing) return;
    const elapsed = lastFrame === null ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;
    state.time += elapsed;
    const total = duration();
    if (state.time >= total) {
      if (effect().category === 'loop') state.time %= total;
      else { state.time = total; render(); pause(); return; }
    }
    render(false);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (globalThis.PangSurface && !PangSurface.wantsStage()) return;
    if (!controller || state.playing) return;
    if (state.time >= duration() - .001) state.time = 0;
    state.playing = true;
    lastFrame = null;
    syncTransport();
    raf = requestAnimationFrame(tick);
  }
  function seek(seconds) {
    pause();
    const next = Number(seconds);
    state.time = clamp(Number.isFinite(next) ? next : 0, 0, duration());
    render();
  }
  function rebuild(shouldPlay = state.autoplay) {
    Object.assign(state.options, {shape:'card', imageData:null, color:'#ff5500', text:['text-lines-in','text-lines-out'].includes(state.effectId)?'让想法，跃然眼前\n让表达，更有力量':defaults.text});
    pause();
    if (controller) controller.destroy();
    controller = null;
    state.time = 0;
    try {
      controller = engine.create($('motion-stage'), { effect: effect(), ...state.options });
      if (!Number.isFinite(controller.duration) || controller.duration <= 0) throw new Error('动画时长无效');
      $('error-banner').hidden = true;
      render();
      if (shouldPlay && document.visibilityState !== 'hidden') play();
    } catch (error) {
      $('error-banner').textContent = '这个样式暂时无法预览：' + error.message;
      $('error-banner').hidden = false;
      console.error(error);
    }
  }
  const noIntensity = new Set(['fade-in', 'zoom-in', 'flip-in', 'wipe-in', 'fold-in', 'shine', 'spin', 'fade-out', 'shrink-out', 'wipe-out', 'fold-out', 'typewriter', 'text-flip', 'text-highlight', 'text-underline', 'text-shine', 'text-type-loop', 'text-delete', 'text-fade-out', 'text-flip-out']);
  function syncDirectionControls() {
    const profile = directionProfile();
    normalizeDirection(profile);
    $('direction-field').hidden = profile === 'none';
    const controls = { vector: 'direction-pad', edge: 'direction-pad', axis: 'direction-axis', corner: 'direction-corners', rotation: 'direction-rotation' };
    all('.direction-control').forEach(control => control.hidden = control.id !== controls[profile]);
    const customButton = document.querySelector('[data-direction-choice="custom"]');
    if (customButton) customButton.hidden = profile !== 'vector';
    all('#direction-pad [data-direction-choice]').forEach(button => {
      const choice=button.dataset.directionChoice;
      button.hidden=choice==='custom' ? profile!=='vector' : profile==='edge' && !['up','right','down','left'].includes(choice);
    });
    all('[data-direction-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.directionChoice === state.options.direction)));
    const angle = normalizeAngle(state.options.directionAngle);
    $('direction-angle-number').value = angle;
    const customAngle = profile === 'vector' && state.options.direction === 'custom';
    $('direction-angle-value').hidden = !customAngle;
    $('direction-value').hidden = customAngle;
    $('direction-dial').style.setProperty('--direction-angle', angle + 'deg');
    $('direction-dial').setAttribute('aria-valuenow', String(angle));
    $('direction-dial').setAttribute('aria-valuetext', angle + '°');
    $('direction-label').textContent = profile === 'axis' ? '翻转轴向' : profile === 'corner' ? '旋转支点' : profile === 'rotation' ? '旋转方向' : profile === 'edge' ? '揭示方向' : '运动方向';
    const labels = { up: '上下翻转', left: '左右翻转', 'top-left': '左上支点', 'top-right': '右上支点', 'bottom-left': '左下支点', 'bottom-right': '右下支点', right: '顺时针' };
    $('direction-value').textContent = profile === 'vector' || profile === 'edge' ? (state.options.direction === 'custom' ? `自由 · ${angle}°` : `${directionPresets[state.options.direction].label} · ${angle}°`) : profile === 'rotation' && state.options.direction === 'left' ? '逆时针' : labels[state.options.direction] || '';
  }
  function syncParameterNumber(key, force=false) {
    const input=$(key+'-value');
    if(force || document.activeElement!==input) input.value=['intensity','curvature'].includes(key)?Math.round(state.options[key]*100):state.options[key].toFixed(2);
  }
  function syncControls() {
    const selected = effect();
    const options = state.options;
    if (selected.mode === 'text' && !['number-roll','number-count','text-lines-in','text-lines-out','text-breathe','text-tracking','text-flip','text-scatter','text-highlight'].includes(selected.id)) options.stagger = Math.min(.2, options.duration * .1);
    const numeric = selected.id === 'number-roll' || selected.id === 'number-count';
    if (numeric) { options.stagger = 0; options.numberStyle = selected.id === 'number-count' ? 'count' : 'roll'; }
    const composite = ['line-draw-in', 'line-draw-out', 'grid-in', 'grid-out', 'flow-dots'].includes(selected.recipe);
    const wholeText = ['text-read', 'text-cycle'].includes(selected.recipe);
    const grid = ['grid-in', 'grid-out','alternate-in'].includes(selected.recipe);
    for (const key of ['duration', 'stagger', 'intensity']) { $(key).value = options[key]; rangeProgress($(key)); }
    syncParameterNumber('duration');
    syncParameterNumber('stagger');
    syncParameterNumber('intensity');
    $('intensity').disabled = noIntensity.has(selected.recipe);
    $('intensity-value').disabled = $('intensity').disabled;
    $('intensity').closest('label').hidden = noIntensity.has(selected.recipe) || numeric || wholeText || ['text-lines-in','text-lines-out','line-draw-in', 'line-draw-out', 'color-sweep'].includes(selected.recipe);
    syncDirectionControls();
    $('curvature-field').hidden=!['arc-in','arc-out'].includes(selected.id);
    $('curvature').value=options.curvature; $('curvature-value').value=Math.round(options.curvature*100);
    $('mark-color-field').hidden=selected.id!=='text-highlight';$('mark-color').value=options.markColor;
    $('dust').checked = options.dust;
    $('dust-field').hidden = selected.recipe !== 'anvil';
    const forcedSplit = ['text-tracking','text-flip','text-scatter','typewriter', 'text-delete', 'text-type-loop'].includes(selected.recipe) ? 'char' : ['text-lines-in', 'text-lines-out','text-highlight'].includes(selected.recipe) ? 'line' : null;
    $('split-select').value = forcedSplit || options.split;
    $('split-select').disabled = Boolean(forcedSplit);
    all('.text-only').forEach(element => { element.hidden = state.mode !== 'text' || numeric; });
    all('.element-only').forEach(element => { element.hidden = state.mode !== 'element' || composite; });
    $('split-select').closest('label').hidden = wholeText || state.mode !== 'text' || numeric || Boolean(forcedSplit) || selected.recipe === 'text-breathe';
    $('stagger').closest('label').hidden = !grid && !['text-lines-in','text-lines-out','text-flip','text-scatter'].includes(selected.id);
    $('effect-help').textContent = selected.category === 'loop' ? '循环类连续播放，点击暂停即可停住。' : state.mode === 'text' ? '时长作用于单个单位；总时长包含错峰间隔。' : '调节后自动重播，随时可暂停检查。';
    if (selected.recipe === 'text-keyword') $('effect-help').textContent = '预览突出句子中间的一组文字；可切换分组查看变化。';
    if (numeric) $('effect-help').textContent = '自动读取选中数字，从 0 变化到原数值；修改数字后再次应用即可。';
    if (grid) $('effect-help').textContent = '从中心依次播放九个对象；间隔控制错峰，总时长包含全部延迟。';
    if (selected.recipe === 'text-read') $('effect-help').textContent = '按词组依次高亮；动画时长控制整段阅读。';
    if (selected.recipe === 'text-cycle') $('effect-help').textContent = '用换行、逗号或顿号分隔关键词；时长控制一整轮切换。';
    if ($('effect-name').textContent !== selected.name) $('effect-name').textContent = selected.name;
    $('effect-description').textContent = selected.description;
    $('effect-meta').textContent = `${state.mode === 'element' ? 'ELEMENT' : 'TEXT'} / ${state.category.toUpperCase()}`;
    document.dispatchEvent(new Event('pang:controls'));
  }
  function stopHover() {
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    if (hoverController) hoverController.destroy();
    hoverController = null;
    if (hoverHost) {
      hoverHost.querySelector('.tile-glyph').hidden = false;
      const overlay = hoverHost.querySelector('.tile-animation');
      if (overlay) overlay.remove();
    }
    hoverHost = null;
  }
  function startHover(host, selected) {
    if (hoverHost === host && hoverController) return;
    if (!state.hover || reduceMotion.matches) return;
    stopHover();
    if (selected.id === state.effectId && !state.playing && state.autoplay && state.time >= duration() - .001 && (!globalThis.PangSurface || PangSurface.wantsStage())) play();
    host.querySelector('.tile-glyph').hidden = true;
    const overlay = document.createElement('div');
    overlay.className = 'tile-animation';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:3;container-type:inline-size;--stage-ink:#302b27';
    host.appendChild(overlay);
    hoverHost = host;
    try {
      hoverController = engine.create(overlay, { ...defaults, effect: selected, duration: selected.duration || 1.2, stagger: .08, color: '#ff5500', text: thumbnailText, dust: false, numberEnd: 123,
        previewCard: host.querySelector('.pang-mini-card') });
      let start = null;
      function frame(now) {
        if (!hoverController) return;
        if (start === null) start = now;
        const full = hoverController.duration + .45;
        hoverController.render(Math.min(hoverController.duration, ((now - start) / 1000) % full));
        hoverFrame = requestAnimationFrame(frame);
      }
      hoverFrame = requestAnimationFrame(frame);
    } catch (error) { stopHover(); }
  }
  function renderLibrary() {
    stopHover();
    numericThumbnails.splice(0).forEach(thumbnail => thumbnail.destroy());
    const search = $('effect-search').value.trim().toLowerCase();
    const subset = effects.filter(item => item.mode === state.mode && item.category === state.category);
    const visible = subset.filter(item => (!search || [item.name, item.description, ...(item.tags || [])].join(' ').toLowerCase().includes(search)));
    const grid = $('effect-grid');
    grid.replaceChildren();
    for (const selected of visible) {
      const button = document.createElement('button');
      button.className = 'effect-tile';
      button.dataset.effect = selected.id;
      button.type = 'button';
      button.setAttribute('aria-pressed', String(selected.id === state.effectId));
      button.setAttribute('aria-label', selected.name + '：' + selected.description); button.dataset.tooltip = selected.description;
      const visual = document.createElement('span'); visual.className = 'tile-visual'; visual.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span'); glyph.className = 'tile-glyph' + (state.mode === 'text' ? ' is-text' : '');
      if (state.mode === 'text') {
        const numeric = selected.id === 'number-roll' || selected.id === 'number-count';
        glyph.textContent = numeric ? '123' : thumbnailText;
        if (numeric) glyph.classList.add('is-numeric');
        if (!numeric) visual.classList.add('text-thumbnail');
      } else {
        glyph.classList.add('pang-mini-card');
        globalThis.PangBrandCard.populate(glyph);
      }
      visual.appendChild(glyph);
      button.appendChild(visual);
      if (selected.featured) { const badge = document.createElement('span'); badge.className = 'tile-featured'; badge.textContent = '精选'; button.appendChild(badge); }
      const name = document.createElement('span'); name.className = 'tile-name'; name.textContent = selected.name; button.appendChild(name);
      button.addEventListener('click', () => { selectEffect(selected.id); globalThis.PangPlugin?.apply(selected.id); });
      button.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') startHover(visual, selected); });
      button.addEventListener('pointerleave', stopHover);
      button.addEventListener('focus', () => startHover(visual, selected));
      button.addEventListener('blur', stopHover);
      grid.appendChild(button);
      if (glyph.classList.contains('is-numeric')) {
        glyph.replaceChildren();
        const thumbnail = engine.create(glyph, { ...defaults, effect: selected, color: '#ff5500', numberEnd: 123 });
        thumbnail.render(thumbnail.duration);
        numericThumbnails.push(thumbnail);
      }
    }
    $('empty-state').hidden = visible.length !== 0;
    $('library-count').textContent = visible.length + ' 款';
    $('total-count').textContent = `共 ${effects.length} 款 · ${effects.filter(item => item.featured).length} 款精选`;
    all('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
    document.querySelector('.mode-tabs').dataset.selected = state.mode;
    all('[data-category]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.category === state.category));
      button.querySelector('.category-count').textContent = effects.filter(item => item.mode === state.mode && item.category === button.dataset.category).length;
    });
    const category = library.categories.find(item => item.id === state.category);
    $('category-description').textContent = category ? category.description : '';
    renderQuick();
  }
  function renderQuick() {
    $('quick-effects').replaceChildren();
    const picks = state.mode === 'element' ? ['anvil', 'pivot-in', 'line-draw-in', 'flip-once', 'jack-in', 'roll-in', 'color-sweep', 'grid-in', 'flow-dots'] : ['number-roll', 'text-read', 'text-cycle'];
    for (const id of picks) {
      if (!byId.has(id)) continue;
      const button = document.createElement('button');
      button.textContent = byId.get(id).name;
      button.addEventListener('click', () => { $('effect-search').value = ''; selectEffect(id); });
      $('quick-effects').appendChild(button);
    }
  }
  function selectEffect(id, options = {}) {
    const selected = byId.get(id);
    if (!selected) throw new Error('未找到此动画');
    operationToast.clear();
    if (controller) drafts.set(state.effectId, { duration: state.options.duration, stagger: state.options.stagger, intensity: state.options.intensity, direction: state.options.direction, directionAngle: state.options.directionAngle, split: state.options.split, dust: state.options.dust,curvature:state.options.curvature,markColor:state.options.markColor, ...Object.fromEntries(Object.keys(numberDefaults).map(key => [key, state.options[key]])) });
    const categoryChanged = state.mode !== selected.mode || state.category !== selected.category;
    state.mode = selected.mode;
    state.category = selected.category;
    state.effectId = id;
    Object.assign(state.options, { duration: selected.duration || 1.2, stagger: selected.stagger === undefined ? .06 : selected.stagger, intensity: selected.intensity || 1, direction: 'up', directionAngle: 0, dust: true, split: 'char',curvature:.5,markColor:'#ffe066' }, drafts.get(id) || {});
    const sampleTexts = { 'text-read': '让想法，清晰表达；让重点，自然出现', 'text-cycle': '清晰，生动，有力量' };
    if (sampleTexts[id] && [defaults.text, ...Object.values(sampleTexts)].includes(state.options.text)) state.options.text = sampleTexts[id];
    if (options.params) Object.assign(state.options, options.params);
    if (categoryChanged) $('effect-search').value = '';
    renderLibrary();
    syncControls();
    globalThis.PangSurface?.sync();
    rebuild(options.play === undefined ? state.autoplay : options.play);
    document.dispatchEvent(new CustomEvent('pang:effectchange', { detail: { id } }));
  }
  function changeGroup(mode, category) {
    const match = effects.find(item => item.mode === mode && item.category === category && item.featured) || effects.find(item => item.mode === mode && item.category === category);
    if (match) selectEffect(match.id);
  }
  function updateParameter(key, value) {
    state.options[key] = value;
    document.dispatchEvent(new CustomEvent('pang:parameterchange', { detail: { key } }));
    if ((key === 'intensity' || key === 'direction' || key === 'directionAngle') && controller && typeof controller.update === 'function') {
      if (key === 'intensity') { syncParameterNumber('intensity'); rangeProgress($('intensity')); }
      else {
        if (key === 'directionAngle') { state.options.direction = 'custom'; state.options.directionAngle = normalizeAngle(value); }
        syncDirectionControls();
      }
      cancelAnimationFrame(liveParamFrame);
      liveParamFrame = requestAnimationFrame(() => {
        liveParamFrame = 0;
        const restart = state.autoplay && !state.playing && state.time >= duration() - .001;
        if (restart) state.time = 0;
        controller.update({ intensity: state.options.intensity, direction: state.options.direction, directionAngle: state.options.directionAngle });
        if (restart) play();
      });
      return;
    }
    syncControls();
    cancelAnimationFrame(paramFrame);
    paramFrame = requestAnimationFrame(() => { paramFrame = 0; rebuild(state.autoplay); });
  }
  function updateParameters(values, shouldPlay = false) {
    cancelAnimationFrame(paramFrame);
    cancelAnimationFrame(liveParamFrame);
    Object.assign(state.options, values);
    syncControls();
    rebuild(shouldPlay);
  }
  all('[data-mode]').forEach(button => button.addEventListener('click', () => changeGroup(button.dataset.mode, state.category)));
  all('[data-category]').forEach(button => button.addEventListener('click', () => changeGroup(state.mode, button.dataset.category)));
  all('[data-background]').forEach(button => button.addEventListener('click', () => {
    state.background = button.dataset.background;
    $('stage-shell').dataset.background = state.background;
    all('[data-background]').filter(item => item.tagName === 'BUTTON').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.background === state.background)));
  }));
  $('mark-color').addEventListener('input',()=>updateParameter('markColor',$('mark-color').value));
  $('effect-search').addEventListener('input', renderLibrary);
  $('clear-search').addEventListener('click', () => { $('effect-search').value = ''; renderLibrary(); });
  $('play-toggle').addEventListener('click', () => state.playing ? pause() : play());
  $('timeline').addEventListener('input', () => seek(Number($('timeline').value) / 1000 * duration()));
  ['duration', 'stagger', 'intensity','curvature'].forEach(key => $(key).addEventListener('input', () => updateParameter(key, Number($(key).value))));
  ['duration','stagger','intensity','curvature'].forEach(key=>{
    const input=$(key+'-value'),range=$(key),factor=['intensity','curvature'].includes(key)?100:1;
    const apply=()=>{range.value=String(input.valueAsNumber/factor);updateParameter(key,Number(range.value));};
    input.addEventListener('input',()=>{if(input.value!==''&&input.checkValidity())apply();});
    input.addEventListener('blur',()=>{
      if(input.value!==''&&Number.isFinite(input.valueAsNumber)) {
        input.value=String(Math.round(Math.max(Number(input.min),Math.min(Number(input.max),input.valueAsNumber))/Number(input.step))*Number(input.step));apply();
      }
      syncParameterNumber(key,true);
    });
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}else if(e.key==='Escape'){syncParameterNumber(key,true);input.blur();}});
  });
  all('[data-direction-choice]').forEach(button => button.addEventListener('click', () => {
    const value = button.dataset.directionChoice;
    if (value === 'custom') state.options.directionAngle = normalizeAngle(state.options.directionAngle);
    else if (directionPresets[value]) state.options.directionAngle = directionPresets[value].angle;
    updateParameter('direction', value);
  }));
  const inputDirectionAngle = source => updateParameter('directionAngle', normalizeAngle(source.value));
  $('direction-angle-number').addEventListener('input', event => inputDirectionAngle(event.target));
  const directionDial = $('direction-dial');
  let directionDialPointer = null;
  const updateDirectionDial = event => {
    const rect = directionDial.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    updateParameter('directionAngle', normalizeAngle(Math.atan2(dx, -dy) * 180 / Math.PI));
  };
  directionDial.addEventListener('pointerdown', event => {
    event.preventDefault();
    directionDialPointer = event.pointerId;
    directionDial.focus();
    try { directionDial.setPointerCapture(event.pointerId); } catch (_) {}
    if (state.options.direction === 'custom') updateDirectionDial(event);
  });
  directionDial.addEventListener('pointermove', event => {
    if (directionDialPointer !== event.pointerId) return;
    updateDirectionDial(event);
  });
  const stopDirectionDial = event => {
    if (directionDialPointer !== event.pointerId) return;
    try { directionDial.releasePointerCapture(event.pointerId); } catch (_) {}
    directionDialPointer = null;
  };
  directionDial.addEventListener('pointerup', stopDirectionDial);
  directionDial.addEventListener('pointercancel', stopDirectionDial);
  directionDial.addEventListener('keydown', event => {
    const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 15, PageDown: -15 };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      updateParameter('directionAngle', event.key === 'Home' ? 0 : 359);
    } else if (steps[event.key]) {
      event.preventDefault();
      updateParameter('directionAngle', normalizeAngle(state.options.directionAngle + steps[event.key] * (event.shiftKey ? 15 : 1)));
    }
  });
  $('dust').addEventListener('change', () => updateParameter('dust', $('dust').checked));
  $('split-select').addEventListener('change', () => updateParameter('split', $('split-select').value));
  $('reset-params').addEventListener('click', () => {
    const selected = effect();
    Object.assign(state.options, { duration: selected.duration || 1.2, stagger: selected.stagger === undefined ? .06 : selected.stagger, intensity: selected.intensity || 1, direction: 'up', directionAngle: 0, split: 'char', dust: true,curvature:.5,markColor:'#ffe066' });
    if (selected.id === 'number-roll' || selected.id === 'number-count') Object.assign(state.options, numberDefaults);
    syncControls(); rebuild(); toast('已恢复此样式的默认参数');
    document.dispatchEvent(new CustomEvent('pang:parameterchange', { detail: { key: 'reset' } }));
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); state.playing ? pause() : play(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { pause(); stopHover(); } });
  reduceMotion.addEventListener('change', () => {
    state.autoplay = state.hover = !reduceMotion.matches;
    if (reduceMotion.matches) { pause(); stopHover(); }
    syncControls();
  });
  // Office may take focus while applying a recipe. A visible sample must finish;
  // only hidden surfaces, native preview and explicit transport actions pause it.
  window.addEventListener('blur', stopHover);
  window.addEventListener('pagehide', () => { pause(); stopHover(); cancelAnimationFrame(paramFrame); cancelAnimationFrame(liveParamFrame); });
  document.querySelector('.brand')?.addEventListener('click', event => { event.preventDefault(); $('effect-search').value = ''; selectEffect('anvil'); });
  globalThis.MotionPreview = Object.freeze({
    selectEffect, notify: toast, updateParameter, updateParameters,
    getState: () => ({ ...state, hovering: !!hoverController, options: { ...state.options, imageData: state.options.imageData ? '[local image]' : null }, totalDuration: duration(), unitCount: controller ? controller.unitCount : 0 }),
    seek, play, pause, stopHover
  });
  selectEffect('anvil', { play: state.autoplay });
}());
