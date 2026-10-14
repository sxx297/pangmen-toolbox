/* Shape-independent user material recipes. Built-in presets remain owned by the UI. */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'ppt-material-presets-v2';
  const PRESET_KIND = 'ppt-shape-material-preset';
  const LIBRARY_KIND = 'ppt-shape-material-library';
  const MAX_PRESETS = 100;
  const MAX_INPUT_BYTES = 200 * 1024;
  const COLORS = ['base', 'accent', 'secondary'];
  const NUMBERS = ['glow', 'highlight', 'grain', 'opacity', 'lightX', 'lightY', 'refraction', 'blur', 'thickness', 'bezelWidth', 'dispersion', 'fresnel'];
  const COMMON_LAYER_BOUNDS = { opacity: [0, 100], blur: [0, 100] };
  const LIGHT_LAYER_BOUNDS = { x: [0, 100], y: [0, 100], sizeX: [1, 150], sizeY: [1, 150] };
  // Inner-shadow blur, offsets and spread use logical pixels at 600 × 460.
  const SHADOW_LAYER_BOUNDS = { offsetX: [-100, 100], offsetY: [-100, 100], spread: [0, 100] };
  const BLEND_MODES = ['pass-through','normal','darken','multiply','color-burn','linear-burn','lighten','screen','color-dodge','linear-dodge','overlay','soft-light','hard-light','difference','exclusion','hue','saturation','color','luminosity'];
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  let sequence = 0;

  function fail(message) { throw new Error(message); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '必须是对象。');
    return value;
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function validateTree(value) {
    const pending = [{ value, depth: 0 }];
    let visited = 0;
    while (pending.length) {
      const item = pending.pop();
      if (!item.value || typeof item.value !== 'object') continue;
      if (++visited > 12000 || item.depth > 24) fail('预设数据结构过于复杂。');
      for (const key of Object.keys(item.value)) {
        if (FORBIDDEN_KEYS.has(key)) fail('预设包含不允许的字段：' + key);
        pending.push({ value: item.value[key], depth: item.depth + 1 });
      }
    }
  }
  function name(value, label) {
    if (typeof value !== 'string') fail((label || '预设名称') + '必须是文字。');
    const result = value.trim();
    if (!result || Array.from(result).length > 60) fail((label || '预设名称') + '须为 1–60 个字符。');
    return result;
  }
  function effect(value) {
    if (value !== 'gradient' && value !== 'glass') fail('效果类型必须是 gradient 或 glass。');
    return value;
  }
  function finite(value, low, high, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) {
      fail(label + '必须是 ' + low + '–' + high + ' 范围内的数值。');
    }
    return value;
  }
  function color(value, label) {
    if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) fail(label + '必须是十六进制颜色。');
    return (value.length === 4 ? '#' + value.slice(1).split('').map(c => c + c).join('') : value).toUpperCase();
  }
  function makeId(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return prefix + '-' + global.crypto.randomUUID();
    sequence += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function layerId(value) {
    if (typeof value !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value)) fail('图层 ID 格式无效。');
    return value;
  }
  function layerType(raw) {
    // Existing version-2 recipes contain only light layers and omit this field.
    if (!own(raw, 'type')) return 'light';
    if (raw.type !== 'light' && raw.type !== 'inner-shadow') fail('不支持此图层类型。');
    return raw.type;
  }
  function sanitizeLayers(value, strict) {
    if (!Array.isArray(value) || value.length > 16) fail('图层必须是数组，最多支持 16 层。');
    const used = new Set();
    return value.map((raw, index) => {
      object(raw, '图层');
      const type = layerType(raw);
      const item = { id: own(raw, 'id') ? layerId(raw.id) : makeId('layer'), name: own(raw, 'name') ? name(raw.name, '图层名称') : (type === 'inner-shadow' ? '内阴影 ' : '色光 ') + (index + 1), type };
      if (used.has(item.id)) fail('图层 ID 不能重复。');
      used.add(item.id);
      item.color = color(raw.color, '图层颜色');
      const layerBounds = Object.assign({}, COMMON_LAYER_BOUNDS, type === 'inner-shadow' ? SHADOW_LAYER_BOUNDS : LIGHT_LAYER_BOUNDS);
      for (const key of Object.keys(layerBounds)) {
        const bounds = layerBounds[key];
        item[key] = finite(raw[key], bounds[0], bounds[1], '图层 ' + key);
      }
      if (!BLEND_MODES.includes(raw.blendMode)) fail('图层混合模式不受支持。');
      item.blendMode = raw.blendMode;
      item.rotation=own(raw,'rotation')?finite(raw.rotation,-180,180,'图层旋转'):0;
      if(own(raw,'profile')){
        if(type!=='light'||raw.profile!=='contour')fail('不支持此色光模式。');
        item.profile='contour';item.edgeWidth=finite(raw.edgeWidth,1,100,'贴边色光扩散宽度');
        item.edgeInset=own(raw,'edgeInset')?finite(raw.edgeInset,0,100,'贴边色光高光内移'):0;
      }
      if (typeof raw.enabled !== 'boolean') {
        if (strict && own(raw, 'enabled')) fail('图层 enabled 必须是布尔值。');
        item.enabled = true;
      } else item.enabled = raw.enabled;
      return item;
    });
  }

  function create(api, suppliedStorage) {
    api = api || global.MaterialLab;
    if (!api || typeof api.normalize !== 'function') fail('材质渲染器尚未就绪。');
    let storage = null;
    let warning = '';
    let records = [];
    let damagedData = null;
    try {
      storage = suppliedStorage === undefined ? global.localStorage : suppliedStorage;
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
        storage = null;
        warning = '浏览器存储不可用；预设仅保留在本次会话，请导出备份。';
      }
    } catch (_) { warning = '浏览器存储不可用；预设仅保留在本次会话，请导出备份。'; }

    function sanitizeSettings(raw, requiredEffect, strict) {
      object(raw, '材质参数');
      validateTree(raw);
      const selectedEffect = effect(requiredEffect === undefined ? raw.effect : requiredEffect);
      if (own(raw, 'effect') && raw.effect !== selectedEffect) fail('预设与材质参数的效果类型不一致。');
      const input = { effect: selectedEffect };
      for (const key of COLORS) if (own(raw, key)) input[key] = strict ? color(raw[key], key) : raw[key];
      for (const key of NUMBERS) if (own(raw, key)) input[key] = strict ? finite(raw[key], 0, key==='refraction'?300:100, key) : raw[key];
      if (own(raw, 'layers')) {
        if (Array.isArray(raw.layers)) raw.layers.forEach(item => layerType(object(item, '图层')));
        input.layers = strict ? sanitizeLayers(raw.layers, true) : copy(raw.layers);
      }
      else if (strict) fail('材质参数缺少 layers 数组。');
      // Pass only recipe fields to normalize; geometry and preview fields cannot leak in.
      const normalized = api.normalize(copy(input));
      const result = { effect: selectedEffect };
      const colorFallback = { base: '#060A1D', accent: selectedEffect === 'glass' ? '#71A6FF' : '#345BFF', secondary: selectedEffect === 'glass' ? '#D6F3FF' : '#84EAFF' };
      for (const key of COLORS) result[key] = color(normalized[key] === undefined ? input[key] === undefined ? colorFallback[key] : input[key] : normalized[key], key);
      for (const key of NUMBERS) result[key] = finite(normalized[key], 0, key==='refraction'?300:100, key);
      result.layers = sanitizeLayers(normalized.layers || input.layers || [], false);
      return result;
    }
    function record(id, title, settings, requiredEffect, strict) {
      const clean = sanitizeSettings(settings, requiredEffect, strict);
      return { id, name: name(title), effect: clean.effect, settings: clean };
    }
    function persist() {
      if (!storage) return;
      try {
        const recovered = damagedData !== null;
        if (recovered) {
          // Preserve unreadable user data before replacing the live library. If
          // quota prevents the backup, leave the live key completely untouched.
          storage.setItem(STORAGE_KEY + '-' + makeId('recovery'), damagedData);
          damagedData = null;
        }
        storage.setItem(STORAGE_KEY, JSON.stringify({ kind: LIBRARY_KIND, schemaVersion: 2, presets: records }));
        warning = recovered ? '预设已保存；原有异常数据已保留备份。' : '';
      } catch (_) { warning = '预设已保留在本次会话，但未能写入浏览器存储；请导出备份。'; }
    }
    function append(item) {
      if (records.length >= MAX_PRESETS) fail('最多保存 100 个自定义预设，请先删除部分预设。');
      records.push(item);
      persist();
      return copy(item);
    }
    function uniqueId() {
      let id;
      do { id = makeId('user'); } while (records.some(item => item.id === id));
      return id;
    }
    if (storage) {
      try {
        const stored = storage.getItem(STORAGE_KEY);
        if (stored !== null && stored !== undefined) {
          damagedData = stored;
          const data = JSON.parse(stored);
          validateTree(data);
          object(data, '预设库');
          if (data.kind !== LIBRARY_KIND || data.schemaVersion !== 2 || !Array.isArray(data.presets) || data.presets.length > MAX_PRESETS) fail('预设库格式无效。');
          const used = new Set();
          const loaded = data.presets.map(raw => {
            object(raw, '预设');
            const id = layerId(raw.id);
            if (!id.startsWith('user-') || used.has(id)) fail('预设 ID 无效或重复。');
            used.add(id);
            return record(id, raw.name, raw.settings, effect(raw.effect), true);
          });
          records = loaded;
          damagedData = null;
        }
      } catch (_) {
        if (damagedData === null) storage = null;
        warning = '已有预设数据无法读取，原数据将保留；保存新预设前会先尝试备份，备份失败时仅保留本次会话。';
      }
    }
    return Object.freeze({
      list(selectedEffect) {
        if (selectedEffect !== undefined) effect(selectedEffect);
        return copy(selectedEffect === undefined ? records : records.filter(item => item.effect === selectedEffect));
      },
      saveNew(title, settings) { return append(record(uniqueId(), title, settings, undefined, false)); },
      update(id, title, settings) {
        const index = records.findIndex(item => item.id === id);
        if (index < 0) fail('找不到该自定义预设；内置预设请另存为。');
        const item = record(id, title, settings, records[index].effect, false);
        records[index] = item;
        persist();
        return copy(item);
      },
      remove(id) {
        const index = records.findIndex(item => item.id === id);
        if (index < 0) return false;
        records.splice(index, 1);
        persist();
        return true;
      },
      restore(raw) {
        object(raw, '预设');
        const id = layerId(raw.id);
        if (!id.startsWith('user-') || records.some(item => item.id === id)) fail('预设已存在或 ID 无效。');
        return append(record(id, raw.name, raw.settings, effect(raw.effect), true));
      },
      importPreset(text) {
        if (typeof text !== 'string') fail('导入内容必须是 JSON 文字。');
        if (text.length > MAX_INPUT_BYTES || new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES) fail('导入文件不能超过 200 KB。');
        let data;
        try { data = JSON.parse(text); } catch (_) { fail('无法解析预设 JSON，请检查文件。'); }
        validateTree(data);
        object(data, '导入内容');
        if (data.kind !== PRESET_KIND || data.schemaVersion !== 2) fail('不支持此预设格式或版本，请导入版本 2 的材质预设。');
        object(data.preset, '预设');
        return append(record(uniqueId(), data.preset.name, data.preset.settings, effect(data.preset.effect), true));
      },
      exportPreset(title, settings) {
        const item = record('export', title, settings, undefined, false);
        return JSON.stringify({ kind: PRESET_KIND, schemaVersion: 2, preset: { name: item.name, effect: item.effect, settings: item.settings } }, null, 2);
      },
      get storageWarning() { return warning; }
    });
  }
  global.MaterialPresetStore = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
