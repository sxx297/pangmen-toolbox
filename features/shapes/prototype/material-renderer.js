/* Canvas2D material renderer; geometry, gradient and layer tools are independent.
   Glass profile, slope filtering, Snell sampling and rim formulas adapted from
   @liquid-dom/core 0.1.1 (Andras Prifer), used by LiquidSlide.
   Full notice also available at licenses/liquid-dom-core-MIT.txt.

   MIT License
   Copyright (c) 2026 Andras Prifer

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */
(function (global) {
  'use strict';
  const WIDTH = 600, HEIGHT = 460, MAX_LAYERS = 16;
  const blendModes = Object.freeze(['pass-through','normal','darken','multiply','color-burn','linear-burn','lighten','screen','color-dodge','linear-dodge','overlay','soft-light','hard-light','difference','exclusion','hue','saturation','color','luminosity']);
  const shapes = Object.freeze({
    roundedRect: { label: '圆角矩形' }, rectangle: { label: '矩形' }, ellipse: { label: '椭圆' }, triangle: { label: '三角形' },
    diamond: { label: '菱形' }, star: { label: '星形' }, hexagon: { label: '六边形' }, arrow: { label: '箭头' },
    heart: { label: '心形' }, ring: { label: '圆环 · 镂空' }, freeform: { label: '自由曲线' }, line: { label: '线条轮廓' }
  });
  function layer(id, name, color, x, y, sizeX, sizeY, opacity, blur, blendMode) {
    return Object.freeze({ id, name, type: 'light', color, x, y, sizeX, sizeY, opacity, blur, blendMode: blendMode || 'screen', enabled: true });
  }
  function contour(id,name,color,x,y,sizeX,sizeY,opacity,edgeWidth,blur=100){
    return Object.freeze({...layer(id,name,color,x,y,sizeX,sizeY,opacity,blur),profile:'contour',edgeWidth});
  }
  function glassArc(id,name,color,x,y,sizeX,sizeY,opacity,width,inset=0,blendMode='screen'){
    return Object.freeze({...contour(id,name,color,x,y,sizeX,sizeY,opacity,width),edgeInset:inset,blendMode});
  }
  function glassPreset(label,layers,extra={}){
    return Object.freeze({label,effect:'glass',base:'#EAF1F5',accent:'#D9E6EE',secondary:'#FFFFFF',glow:65,spread:55,highlight:80,grain:0,refraction:70,blur:5,thickness:85,bezelWidth:36,dispersion:12,fresnel:42,radius:42,opacity:6,lightX:25,lightY:0,...extra,layers:Object.freeze(layers)});
  }
  function contourPreset(label,layers,extra={}){
    return Object.freeze({label,effect:'gradient',base:'#05060B',glow:100,spread:65,highlight:12,grain:0,refraction:0,blur:0,radius:40,opacity:100,lightX:50,lightY:0,...extra,layers:Object.freeze(layers)});
  }
  function metalPreset(id,label,base,tint,bright){
    return contourPreset(label,[
      contour(id+'-1','底部金属柔光',tint,50,100,150,100,100,60),
      contour(id+'-2','左侧轮廓',tint,0,60,48,145,72,20),
      contour(id+'-3','右侧轮廓',tint,100,60,48,145,72,20),
      contour(id+'-4','底部亮边',bright,50,100,150,56,100,7),
      contour(id+'-5','侧面细高光',bright,50,85,150,115,55,1.8)
    ],{base,accent:tint,secondary:bright,grain:14,highlight:24,lightX:50,lightY:100});
  }
  const presets = Object.freeze({
    blue: Object.freeze({ label: '深海蓝光', effect: 'gradient', base: '#060A1D', glow: 88, spread: 57, highlight: 64, grain: 11, refraction: 0, blur: 0, radius: 34, opacity: 96, lightX: 50, lightY: 95, layers: Object.freeze([
      layer('blue-1', '底部蓝色弥散', '#345BFF', 48, 100, 150, 78, 98, 100),
      layer('blue-2', '冰蓝底光', '#84EAFF', 60, 100, 130, 31, 96, 100),
      layer('blue-3', '左侧蓝光', '#345BFF', 2, 68, 29, 100, 43, 100),
      layer('blue-4', '右侧轮廓光', '#426AFF', 98, 32, 30, 110, 31, 100)
    ]) }),
    purple: Object.freeze({ label: '紫晶辉光', effect: 'gradient', base: '#140C29', glow: 86, spread: 65, highlight: 84, grain: 10, refraction: 0, blur: 0, radius: 32, opacity: 96, lightX: 20, lightY: 0, layers: Object.freeze([
      layer('purple-1', '紫色底光', '#8F48FF', 48, 100, 150, 86, 98, 100),
      layer('purple-2', '浅紫扩散', '#E5B5FF', 58, 100, 130, 34, 93, 100),
      layer('purple-3', '顶部柔光', '#C4A0FF', 30, 0, 150, 35, 72, 100),
      layer('purple-4', '左侧紫光', '#9451FF', 0, 61, 29, 110, 34, 100)
    ]) }),
    aurora: Object.freeze({ label: '极光弥散', effect: 'gradient', base: '#071D26', glow: 90, spread: 82, highlight: 58, grain: 9, refraction: 0, blur: 0, radius: 44, opacity: 94, lightX: 85, lightY: 15, layers: Object.freeze([
      layer('aurora-1', '深蓝漫射', '#2468ED', 32, 83, 138, 120, 87, 100),
      layer('aurora-2', '薄荷色光团', '#78FFD7', 88, 66, 97, 115, 81, 100),
      layer('aurora-3', '青色底光', '#8AE9F4', 54, 100, 145, 32, 87, 100)
    ]) }),
    amber: Object.freeze({ label: '琥珀暖光', effect: 'gradient', base: '#241009', glow: 88, spread: 76, highlight: 58, grain: 7, refraction: 0, blur: 0, radius: 34, opacity: 96, lightX: 70, lightY: 95, layers: Object.freeze([
      layer('amber-1', '橙色漫射', '#FF5500', 30, 90, 145, 115, 94, 100),
      layer('amber-2', '香槟底光', '#FFD69A', 76, 100, 120, 55, 90, 100),
      layer('amber-3', '顶部金光', '#FFAD56', 88, 0, 75, 60, 46, 100)
    ]) }),
    rose: Object.freeze({ label: '玫瑰霞光', effect: 'gradient', base: '#230E22', glow: 86, spread: 80, highlight: 52, grain: 6, refraction: 0, blur: 0, radius: 34, opacity: 96, lightX: 20, lightY: 90, layers: Object.freeze([
      layer('rose-1', '玫红漫射', '#F46AAC', 14, 83, 130, 130, 88, 100),
      layer('rose-2', '蜜桃柔光', '#FFD2B6', 76, 100, 125, 72, 88, 100),
      layer('rose-3', '淡紫顶光', '#B595FF', 82, 0, 110, 50, 56, 100)
    ]) }),
    jade: Object.freeze({ label: '翡翠流光', effect: 'gradient', base: '#061F1B', glow: 86, spread: 82, highlight: 54, grain: 6, refraction: 0, blur: 0, radius: 34, opacity: 96, lightX: 70, lightY: 90, layers: Object.freeze([
      layer('jade-1', '青绿漫射', '#13CBA8', 80, 78, 120, 130, 88, 100),
      layer('jade-2', '浅金底光', '#D8EDAC', 28, 100, 135, 52, 87, 100),
      layer('jade-3', '薄荷顶光', '#80E8CE', 18, 0, 100, 42, 42, 100)
    ]) }),
    violetOrb: contourPreset('紫晶光球',[
      contour('violet-orb-1','右侧紫色弧光','#873CF5',95,42,110,150,100,60),
      contour('violet-orb-2','顶部紫色柔光','#9C52F5',52,0,150,95,100,42),
      contour('violet-orb-3','顶部浅紫高光','#F5CBFF',57,0,140,65,100,14),
      contour('violet-orb-4','右侧珠光','#DCACFA',100,38,50,130,72,10)
    ],{base:'#05030C',accent:'#6737CE',secondary:'#F4CEFF',highlight:14,lightX:60,lightY:0,previewShape:'circle'}),
    azureOrb: contourPreset('冰蓝光球',[
      contour('azure-orb-1','右侧深蓝柔光','#174CDD',100,48,100,150,100,44),
      contour('azure-orb-2','右侧冰蓝轮廓','#21ACFF',100,54,52,150,96,14),
      contour('azure-orb-3','底部蓝光','#2D87ED',64,100,135,70,80,19),
      contour('azure-orb-4','顶部微光','#2589EC',55,0,140,52,63,6),
      contour('azure-orb-5','蓝色细边','#73D9FF',85,65,115,140,48,1.5)
    ],{base:'#091222',accent:'#176DDD',secondary:'#61CEFF',highlight:10,lightX:95,lightY:55,previewShape:'circle'}),
    spectrumFrame: contourPreset('幻彩霓虹',[
      contour('spectrum-1','左上紫粉','#E153FF',0,0,110,100,100,32),
      contour('spectrum-2','顶部青光','#5DF4ED',74,0,140,75,100,26),
      contour('spectrum-3','右侧蓝光','#3D9AFF',100,55,65,150,98,27),
      contour('spectrum-4','右下粉光','#ED48EE',100,100,105,65,100,27),
      contour('spectrum-5','底部金橙','#FFB32C',25,100,145,80,100,33),
      contour('spectrum-6','彩光亮边','#FFF0F8',50,50,150,150,65,2.5)
    ],{base:'#020204',highlight:0,accent:'#8865EE',secondary:'#EEEAFF'}),
    violetFrame: contourPreset('蓝紫光框',[
      contour('violet-frame-1','左侧紫粉','#D650EE',0,50,65,150,100,40),
      contour('violet-frame-2','右侧紫粉','#D650EE',100,50,65,150,100,40),
      contour('violet-frame-3','顶部蓝青','#3FBAFF',50,0,135,80,100,36),
      contour('violet-frame-4','底部蓝青','#3FBAFF',50,100,135,80,100,36),
      contour('violet-frame-5','柔白亮边','#F9CFFF',50,50,150,150,80,3)
    ],{base:'#030207',highlight:0,accent:'#713DE7',secondary:'#D7ECFF'}),
    cyanTrace: contourPreset('青瓷微光',[
      contour('cyan-trace-1','右上青色漫射','#16BDB3',98,0,62,64,65,30),
      contour('cyan-trace-2','右上青瓷亮边','#8AFFF1',100,0,55,70,94,1.5),
      contour('cyan-trace-3','左下蓝青漫射','#0EABC8',0,100,64,68,64,25),
      contour('cyan-trace-4','左下冰青亮边','#7CEEFE',0,100,63,74,95,1.5)
    ],{base:'#080F14',highlight:6,accent:'#216C73',secondary:'#BBE9E2',lightX:100,lightY:0}),
    auroraCrown: contourPreset('极光顶光',[
      contour('aurora-crown-1','左上冰蓝漫射','#78BFDD',0,0,80,65,86,44),
      contour('aurora-crown-2','顶部薄荷光','#66CBB0',43,0,100,58,70,28),
      contour('aurora-crown-3','右上银灰反光','#A3A3AF',100,0,53,95,45,36),
      contour('aurora-crown-4','左上银白亮边','#DFEFF9',0,0,65,70,74,7)
    ],{base:'#111218',highlight:18,accent:'#6D9FA7',secondary:'#E5EEF3',lightX:12,lightY:0}),
    gilded: metalPreset('gilded','鎏金磨砂','#16140E','#DDA740','#FFF0B1'),
    silver: metalPreset('silver','冷银磨砂','#131519','#9CA5B2','#F0F5FD'),
    roseCopper: metalPreset('rose-copper','玫瑰铜光','#1C1212','#CF867D','#FFE0D8'),
    redCopper: metalPreset('red-copper','赤铜暖光','#1C100B','#CB783F','#FFD6A4'),
    glass: Object.freeze({ label: '清透玻璃', effect: 'glass', base: '#E9F0F7', accent: '#DAE6F2', secondary: '#FFFFFF', glow: 12, spread: 46, highlight: 84, grain: 0, refraction: 76, blur: 1, thickness: 90, bezelWidth: 36, dispersion: 28, fresnel: 42, radius: 42, opacity: 3, lightX: 15, lightY: 6, layers: Object.freeze([
      layer('glass-1', '顶部轻透光', '#FFFFFF', 24, 0, 150, 42, 10, 90),
      layer('glass-2', '底部轻透光', '#EDF4FF', 60, 100, 145, 59, 8, 85)
    ]) }),
    frosted: Object.freeze({ label: '柔雾玻璃', effect: 'glass', base: '#EBEFF5', accent: '#D9E4F0', secondary: '#FFFFFF', glow: 16, spread: 55, highlight: 72, grain: 7, refraction: 62, blur: 38, thickness: 75, bezelWidth: 30, dispersion: 8, fresnel: 30, radius: 42, opacity: 12, lightX: 20, lightY: 0, layers: Object.freeze([
      layer('frosted-1', '柔白透光', '#ECF5FF', 26, 15, 150, 105, 24, 90),
      layer('frosted-2', '冷色雾光', '#8AB8FF', 88, 95, 112, 94, 25, 95)
    ]) }),
    smoked: Object.freeze({ label: '烟色玻璃', effect: 'glass', base: '#15131B', accent: '#C8C8DA', secondary: '#F4F1FF', glow: 20, spread: 50, highlight: 82, grain: 2, refraction: 82, blur: 4, thickness: 95, bezelWidth: 44, dispersion: 18, fresnel: 40, radius: 36, opacity: 28, lightX: 80, lightY: 4, layers: Object.freeze([
      layer('smoked-1', '紫色折光', '#A388E1', 84, 0, 105, 57, 29, 80),
      layer('smoked-2', '浅紫底光', '#AFB5FF', 31, 100, 134, 44, 31, 88)
    ]) }),
    champagne: Object.freeze({ label: '香槟玻璃', effect: 'glass', base: '#F3D8AB', accent: '#FFD9A0', secondary: '#FFF5DE', glow: 24, spread: 60, highlight: 82, grain: 1, refraction: 70, blur: 12, thickness: 85, bezelWidth: 32, dispersion: 10, fresnel: 36, radius: 42, opacity: 18, lightX: 15, lightY: 0, layers: Object.freeze([
      layer('champagne-1', '香槟顶光', '#FFF0C9', 25, 0, 150, 52, 30, 100),
      layer('champagne-2', '琥珀底光', '#FFB36B', 76, 100, 132, 64, 24, 100)
    ]) }),
    ice: Object.freeze({ label: '冰蓝玻璃', effect: 'glass', base: '#B8DAEE', accent: '#B9E9FF', secondary: '#FFFFFF', glow: 24, spread: 55, highlight: 90, grain: 0, refraction: 88, blur: 7, thickness: 100, bezelWidth: 48, dispersion: 22, fresnel: 54, radius: 36, opacity: 24, lightX: 20, lightY: 0, layers: Object.freeze([
      layer('ice-1', '冰白顶光', '#E6FAFF', 20, 0, 145, 45, 27, 100),
      layer('ice-2', '冰蓝折光', '#76BEFF', 88, 74, 80, 125, 36, 100)
    ]) }),
    pearl: Object.freeze({ label: '珍珠柔雾', effect: 'glass', base: '#F2E9F1', accent: '#DCCCF5', secondary: '#FFFFFF', glow: 32, spread: 78, highlight: 68, grain: 3, refraction: 48, blur: 68, thickness: 65, bezelWidth: 24, dispersion: 40, fresnel: 28, radius: 44, opacity: 32, lightX: 20, lightY: 0, layers: Object.freeze([
      layer('pearl-1', '珍珠柔光', '#FFF2E9', 20, 18, 140, 110, 38, 100),
      layer('pearl-2', '浅紫雾光', '#C3B6F7', 80, 85, 130, 110, 38, 100)
    ]) }),
    crystalLens: glassPreset('水晶透镜',[
      glassArc('crystal-lens-1','顶部外弧高光','#F5FDFF',45,0,150,75,95,2),
      glassArc('crystal-lens-2','顶部内弧反光','#E2F4FF',40,0,145,75,72,4,15),
      glassArc('crystal-lens-3','底部暗弧','#243747',55,100,145,65,32,7,10,'multiply'),
      glassArc('crystal-lens-4','底部晶亮边','#C7EBFF',56,100,145,63,62,1.8),
      layer('crystal-lens-5','顶部透明柔光','#FFFFFF',34,0,130,36,12,100)
    ],{opacity:2,refraction:96,blur:0,thickness:100,bezelWidth:64,dispersion:20,fresnel:62,highlight:95,glow:80,previewShape:'circle'}),
    mistLens: glassPreset('雾面透镜',[
      layer('mist-lens-1','顶部乳白柔光','#FFFFFF',42,3,150,65,46,100),
      glassArc('mist-lens-2','外侧玻璃亮弧','#F1FBFF',42,0,150,80,95,2.5),
      glassArc('mist-lens-3','内侧弧形反光','#DCEFFA',40,0,145,85,62,5,16),
      glassArc('mist-lens-4','下沿暗部','#213F47',60,100,150,70,35,12,7,'multiply'),
      glassArc('mist-lens-5','下沿透光','#C3E9F1',55,100,145,63,65,2)
    ],{opacity:12,refraction:86,blur:62,thickness:98,bezelWidth:58,dispersion:8,fresnel:48,highlight:88,glow:76,previewShape:'circle'}),
    sandPane: glassPreset('暖砂薄玻璃',[
      glassArc('sand-pane-1','浅暖白细边','#FFF5D9',50,50,150,150,65,1.1),
      layer('sand-pane-2','底部暖砂柔光','#E7CFA5',55,92,150,100,26,100),
      glassArc('sand-pane-3','左上柔亮边','#FFF9E9',12,0,90,100,28,7)
    ],{base:'#C2B69A',accent:'#D8C9AA',secondary:'#FFF7E6',opacity:14,refraction:12,blur:18,thickness:22,bezelWidth:10,dispersion:0,fresnel:12,highlight:34,grain:4,glow:58}),
    cloudPane: glassPreset('云蓝玻璃',[
      layer('cloud-pane-1','左侧云白漫光','#D3ECFF',0,45,80,135,48,100),
      glassArc('cloud-pane-2','冰白轮廓','#D4E9FF',50,45,150,150,62,1.5),
      glassArc('cloud-pane-3','左上柔光','#BDDFFF',5,10,80,125,42,17)
    ],{base:'#416389',accent:'#A7CEE9',secondary:'#E6F4FF',opacity:24,refraction:28,blur:32,thickness:38,bezelWidth:17,dispersion:3,fresnel:23,highlight:45,glow:64,lightX:0,lightY:30}),
    milkPane: glassPreset('乳白磨砂',[
      layer('milk-pane-1','顶部乳白漫光','#FFFFFF',48,0,150,88,55,100),
      glassArc('milk-pane-2','上沿乳白亮边','#FFFFFF',50,0,150,100,76,2.5),
      glassArc('milk-pane-3','圆角厚边柔光','#E6F3FF',50,50,150,150,42,7),
      glassArc('milk-pane-4','下沿轻反光','#F4F8FF',55,100,150,60,45,2)
    ],{base:'#EBF1F6',opacity:27,refraction:36,blur:57,thickness:55,bezelWidth:27,dispersion:4,fresnel:28,highlight:64,glow:70}),
    midnightPane: glassPreset('深蓝柔光玻璃',[
      layer('midnight-pane-1','顶部冷色透光','#A3CCF5',45,0,150,70,35,100),
      layer('midnight-pane-2','底部深蓝渐暗','#07162E',50,100,150,145,72,100,'multiply'),
      glassArc('midnight-pane-3','克制轮廓光','#B6D6F0',50,30,150,150,50,1.4),
      glassArc('midnight-pane-4','左上微光','#C8E1F6',5,0,85,90,28,9)
    ],{base:'#152B4D',accent:'#7CABC8',secondary:'#D0E6F8',opacity:39,refraction:22,blur:25,thickness:32,bezelWidth:15,dispersion:2,fresnel:18,highlight:30,glow:74})
  });
  const opticalDefaults = Object.freeze({ thickness: 90, bezelWidth: 36, dispersion: 28, fresnel: 42 });
  const bounds = Object.freeze({ glow: [0, 100], spread: [0, 100], highlight: [0, 100], grain: [0, 100], refraction: [0, 300], blur: [0, 100], thickness: [0, 100], bezelWidth: [0, 100], dispersion: [0, 100], fresnel: [0, 100], radius: [0, 80], opacity: [0, 100], lightX: [0, 100], lightY: [0, 100] });
  const layerBounds = Object.freeze({ rotation: [-180, 180], x: [0, 100], y: [0, 100], sizeX: [1, 150], sizeY: [1, 150], opacity: [0, 100], blur: [0, 100] });
  const shadowBounds = Object.freeze({ rotation: [-180, 180], offsetX: [-100, 100], offsetY: [-100, 100], spread: [0, 100], opacity: [0, 100], blur: [0, 100] });
  const geometryCache = new Map(), immutableGeometryCache = new WeakMap();
  const gradientGeometryCache = new Map(), immutableGradientGeometryCache = new WeakMap();
  let grainTile, nextLayerId = 0;
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function numeric(value, fallback, range) { const n = Number(value); return Number.isFinite(n) ? clamp(n, range[0], range[1]) : fallback; }
  function color(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const s = value.trim(); if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('');
    return fallback;
  }
  function rgb(hex) { const n = parseInt(color(hex, '#000000').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(hex, alpha) { return 'rgba(' + rgb(hex).concat(clamp(alpha, 0, 1)).join(',') + ')'; }
  function createOptions(key) { return normalize({ preset: key }); }
  function createLayer(type) {
    const id = 'layer-' + Date.now().toString(36) + '-' + (++nextLayerId).toString(36);
    return normalize({ layers: [{ id, type: type === 'inner-shadow' ? type : 'light' }] }).layers[0];
  }
  function normalize(input) {
    input = input && typeof input === 'object' ? input : {};
    const key = Object.prototype.hasOwnProperty.call(presets, input.preset) ? input.preset : (input.effect === 'glass' ? 'glass' : 'blue');
    const preset = presets[key], options = Object.assign({}, preset, { shape: 'roundedRect', content: true }, input, { preset: key });
    options.effect = input.effect === 'glass' || input.effect === 'gradient' ? input.effect : preset.effect;
    options.shape = Object.prototype.hasOwnProperty.call(shapes, options.shape) ? options.shape : 'roundedRect';
    for (const name of Object.keys(bounds)) options[name] = numeric(options[name], preset[name] === undefined ? opticalDefaults[name] : preset[name], bounds[name]);
    options.base = color(options.base, preset.base);
    options.accent = color(options.accent, preset.layers[0] ? preset.layers[0].color : '#85A8E5');
    options.secondary = color(options.secondary, preset.layers[1] ? preset.layers[1].color : '#D9E7FF');
    const rawLayers = Array.isArray(input.layers) ? input.layers : preset.layers;
    options.layers = rawLayers.slice(0, MAX_LAYERS).map((item, i) => {
      item = item && typeof item === 'object' ? item : {};
      const type = item.type === 'inner-shadow' ? 'inner-shadow' : 'light', shadow = type === 'inner-shadow';
      const result = { id: typeof item.id === 'string' ? item.id.slice(0, 80) : 'layer-' + (i + 1), name: typeof item.name === 'string' ? item.name.slice(0, 100) : (shadow ? '内阴影 ' : '光层 ') + (i + 1), type, color: color(item.color, shadow ? '#B5E6FF' : '#87B7FF'), enabled: item.enabled !== false, blendMode: blendModes.includes(item.blendMode) ? item.blendMode : 'screen' };
      const defaults = shadow ? { rotation: 0, offsetX: 0, offsetY: 0, spread: 4, opacity: 70, blur: 28 } : { rotation: 0, x: 50, y: 50, sizeX: 85, sizeY: 85, opacity: 65, blur: 75 };
      const ranges = shadow ? shadowBounds : layerBounds;
      for (const name of Object.keys(ranges)) result[name] = numeric(item[name], defaults[name], ranges[name]);
      if(!shadow&&item.profile==='contour'){result.profile='contour';result.edgeWidth=numeric(item.edgeWidth,30,[1,100]);result.edgeInset=numeric(item.edgeInset,0,[0,100]);}
      return result;
    });
    options.pathFillRule = input.pathFillRule === 'nonzero' ? 'nonzero' : 'evenodd';
    options.content = input.content !== false && ['roundedRect', 'rectangle'].includes(options.shape) && !options.customPath && !options.alphaMask;
    return options;
  }
  function surface(w, h) { const c = typeof document==='undefined' ? new OffscreenCanvas(1,1) : document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function roundPath(ctx, x, y, w, h, radius) {
    const r = clamp(radius, 0, Math.min(w, h) / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function shapePath(options) {
    if (options.customPath) return { path: typeof options.customPath === 'string' ? new Path2D(options.customPath) : options.customPath, custom: true };
    const paths = {
      rectangle: 'M0 0H600V460H0Z', ellipse: 'M600 230A300 230 0 1 1 0 230A300 230 0 1 1 600 230Z',
      triangle: 'M300 6L594 454H6Z', diamond: 'M300 0L600 230L300 460L0 230Z', hexagon: 'M150 0H450L600 230L450 460H150L0 230Z',
      arrow: 'M0 125H360V10L600 230L360 450V335H0Z',
      heart: 'M300 450C237 399 8 255 8 126C8 12 166 -32 246 44C272 67 290 92 300 112C310 92 328 67 354 44C434 -32 592 12 592 126C592 255 363 399 300 450Z',
      ring: 'M600 230A300 230 0 1 1 0 230A300 230 0 1 1 600 230ZM490 230A190 126 0 1 1 110 230A190 126 0 1 1 490 230Z',
      freeform: 'M52 46C129 -26 254 35 295 108C328 168 375 72 454 32C526 -5 590 53 590 125C590 184 506 221 476 273C444 329 522 354 497 413C471 470 359 468 301 411C246 356 180 423 103 444C27 465 -8 387 23 323C67 235 131 236 118 186C108 145 -12 112 52 46Z',
      line: 'M43 359C135 170 220 425 309 231C391 58 458 255 556 96'
    };
    if (options.shape === 'star') {
      const points = []; for (let i = 0; i < 10; i++) { const angle = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.43 : 1; points.push((300 + Math.cos(angle) * 296 * r) + ',' + (230 + Math.sin(angle) * 225 * r)); }
      return { path: new Path2D('M' + points.join('L') + 'Z') };
    }
    if (options.shape === 'roundedRect') return { rounded: true };
    return { path: new Path2D(paths[options.shape]), stroke: options.shape === 'line' };
  }
  function drawMask(options, scale, descriptor) {
    const canvas = surface(WIDTH * scale, HEIGHT * scale), ctx = canvas.getContext('2d');
    if (options.alphaMask) {
      let source = options.alphaMask;
      if (source.data && Number.isFinite(source.width) && Number.isFinite(source.height)) { source = surface(source.width, source.height); const data = options.alphaMask; source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0); }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height); return canvas;
    }
    ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
    if (descriptor.rounded) { roundPath(ctx, 0, 0, WIDTH, HEIGHT, options.radius * 1.5); ctx.fill(); }
    else if (descriptor.stroke) { ctx.lineWidth = 64; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(descriptor.path); }
    else ctx.fill(descriptor.path, options.pathFillRule);
    return canvas;
  }
  // Exact squared Euclidean distance transform: 1D lower envelopes of parabolas,
  // first columns then rows. The transparent frame defines bounding-box edges.
  function edt1d(f, length, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s; do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p)); if (s <= z[k]) k--; else break; } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0; for (let q = 0; q < length; q++) { while (z[k + 1] < q) k++; const offset = q - v[k]; d[q] = offset * offset + f[v[k]]; }
  }
  function distanceTransform(binary, w, h, target) {
    const temp = new Float64Array(w * h), result = new Float32Array(w * h), size = Math.max(w, h), f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1);
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = binary[y * w + x] === target ? 0 : 1e12; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) temp[y * w + x] = d[y]; }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = temp[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) result[y * w + x] = d[x]; }
    return result;
  }
  // Preserve existing gradient recipes; the finer optical geometry is glass-only.
  function gradientGeometry(options) {
    if(options.immutableMask && options.alphaMask && immutableGradientGeometryCache.has(options.alphaMask))return immutableGradientGeometryCache.get(options.alphaMask);
    const key = !options.alphaMask && (!options.customPath || typeof options.customPath === 'string') ? options.shape + '|' + options.radius + '|' + (options.customPath || '') + '|' + options.pathFillRule : null;
    if (key && gradientGeometryCache.has(key)) return gradientGeometryCache.get(key);
    const descriptor = shapePath(options), mask = drawMask(options, 1, descriptor), alpha = mask.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
    const w = WIDTH + 2, h = HEIGHT + 2, binary = new Uint8Array(w * h); let covered = 0;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) { const inside = alpha[(y * WIDTH + x) * 4 + 3] >= 128 ? 1 : 0; binary[(y + 1) * w + x + 1] = inside; covered += inside; }
    const toOutside = distanceTransform(binary, w, h, 0), toInside = distanceTransform(binary, w, h, 1), distance = new Float32Array(WIDTH * HEIGHT), nx = new Float32Array(WIDTH * HEIGHT), ny = new Float32Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) { const p = (y + 1) * w + x + 1; distance[y * WIDTH + x] = binary[p] ? Math.sqrt(toOutside[p]) - 0.5 : 0.5 - Math.sqrt(toInside[p]); }
    const read = (x, y) => x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? -0.5 : distance[y * WIDTH + x];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) { const dx = read(x + 1, y) - read(x - 1, y), dy = read(x, y + 1) - read(x, y - 1), length = Math.hypot(dx, dy), p = y * WIDTH + x; nx[p] = length > 1e-6 ? -dx / length : 0; ny[p] = length > 1e-6 ? -dy / length : 0; }
    const result = { mask, descriptor, distance, nx, ny, coverage: covered / (WIDTH * HEIGHT), source: options.alphaMask ? 'alpha-mask' : options.customPath ? 'custom-path' : 'builtin' };
    if(options.immutableMask && options.alphaMask)immutableGradientGeometryCache.set(options.alphaMask,result);
    if (key) { if (gradientGeometryCache.size >= 4) gradientGeometryCache.delete(gradientGeometryCache.keys().next().value); gradientGeometryCache.set(key, result); } return result;
  }
  function shapeGeometry(options) {
    if(options.effect!=='glass')return gradientGeometry(options);
    if(options.immutableMask && options.alphaMask && immutableGeometryCache.has(options.alphaMask))return immutableGeometryCache.get(options.alphaMask);
    const key = !options.alphaMask && (!options.customPath || typeof options.customPath === 'string') ? options.shape + '|' + options.radius + '|' + (options.customPath || '') + '|' + options.pathFillRule : null;
    if (key && geometryCache.has(key)) return geometryCache.get(key);
    // Keep coverage through contour reconstruction. EDT supplies the far field;
    // near the silhouette measure against subpixel segments, not binary centers.
    const descriptor = shapePath(options), mask = drawMask(options, 1, descriptor), scale = 2;
    const fineMask = drawMask(options, scale, descriptor), fw = fineMask.width, fh = fineMask.height;
    const alpha = fineMask.getContext('2d').getImageData(0, 0, fw, fh).data;
    const w = fw + 2, h = fh + 2, binary = new Uint8Array(w * h), coverage = new Float32Array(w * h); let covered = 0;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const a = alpha[(y * fw + x) * 4 + 3] / 255, p = (y + 1) * w + x + 1;
      coverage[p] = a; binary[p] = a >= .5 ? 1 : 0; covered += a;
    }
    const binSize = 8, binsWide = Math.ceil(w / binSize), bins = new Map();
    const segment = (a, b) => {
      const bx = Math.floor((a[0] + b[0]) / 2 / binSize), by = Math.floor((a[1] + b[1]) / 2 / binSize), key = by * binsWide + bx;
      if (!bins.has(key)) bins.set(key, []); bins.get(key).push([a[0], a[1], b[0], b[1]]);
    };
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const p = y * w + x;
      if(binary[p]===binary[p+1]&&binary[p]===binary[p+w]&&binary[p]===binary[p+w+1])continue;
      const values = [coverage[p], coverage[p + 1], coverage[p + w + 1], coverage[p + w]];
      const points = [[x,y],[x+1,y],[x+1,y+1],[x,y+1]], crossings = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4; if ((values[i] >= .5) === (values[j] >= .5)) continue;
        const t = (.5 - values[i]) / (values[j] - values[i]);
        crossings.push([points[i][0] + (points[j][0] - points[i][0]) * t, points[i][1] + (points[j][1] - points[i][1]) * t]);
      }
      if (crossings.length === 2) segment(crossings[0], crossings[1]);
      else if (crossings.length === 4) {
        if ((values[0] >= .5) === (values.reduce((a,b)=>a+b,0) >= 2)) { segment(crossings[0],crossings[1]); segment(crossings[2],crossings[3]); }
        else { segment(crossings[0],crossings[3]); segment(crossings[1],crossings[2]); }
      }
    }
    const toOutside = distanceTransform(binary, w, h, 0), toInside = distanceTransform(binary, w, h, 1);
    const fine = {width:fw,height:fh,scale,distance:new Float32Array(fw*fh),nx:new Float32Array(fw*fh),ny:new Float32Array(fw*fh)};
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const px=x+1, py=y+1, p=py*w+px, sign=binary[p]?1:-1;
      let d=Math.sqrt(binary[p]?toOutside[p]:toInside[p])-.5;
      if (d < 6) {
        const bx=Math.floor(px/binSize),by=Math.floor(py/binSize);let best=Infinity;
        for(let yy=Math.max(0,by-1);yy<=by+1;yy++)for(let xx=Math.max(0,bx-1);xx<=Math.min(binsWide-1,bx+1);xx++){
          const candidates=bins.get(yy*binsWide+xx);if(!candidates)continue;
          for(const [ax,ay,bx2,by2] of candidates){const dx=bx2-ax,dy=by2-ay,t=clamp(((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1),0,1);best=Math.min(best,(px-ax-t*dx)**2+(py-ay-t*dy)**2);}
        }
        // Join the exact narrow band continuously to EDT's inexpensive far field.
        if(Number.isFinite(best)){const weight=1-smoothstep(4,6,d);d=d*(1-weight)+Math.sqrt(best)*weight;}
      }
      fine.distance[y*fw+x]=sign*d/scale;
    }
    const read=(x,y)=>fine.distance[clamp(y,0,fh-1)*fw+clamp(x,0,fw-1)];
    for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){
      const dx=read(x+1,y)-read(x-1,y),dy=read(x,y+1)-read(x,y-1),length=Math.hypot(dx,dy),p=y*fw+x;
      fine.nx[p]=length>1e-6?-dx/length:0;fine.ny[p]=length>1e-6?-dy/length:0;
    }
    const distance=new Float32Array(WIDTH*HEIGHT),nx=new Float32Array(WIDTH*HEIGHT),ny=new Float32Array(WIDTH*HEIGHT);
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){const p=y*WIDTH+x;distance[p]=fineSample(fine,'distance',x,y);nx[p]=fineSample(fine,'nx',x,y);ny[p]=fineSample(fine,'ny',x,y);}
    const result = { mask, fineMask, fine, descriptor, distance, nx, ny, coverage: covered / (fw * fh), source: options.alphaMask ? 'alpha-mask' : options.customPath ? 'custom-path' : 'builtin' };
    if(options.immutableMask && options.alphaMask)immutableGeometryCache.set(options.alphaMask,result);
    if (key) { if (geometryCache.size >= 4) geometryCache.delete(geometryCache.keys().next().value); geometryCache.set(key, result); } return result;
  }
  function field(ctx, x, y, rx, ry, hex, strength, softness) {
    if (strength <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1), soft = softness / 100;
    // Continuous falloff: avoid the old abrupt shoulder around radius 0.88.
    for(let i=0;i<=64;i++){
      const r=i/64,gaussian=(Math.exp(-5.5*r*r)-Math.exp(-5.5))/(1-Math.exp(-5.5));
      const firm=1-smoothstep(0.65,1,r);
      gradient.addColorStop(r,rgba(hex,strength*(gaussian*soft+firm*(1-soft))));
    }
    ctx.fillStyle = gradient; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  function palette(options) { return { accent: options.accent, secondary: options.secondary }; }
  function backdrop(width, height, options) {
    const canvas = surface(width, height), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, colors = palette(options);
    const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#0D1526'); bg.addColorStop(0.48, '#080D19'); bg.addColorStop(1, '#070A11'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen'; field(ctx, w * 0.77, h * 0.16, w * 0.54, h * 0.64, colors.accent, 0.19, 100);
    if (options.effect === 'glass') {
      ctx.save(); ctx.translate(w * 0.51, h * 0.49); ctx.rotate(-0.34);
      for (let i = 0; i < 4; i++) { const x = (i - 1.55) * w * 0.17, beam = ctx.createLinearGradient(x - w * 0.05, 0, x + w * 0.07, 0); beam.addColorStop(0, rgba(colors.accent, 0)); beam.addColorStop(0.37, rgba(colors.accent, 0.36)); beam.addColorStop(0.55, rgba(colors.secondary, 0.65)); beam.addColorStop(0.72, rgba(colors.accent, 0.18)); beam.addColorStop(1, rgba(colors.accent, 0)); ctx.fillStyle = beam; ctx.fillRect(x - w * 0.05, -h, w * 0.12, h * 2); }
      ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(190,214,255,0.07)'; ctx.lineWidth = Math.max(0.7, w / 900); const step = w / 16;
      for (let x = 0; x <= w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y <= h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }
    ctx.globalCompositeOperation = 'source-over'; return canvas;
  }
  function bilinear(array, x, y) {
    x=clamp(x,0,WIDTH-1.001);y=clamp(y,0,HEIGHT-1.001);
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,p=iy*WIDTH+ix;
    return (array[p]*(1-fx)+array[p+1]*fx)*(1-fy)+(array[p+WIDTH]*(1-fx)+array[p+WIDTH+1]*fx)*fy;
  }
  function sampleGrid(array, width, height, x, y) {
    x=clamp(x,0,width-1.001);y=clamp(y,0,height-1.001);
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,p=iy*width+ix;
    return (array[p]*(1-fx)+array[p+1]*fx)*(1-fy)+(array[p+width]*(1-fx)+array[p+width+1]*fx)*fy;
  }
  function fineSample(fine, field, x, y) {
    return sampleGrid(fine[field],fine.width,fine.height,(x+.5)*fine.scale-.5,(y+.5)*fine.scale-.5);
  }
  function sceneFor(width, height, options) {
    if (!options.backgroundCanvas) return backdrop(width, height, options);
    const canvas = surface(width, height);
    canvas.getContext('2d').drawImage(options.backgroundCanvas, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function sampleChannel(data, width, height, x, y, channel) {
    // Source coordinates describe pixel centers, rather than array indices.
    x = clamp(x - 0.5, 0, width - 1); y = clamp(y - 0.5, 0, height - 1);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const right = Math.min(ix + 1, width - 1), down = Math.min(iy + 1, height - 1);
    const a = (iy * width + ix) * 4 + channel, b = (iy * width + right) * 4 + channel;
    const c = (down * width + ix) * 4 + channel, d = (down * width + right) * 4 + channel;
    return (data[a] * (1 - fx) + data[b] * fx) * (1 - fy) + (data[c] * (1 - fx) + data[d] * fx) * fy;
  }
  function rayOffset(ior, normalXY, normalZ, travel) {
    // Snell refraction of I=(0,0,-1) through the rounded front surface.
    // Surface normals point out of the actual mask, including toward holes.
    const eta = 1 / ior, k = Math.max(0, 1 - eta * eta * (1 - normalZ * normalZ));
    const coefficient = eta * normalZ - Math.sqrt(k);
    const rayZ = -eta + coefficient * normalZ;
    return coefficient * normalXY / Math.max(0.001, -rayZ) * travel;
  }
  function opticalNormals(geometry) {
    if (geometry.opticalNormals) return geometry.opticalNormals;
    const fine=geometry.fine,{width,height,scale}=fine,nx=new Float32Array(width*height),ny=new Float32Array(width*height),temporary=new Float32Array(width*height);
    boxBlurHorizontal(fine.nx,temporary,width,height,2*scale);boxBlurVertical(temporary,nx,width,height,2*scale);
    boxBlurHorizontal(fine.ny,temporary,width,height,2*scale);boxBlurVertical(temporary,ny,width,height,2*scale);
    geometry.opticalNormals = { nx, ny, width, height, scale }; return geometry.opticalNormals;
  }
  function smoothstep(lo, hi, value) { const t = clamp((value - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); }
  function referenceSlopeBlur(input) {
    // These seven bilinear shader taps reduce to this symmetric 13-tap kernel
    // at the reference displacementBlur=6 logical pixels.
    const offsets = [1.4584295, 3.4039848, 5.3518057], weights = [0.23933733, 0.1394403, 0.052710965];
    const kernel = new Float64Array(7); kernel[0] = 0.13702282;
    for (let i = 0; i < offsets.length; i++) { const floor = Math.floor(offsets[i]), fraction = offsets[i] - floor; kernel[floor] += weights[i] * (1 - fraction); kernel[floor + 1] += weights[i] * fraction; }
    const horizontal = new Float32Array(WIDTH * HEIGHT), output = new Float32Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const p = y * WIDTH + x; let value = input[p] * kernel[0];
      for (let r = 1; r <= 6; r++) { if (x >= r) value += input[p - r] * kernel[r]; if (x + r < WIDTH) value += input[p + r] * kernel[r]; }
      horizontal[p] = value;
    }
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const p = y * WIDTH + x; let value = horizontal[p] * kernel[0];
      for (let r = 1; r <= 6; r++) { if (y >= r) value += horizontal[p - r * WIDTH] * kernel[r]; if (y + r < HEIGHT) value += horizontal[p + r * WIDTH] * kernel[r]; }
      output[p] = value;
    }
    return output;
  }
  function opticalSlopeField(geometry, bezel) {
    if (!geometry.slopeFields) geometry.slopeFields = new Map();
    if (geometry.slopeFields.has(bezel)) return geometry.slopeFields.get(bezel);
    const count = WIDTH * HEIGHT, x = new Float32Array(count), y = new Float32Array(count), alpha = new Float32Array(count);
    const mask = geometry.mask.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
    for (let p = 0; p < count; p++) {
      const coverage = mask[p * 4 + 3] / 255, inward = Math.max(0, geometry.distance[p]); alpha[p] = coverage;
      if (bezel <= 0 || inward > bezel || coverage <= 0) continue;
      const u = 1 - clamp(inward / bezel, 0, 1), height = Math.sqrt(Math.max(1 - u * u * u * u, 0.0001));
      const slope = Math.min(2 * u * u * u / height, Math.tan(85 * Math.PI / 180));
      x[p] = geometry.nx[p] * slope * coverage; y[p] = geometry.ny[p] * slope * coverage;
    }
    const result = { x: referenceSlopeBlur(x), y: referenceSlopeBlur(y), alpha: referenceSlopeBlur(alpha) };
    if (geometry.slopeFields.size >= 4) geometry.slopeFields.delete(geometry.slopeFields.keys().next().value);
    geometry.slopeFields.set(bezel, result); return result;
  }
  function sampleGlass(source, card, options, scale, geometry) {
    const out = surface(WIDTH * scale, HEIGHT * scale), ctx = out.getContext('2d'); let samplingSource = source;
    // Preserve fine adjustment at the clear end; allow broad lettering to dissolve at the frosted end.
    const blurAmount=options.blur/100;
    if (blurAmount > 0) samplingSource = blurSurface(source,(32*blurAmount+40*blurAmount*blurAmount)*source.width/900,true);
    const input = samplingSource.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    const result = ctx.createImageData(out.width, out.height), output = result.data;
    const strength = options.refraction / 100 * 0.4, thickness = options.thickness, bezel = options.bezelWidth, dispersion = options.dispersion / 100 * (0.05 / 0.28), slopeField = opticalSlopeField(geometry, bezel);
    const iors = [Math.max(1.0001, 1 + strength + dispersion), Math.max(1.0001, 1 + strength), Math.max(1.0001, 1 + strength - dispersion)];
    const sx = card.w / WIDTH, sy = card.h / HEIGHT, sw = source.width, sh = source.height;
    for (let y = 0; y < out.height; y++) { const py = (y + 0.5) / scale;
      for (let x = 0; x < out.width; x++) {
        const px = (x + 0.5) / scale;
        let sdf=bilinear(geometry.distance,px-.5,py-.5);if(sdf < -3)continue;
        if(sdf<3)sdf=fineSample(geometry.fine,'distance',px-.5,py-.5);if(sdf < -2)continue;
        const fieldAlpha = bilinear(slopeField.alpha, px - 0.5, py - 0.5);
        const slopeX = fieldAlpha > 0.000001 ? bilinear(slopeField.x, px - 0.5, py - 0.5) / fieldAlpha : 0;
        const slopeY = fieldAlpha > 0.000001 ? bilinear(slopeField.y, px - 0.5, py - 0.5) / fieldAlpha : 0;
        const planarLength = Math.hypot(slopeX, slopeY), norm = Math.sqrt(1 + planarLength * planarLength), normalXY = planarLength / norm, nz = 1 / norm;
        const nx = planarLength > 0.000001 ? slopeX / planarLength : 0, ny = planarLength > 0.000001 ? slopeY / planarLength : 0;
        const u = bezel > 0 ? 1 - clamp(Math.max(0, sdf) / bezel, 0, 1) : 0;
        const profileHeight = bezel > 0 ? Math.sqrt(Math.max(1 - u * u * u * u, 0.0001)) * bezel : 0;
        const travel = thickness + profileHeight;
        const dest = (y * out.width + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const offset = strength > 0 && bezel > 0 ? rayOffset(iors[ch], normalXY, nz, travel) : 0;
          output[dest + ch] = sampleChannel(input, sw, sh, card.x + (px + nx * offset) * sx, card.y + (py + ny * offset) * sy, ch);
        }
        output[dest + 3] = 255;
      }
    }
    ctx.putImageData(result, 0, 0); return { canvas: out, transmitted: output, sourcePixels: input, sourceWidth: sw, sourceHeight: sh };
  }
  function compositeGlassRim(canvas, glass, card, options, scale, geometry) {
    const ctx = canvas.getContext('2d'), result = ctx.getImageData(0, 0, canvas.width, canvas.height), pixels = result.data;
    const color = rgb(options.secondary), highlight = options.highlight / 100, reflectionStrength = options.fresnel / 100, normals = opticalNormals(geometry);
    let lx = (options.lightX / 100 - 0.5) * 2, ly = (options.lightY / 100 - 0.5) * 2;
    let planarLength = Math.hypot(lx, ly); if (planarLength < 0.01) { lx = -0.7; ly = -0.7; planarLength = 1; }
    lx /= planarLength; ly /= planarLength;
    const sx = card.w / WIDTH, sy = card.h / HEIGHT, sw = glass.sourceWidth, sh = glass.sourceHeight;
    const reflected = [0, 0, 0];
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const px = (x + 0.5) / scale - 0.5, py = (y + 0.5) / scale - 0.5;
      if(Math.abs(bilinear(geometry.distance,px,py))>4+1/scale)continue;
      const dist = fineSample(geometry.fine, 'distance', px, py);
      if (dist < -1-1/scale || dist > 2+1/scale) continue;
      let nx = fineSample(normals, 'nx', px, py), ny = fineSample(normals, 'ny', px, py), normalLength = Math.hypot(nx, ny);
      if (normalLength < 0.05) continue; nx /= normalLength; ny /= normalLength;
      // Integrate only the narrow rim over the output pixel's footprint.
      // Its width remains in material coordinates at every preview/export scale.
      const facing=Math.abs(nx*lx+ny*ly)**3,offset=.25/scale;let combined=0;
      for(const dx of [-offset,offset])for(const dy of [-offset,offset]){
        const d=fineSample(geometry.fine,'distance',px+dx,py+dy),inward=Math.max(0,d);
        const rim=(1-smoothstep(0,1,-d))*(1-smoothstep(1,2,inward));
        combined+=clamp(facing*(1.5-clamp(inward,0,1)**2),0,1)*rim*.25;
      }
      const p = (y * canvas.width + x) * 4;
      if (combined <= 0) continue;
      const rx = card.x + (px + 0.5 + nx * 18) * sx, ry = card.y + (py + 0.5 + ny * 18) * sy;
      for (let ch = 0; ch < 3; ch++) reflected[ch] = sampleChannel(glass.sourcePixels, sw, sh, rx, ry, ch);
      const refractedLuma = (glass.transmitted[p] * 0.2126 + glass.transmitted[p + 1] * 0.7152 + glass.transmitted[p + 2] * 0.0722) / 255;
      const reflectedLuma = (reflected[0] * 0.2126 + reflected[1] * 0.7152 + reflected[2] * 0.0722) / 255;
      const gate = smoothstep(0.2, 0.85, reflectedLuma) * (1 - smoothstep(0.35, 0.85, refractedLuma));
      const coloredEdgeOpacity = combined * reflectionStrength, whiteSpecular = combined * 0.5 * highlight;
      // `fresnel` is retained for saved-preset compatibility, but now means
      // reflection strength. This is the reference luma-gated rim, not Schlick.
      for (let ch = 0; ch < 3; ch++) {
        const edgeColor = glass.transmitted[p + ch] * (1 - gate) + reflected[ch] * gate;
        pixels[p + ch] = pixels[p + ch] * (1 - coloredEdgeOpacity) + edgeColor * coloredEdgeOpacity + color[ch] * whiteSpecular;
      }
    }
    ctx.putImageData(result, 0, 0);
  }
  function edgeLayer(options, scale, geometry) {
    // High-contrast gradient rims need subpixel contours too. A binary 600px
    // distance field creates visible normal-direction steps when exported large.
    const contour=geometry.fine?geometry:shapeGeometry({...options,effect:'glass'}), normals=opticalNormals(contour);
    const out = surface(WIDTH * scale, HEIGHT * scale), ctx = out.getContext('2d'), result = ctx.createImageData(out.width, out.height), pixels = result.data, colors = palette(options), lightColor = rgb(colors.secondary), accent = rgb(colors.accent), h = options.highlight / 100, glow = options.glow / 100;
    let lx = options.lightX / 100 - 0.5, ly = options.lightY / 100 - 0.5, ll = Math.hypot(lx, ly); if (ll < 0.01) { lx = -0.7; ly = -0.7; ll = 1; } lx /= ll; ly /= ll;
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      const px = (x + 0.5) / scale - 0.5, py = (y + 0.5) / scale - 0.5;
      let dist=bilinear(contour.distance,px,py);if(dist < -2 || dist > 35)continue;
      if(dist < 3)dist=fineSample(contour.fine,'distance',px,py);
      const nx=fineSample(normals,'nx',px,py),ny=fineSample(normals,'ny',px,py),length=Math.hypot(nx,ny)||1,dot=(nx*lx+ny*ly)/length;
      const sharp = Math.exp(-Math.max(0, dist) / 1.2) * h * (0.17 + 0.83 * Math.pow(Math.max(0, dot), 2)), soft = Math.exp(-Math.max(0, dist) / 7) * glow * h * 0.12;
      const lens = options.effect === 'glass' ? Math.exp(-Math.pow((dist - 8) / 6, 2)) * options.refraction / 100 * h * 0.11 * Math.max(0, dot) : 0;
      const alpha = clamp(sharp + soft + lens, 0, 1), p = (y * out.width + x) * 4;
      for (let c = 0; c < 3; c++) pixels[p + c] = alpha > 0 ? ((lightColor[c] * 0.55 + 255 * 0.45) * (sharp + lens) + accent[c] * soft) / alpha : 0; pixels[p + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(result, 0, 0); return out;
  }
  function noise(ctx, amount) {
    if (amount <= 0) return;
    if (!grainTile) { grainTile = surface(160, 160); const c = grainTile.getContext('2d'), data = c.createImageData(160, 160); let state = 73419;
      for (let i = 0; i < data.data.length; i += 4) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const v = state >>> 24; data.data[i] = v; data.data[i + 1] = v; data.data[i + 2] = v; data.data[i + 3] = 255; } c.putImageData(data, 0, 0); }
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = amount / 100 * 0.65; ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, WIDTH, HEIGHT); ctx.restore();
  }
  function boxBlurHorizontal(source, target, w, h, radius, extend=false) {
    const inverse = 1 / (radius * 2 + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w; let sum = 0;
      if(extend){for(let x=-radius;x<=radius;x++)sum+=source[row+clamp(x,0,w-1)];}
      else for (let x = 0; x <= Math.min(radius, w - 1); x++) sum += source[row + x];
      for (let x = 0; x < w; x++) {
        target[row + x] = sum * inverse;
        if(extend){sum+=source[row+Math.min(x+radius+1,w-1)]-source[row+Math.max(x-radius,0)];}
        else{if (x + radius + 1 < w) sum += source[row + x + radius + 1];
        if (x - radius >= 0) sum -= source[row + x - radius];}
      }
    }
  }
  function boxBlurVertical(source, target, w, h, radius, extend=false) {
    const inverse = 1 / (radius * 2 + 1);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      if(extend){for(let y=-radius;y<=radius;y++)sum+=source[clamp(y,0,h-1)*w+x];}
      else for (let y = 0; y <= Math.min(radius, h - 1); y++) sum += source[y * w + x];
      for (let y = 0; y < h; y++) {
        target[y * w + x] = sum * inverse;
        if(extend){sum+=source[Math.min(y+radius+1,h-1)*w+x]-source[Math.max(y-radius,0)*w+x];}
        else{if (y + radius + 1 < h) sum += source[(y + radius + 1) * w + x];
        if (y - radius >= 0) sum -= source[(y - radius) * w + x];}
      }
    }
  }
  function gaussianPlane(values,scratch,w,h,sigma,extend=false){
    let lower=Math.max(1,Math.floor(Math.sqrt(4*sigma*sigma+1)));if(lower%2===0)lower--;
    const count=clamp(Math.round((12*sigma*sigma-3*lower*lower-12*lower-9)/(-4*lower-4)),0,3);
    for(let pass=0;pass<3;pass++){
      const radius=((pass<count?lower:lower+2)-1)/2;
      boxBlurHorizontal(values,scratch,w,h,radius,extend);boxBlurVertical(scratch,values,w,h,radius,extend);
    }
  }
  function blurSurface(source,sigma,extend=false){
    // Same pixel implementation in WebKit, Chromium and workers; no silent ctx.filter fallback.
    // Large blur kernels can be evaluated on a smaller image without discarding sharp-background detail.
    const factor=Math.max(1,Math.floor(sigma/4)),small=surface(source.width/factor,source.height/factor);
    const c=small.getContext('2d');c.drawImage(source,0,0,small.width,small.height);
    const w=small.width,h=small.height,n=w*h,input=c.getImageData(0,0,w,h),out=c.createImageData(w,h);
    const values=new Float32Array(n),scratch=new Float32Array(n),alpha=new Float32Array(n),scaledSigma=sigma*w/source.width;
    for(let i=0;i<n;i++)alpha[i]=input.data[i*4+3];
    gaussianPlane(alpha,scratch,w,h,scaledSigma,extend);
    for(let ch=0;ch<3;ch++){
      for(let i=0;i<n;i++)values[i]=input.data[i*4+ch]*input.data[i*4+3]/255;
      gaussianPlane(values,scratch,w,h,scaledSigma,extend);
      for(let i=0;i<n;i++)out.data[i*4+ch]=alpha[i]>0.001?values[i]*255/alpha[i]:0;
    }
    for(let i=0;i<n;i++)out.data[i*4+3]=alpha[i];c.putImageData(out,0,0);
    if(factor===1)return small;
    const result=surface(source.width,source.height);result.getContext('2d').drawImage(small,0,0,result.width,result.height);return result;
  }
  const lightCache=new Map();
  const tintCache=new WeakMap();
  function tintLight(mask,color){
    let cached=tintCache.get(mask);if(cached&&cached.color===color)return cached.canvas;
    const canvas=cached?cached.canvas:surface(mask.width,mask.height),ctx=canvas.getContext('2d');
    ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';
    tintCache.set(mask,{canvas,color});return canvas;
  }
  function lightLayer(item){
    const key=[item.x,item.y,item.sizeX,item.sizeY,item.blur,item.rotation||0].join('|');
    if(lightCache.has(key))return lightCache.get(key);
    const sigma=item.blur/100*16,pad=Math.ceil(sigma*3)+2,w=WIDTH+pad*2,h=HEIGHT+pad*2;
    const canvas=surface(w,h),ctx=canvas.getContext('2d');
    // Evaluate the light field in float precision, without native radial-gradient interpolation,
    // an ellipse cutoff or an 8-bit alpha intermediate before convolution.
    const image=ctx.createImageData(w,h),values=new Float32Array(w*h),scratch=new Float32Array(w*h),color=[255,255,255];
    const cx=pad+WIDTH*item.x/100,cy=pad+HEIGHT*item.y/100,rx=WIDTH*item.sizeX/200,ry=HEIGHT*item.sizeY/200,power=6-4*item.blur/100;
    const angle=(item.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const dx=x+.5-cx,dy=y+.5-cy;
      const radius=Math.hypot((dx*c+dy*s)/rx,(-dx*s+dy*c)/ry);
      values[y*w+x]=Math.exp(-2*Math.pow(radius,power));
    }
    if(sigma>0)gaussianPlane(values,scratch,w,h,sigma);
    for(let i=0;i<values.length;i++){
      const p=i*4;image.data[p]=color[0];image.data[p+1]=color[1];image.data[p+2]=color[2];
      // Deterministic sub-level dither suppresses contour bands without animated noise.
      let hash=Math.imul(i+1,1597334677);hash=Math.imul(hash^(hash>>>16),2246822519);
      image.data[p+3]=values[i]*255+(hash>>>0)/4294967296-.5;
    }
    ctx.putImageData(image,0,0);
    const result={canvas,pad};if(lightCache.size>=24)lightCache.delete(lightCache.keys().next().value);lightCache.set(key,result);return result;
  }
  function contourLayer(item,geometry){
    // The distance field follows the actual silhouette. A broad spatial light field
    // selects which part of that silhouette receives light, with no angular seams.
    if(!geometry.contourLayers)geometry.contourLayers=new Map();
    const key=[item.x,item.y,item.sizeX,item.sizeY,item.blur,item.edgeWidth,item.edgeInset||0,item.rotation||0].join('|');
    if(geometry.contourLayers.has(key))return geometry.contourLayers.get(key);
    const field=geometry.fine||{width:WIDTH,height:HEIGHT,scale:1,distance:geometry.distance};
    const {width:fw,height:fh,scale}=field;
    const canvas=surface(fw,fh),ctx=canvas.getContext('2d'),image=ctx.createImageData(fw,fh),channels=[255,255,255];
    const cx=WIDTH*item.x/100,cy=HEIGHT*item.y/100,rx=WIDTH*item.sizeX/200,ry=HEIGHT*item.sizeY/200;
    const width=item.edgeWidth*1.5,soft=item.blur/100,power=5-3*soft;
    const angle=(item.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){
      const i=y*fw+x,distance=field.distance[i];if(distance < -1)continue;
      const dx=(x+.5)/scale-cx,dy=(y+.5)/scale-cy;
      const radiusSquared=((dx*c+dy*s)/rx)**2+((-dx*s+dy*c)/ry)**2;
      const spatial=Math.exp(-1.35*radiusSquared);
      // At maximum softness the inward falloff is Gaussian; keep full float
      // precision until the final alpha conversion and use stable sub-level dither.
      const inward=Math.exp(-Math.pow(Math.abs(Math.max(0,distance)-(item.edgeInset||0))/width,power));
      let hash=Math.imul(i+1,1597334677);hash=Math.imul(hash^(hash>>>16),2246822519);
      const p=i*4;image.data[p]=channels[0];image.data[p+1]=channels[1];image.data[p+2]=channels[2];
      image.data[p+3]=spatial*inward*255+(hash>>>0)/4294967296-.5;
    }
    ctx.putImageData(image,0,0);
    if(geometry.contourLayers.size>=8)geometry.contourLayers.delete(geometry.contourLayers.keys().next().value);
    geometry.contourLayers.set(key,canvas);return canvas;
  }
  function sampleWithTransparentBorder(data, w, h, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const get = (px, py) => px < 0 || py < 0 || px >= w || py >= h ? 0 : data[py * w + px];
    return (get(ix, iy) * (1 - fx) + get(ix + 1, iy) * fx) * (1 - fy) + (get(ix, iy + 1) * (1 - fx) + get(ix + 1, iy + 1) * fx) * fy;
  }
  function insetField(item, geometry) {
    const key = [item.offsetX, item.offsetY, item.spread, item.blur].join('|');
    if (!geometry.insetFields) geometry.insetFields = new Map();
    if (geometry.insetFields.has(key)) return geometry.insetFields.get(key);
    // Erosion follows the real silhouette, including concave and hole edges.
    const eroded = new Float32Array(WIDTH * HEIGHT);
    for (let i = 0; i < eroded.length; i++) eroded[i] = clamp(geometry.distance[i] - item.spread + 0.5, 0, 1);
    // Keep the shifted mask outside the visible box until after blurring. Without
    // padding, a shifted shape touching the box would acquire a false far rim.
    const pad = Math.ceil(item.blur * 3 + Math.max(Math.abs(item.offsetX), Math.abs(item.offsetY))) + 2;
    const w = WIDTH + pad * 2, h = HEIGHT + pad * 2, shifted = new Float32Array(w * h);
    if (Number.isInteger(item.offsetX) && Number.isInteger(item.offsetY)) {
      for (let y = 0; y < HEIGHT; y++) {
        const start = (y + pad + item.offsetY) * w + pad + item.offsetX;
        shifted.set(eroded.subarray(y * WIDTH, (y + 1) * WIDTH), start);
      }
    } else {
      const x0 = Math.floor(pad + item.offsetX) - 1, x1 = Math.ceil(pad + item.offsetX + WIDTH) + 1;
      const y0 = Math.floor(pad + item.offsetY) - 1, y1 = Math.ceil(pad + item.offsetY + HEIGHT) + 1;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) shifted[y * w + x] = sampleWithTransparentBorder(eroded, WIDTH, HEIGHT, x - pad - item.offsetX, y - pad - item.offsetY);
    }
    if (item.blur > 0) {
      // Three separable box passes approximate a Gaussian with sigma=blur.
      // Running sums keep a 100px blur linear in the number of mask pixels.
      let lower = Math.floor(Math.sqrt(4 * item.blur * item.blur + 1));
      if (lower % 2 === 0) lower--;
      lower = Math.max(1, lower);
      const count = clamp(Math.round((12 * item.blur * item.blur - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4)), 0, 3);
      const scratch = new Float32Array(w * h);
      for (let pass = 0; pass < 3; pass++) {
        const radius = ((pass < count ? lower : lower + 2) - 1) / 2;
        boxBlurHorizontal(shifted, scratch, w, h, radius);
        boxBlurVertical(scratch, shifted, w, h, radius);
      }
    }
    const inset = new Float32Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) inset[y * WIDTH + x] = clamp(1 - shifted[(y + pad) * w + x + pad], 0, 1);
    if (geometry.insetFields.size >= 4) geometry.insetFields.delete(geometry.insetFields.keys().next().value);
    geometry.insetFields.set(key, inset); return inset;
  }
  function innerShadowLayer(item, geometry) {
    const angle=(item.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    item={...item,offsetX:item.offsetX*c-item.offsetY*s,offsetY:item.offsetX*s+item.offsetY*c};
    const field = insetField(item, geometry), canvas = surface(WIDTH, HEIGHT), ctx = canvas.getContext('2d'), result = ctx.createImageData(WIDTH, HEIGHT), pixels = result.data, channels = rgb(item.color);
    for (let i = 0; i < field.length; i++) {
      const p = i * 4; pixels[p] = channels[0]; pixels[p + 1] = channels[1]; pixels[p + 2] = channels[2]; pixels[p + 3] = Math.round(field[i] * 255);
    }
    ctx.putImageData(result, 0, 0); return canvas;
  }
  function compositeLinear(ctx,source,opacity,mode) {
    // Canvas lacks linear burn/dodge. Composite unassociated color with source-over
    // alpha explicitly, so transparent backgrounds and partial opacity remain correct.
    const dest=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height),a=dest.data;
    const b=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    for(let i=0;i<a.length;i+=4){
      const sa=b[i+3]/255*opacity,da=a[i+3]/255;if(sa===0)continue;
      const alpha=sa+da*(1-sa);
      for(let k=0;k<3;k++){
        const cb=a[i+k]/255,cs=b[i+k]/255;
        const blend=mode==='linear-burn'?Math.max(0,cb+cs-1):Math.min(1,cb+cs);
        a[i+k]=255*((1-sa)*da*cb+sa*((1-da)*cs+da*blend))/alpha;
      }
      a[i+3]=255*alpha;
    }
    ctx.putImageData(dest,0,0);
  }
  function material(options, scale, source, card, geometry) {
    const canvas = surface(WIDTH * scale, HEIGHT * scale), ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    let glass=null;
    if(options.effect==='glass'){
      const key=[scale,source.width,source.height,card.x,card.y,card.w,card.h,options.refraction,options.blur,options.thickness,options.bezelWidth,options.dispersion].join('|');
      const cached=geometry.glassSample;
      if(options.immutableMask&&options.backgroundCanvas&&cached?.source===options.backgroundCanvas&&cached.key===key)glass=cached.value;
      else{glass=sampleGlass(source,card,options,scale,geometry);if(options.immutableMask&&options.backgroundCanvas)geometry.glassSample={source:options.backgroundCanvas,key,value:glass};}
    }
    if (glass) ctx.drawImage(glass.canvas, 0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = rgba(options.base, options.opacity / 100); ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const item of options.layers) {
      if (!item.enabled || item.opacity <= 0) continue;
      if (item.type === 'inner-shadow' && item.blur === 0 && item.spread === 0 && item.offsetX === 0 && item.offsetY === 0) continue;
      const manual=item.blendMode==='linear-burn'||item.blendMode==='linear-dodge';
      const target=manual?surface(canvas.width,canvas.height):canvas,layerCtx=target.getContext('2d');
      layerCtx.save();if(manual)layerCtx.scale(scale,scale);
      layerCtx.globalCompositeOperation=manual||['normal','pass-through'].includes(item.blendMode)?'source-over':item.blendMode;
      const opacity=item.opacity/100*(item.type==='inner-shadow'?1:options.glow/100);
      layerCtx.globalAlpha=manual?1:opacity;
      if (item.type === 'inner-shadow') {
        layerCtx.drawImage(innerShadowLayer(item, geometry), 0, 0, WIDTH, HEIGHT);
      } else if(item.profile==='contour'){
        layerCtx.drawImage(tintLight(contourLayer(item,geometry),item.color),0,0,WIDTH,HEIGHT);
      } else {
        const light=lightLayer(item);
        layerCtx.drawImage(tintLight(light.canvas,item.color),-light.pad,-light.pad);
      }
      layerCtx.restore();if(manual)compositeLinear(ctx,target,opacity,item.blendMode);
    }
    noise(ctx, options.grain);
    if (glass) compositeGlassRim(canvas, glass, card, options, scale, geometry);
    else if(options.highlight>0) { ctx.globalCompositeOperation = 'screen'; ctx.drawImage(edgeLayer(options, scale, geometry), 0, 0, WIDTH, HEIGHT); }
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(scale === 1 ? geometry.mask : drawMask(options, scale, geometry.descriptor), 0, 0, WIDTH, HEIGHT); ctx.globalCompositeOperation = 'source-over'; return canvas;
  }
  function demoContent(ctx, options, screenScale) {
    const colors = palette(options), readable = Math.max(17, 11 / Math.max(0.28, screenScale));
    ctx.save();
    if (options.effect === 'glass') {
      ctx.font = '500 ' + Math.max(26, readable + 1) + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fillText('让背景，流经形状', 42, 70);
      ctx.font = readable + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(245,249,255,0.72)'; ctx.fillText('LIQUID GLASS / 01', 44, 108);
      ctx.restore(); return;
    }
    if (screenScale >= 0.5) {
      ctx.font = '500 ' + readable + 'px "Segoe UI", sans-serif'; ctx.letterSpacing = '2px';
      ctx.fillStyle = 'rgba(205,222,255,0.61)'; ctx.fillText('MATERIAL / 01', 42, 51);
    }
    ctx.letterSpacing = '0px';
    ctx.font = '500 ' + Math.max(31, readable + 2) + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillStyle = '#F3F6FF'; ctx.fillText('光，从形状中浮现', 40, 103);
    ctx.font = readable + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(205,217,242,0.72)'; ctx.fillText('多层色光 · 柔和边缘', 42, 147);
    ctx.save(); ctx.translate(41, 192); ctx.strokeStyle = 'rgba(177,201,255,0.065)'; ctx.lineWidth = 1;
    for (let x = 0; x <= 518; x += 52) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 147); ctx.stroke(); }
    for (let y = 0; y <= 147; y += 37) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(518, y); ctx.stroke(); }
    const graph = ctx.createLinearGradient(0, 0, 518, 0); graph.addColorStop(0, rgba(colors.accent, 0.16)); graph.addColorStop(0.58, rgba(colors.secondary, 0.98)); graph.addColorStop(1, rgba(colors.accent, 0.23)); ctx.strokeStyle = graph; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(0, 115); ctx.bezierCurveTo(68, 107, 64, 76, 118, 95); ctx.bezierCurveTo(190, 133, 218, 131, 255, 54); ctx.bezierCurveTo(284, -10, 307, 6, 324, 66); ctx.bezierCurveTo(356, 147, 428, 108, 518, 79); ctx.stroke();
    ctx.globalCompositeOperation = 'screen'; field(ctx, 294, 24, 24, 24, colors.accent, 0.8, 100); ctx.fillStyle = colors.secondary; ctx.beginPath(); ctx.arc(294, 24, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.font = '500 ' + readable + 'px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.letterSpacing = '0px'; ctx.fillStyle = 'rgba(245,250,255,0.83)';
    ctx.fillText('01 / 色光', 42, 412); ctx.fillText('02 / 质感', 315, 412); ctx.restore();
  }
  function cardGeometry(width,height,aspect=WIDTH/HEIGHT){
    if(!Number.isFinite(aspect)||aspect<=0)aspect=WIDTH/HEIGHT;
    const w=Math.min(width*.72,height*.72*aspect),h=w/aspect;
    return {x:(width-w)/2,y:(height-h)/2,w,h,scale:Math.max(w/WIDTH,h/HEIGHT)};
  }
  function samplingCard(width,height,rect){
    if(rect&&['x','y','w','h'].every(k=>Number.isFinite(rect[k]))&&rect.x>=0&&rect.y>=0&&rect.w>0&&rect.h>0&&rect.x+rect.w<=1.00001&&rect.y+rect.h<=1.00001)
      return {x:rect.x*width,y:rect.y*height,w:rect.w*width,h:rect.h*height};
    return cardGeometry(width,height);
  }
  function render(canvas, input) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('MaterialLab.render requires a canvas.');
    const options = normalize(input), ctx = canvas.getContext('2d'), w = canvas.width || 900, h = canvas.height || 720, card = cardGeometry(w, h, options.previewAspect), geometry = shapeGeometry(options), scene = sceneFor(w, h, options);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.drawImage(scene, 0, 0);
    const texture = material(options, Math.max(1, card.scale), scene, card, geometry);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40 * card.scale; ctx.shadowOffsetY = 20 * card.scale; ctx.drawImage(texture, card.x, card.y, card.w, card.h); ctx.restore();
    if (options.content) { ctx.save(); ctx.translate(card.x, card.y); ctx.scale(card.scale, card.scale); demoContent(ctx, options, card.scale * (canvas.clientWidth || w) / w); ctx.restore(); } ctx.restore();
    return { card, options, shape: options.shape, effect: options.effect, geometry: { source: geometry.source, fillRule: options.pathFillRule, coverage: geometry.coverage, distanceField: 'euclidean-mask', width: WIDTH, height: HEIGHT }, exportWidth: WIDTH, exportHeight: HEIGHT, capturedBackdrop: options.effect === 'glass' };
  }
  function exportMaterial(input, scale) { const options = normalize(input), resolution = clamp(Number(scale) || 1, 0.5, 4096 / WIDTH), geometry = shapeGeometry(options), sourceScale=Math.min(resolution,4096/900), source = sceneFor(900 * sourceScale, 720 * sourceScale, options), card = samplingCard(source.width, source.height, options.backgroundRect); return material(options, resolution, source, card, geometry); }
  global.MaterialLab = Object.freeze({ presets, shapes, bounds, layerBounds, shadowBounds, blendModes, maxLayers: MAX_LAYERS, normalize, createOptions, createLayer, render, exportMaterial, previewCard:cardGeometry });
})(typeof window !== 'undefined' ? window : globalThis);
