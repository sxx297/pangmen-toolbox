(function () {
  'use strict';
  const root = document.getElementById('ppt-material-lab');
  if (!root || !globalThis.MaterialLab || !globalThis.MaterialPresetStore) return;
  const api = globalThis.MaterialLab;
  const library = globalThis.MaterialPresetStore.create(api);
  const host = globalThis.MaterialHost;
  const hosted = !!host?.available;
  const ppt = {connected:false,busy:false,applying:false,target:null,epoch:0,revision:0,synced:0,pointerDown:false,pendingSelection:null,info:null,quickSelection:false,readError:false,failedDraft:null};
  let selectionTimer=null,handleTransaction=null,recoveryAttempted=false,activeCapture=null;
  const $ = selector => root.querySelector(selector);
  const canvas = $('#ml-canvas');
  const status = $('#ml-status');
  const operationToast=hosted?globalThis.PangToast.create(status):null;
  if(hosted)status.textContent='';
  const clone = value => JSON.parse(JSON.stringify(value));
  const builtinNames = {blue:'冰蓝弥散',purple:'紫色辉光',aurora:'极光混色',glass:'通透玻璃',frosted:'柔雾玻璃',smoked:'深色玻璃'};
  const modes = {gradient:{activeId:'builtin:blue',drafts:new Map()},glass:{activeId:'builtin:glass',drafts:new Map()}};
  const geometry = {shape:'roundedRect',radius:34};
  const previewContent = {gradient:true,glass:false};
  let effect = root.dataset.initialEffect==='glass' || (document.documentElement.dataset.materialStandalone==='true' && new URLSearchParams(location.search).get('effect')==='glass') ? 'glass' : 'gradient';
  let backgroundMode = 'silk';
  let queued = false, previewTimer=null, lastPreviewTime=0, paintedSerial=0;
  let asyncRenderer=hosted?globalThis.MaterialAsyncRenderer?.create():null,previewSerial=0,quickState='';
  let renderCount = 0;
  let lastFrame = null;
  let handles = null,libraryUI=null,controlsUI=null,hasPreviewFrame=false;
  let layerDetailsOpen=false,layerDrag=null;
  const viewStates=new Map(),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let fadeNextPreview=false;
  function settleDetails(){root.querySelectorAll('details').forEach(el=>el.finishDisclosure?.());}
  function saveView(){
    settleDetails();
    viewStates.set(effect,{scroll:($('#ml-docked-scroll')||$('.ml-controls')).scrollTop,details:[...root.querySelectorAll('details')].map(el=>el.open),layerDetailsOpen});
  }
  function restoreView(){
    const view=viewStates.get(effect);
    root.querySelectorAll('details').forEach((el,i)=>{el.open=view?.details[i]||false;el.dataset.expanded=String(el.open);});
    ($('#ml-docked-scroll')||$('.ml-controls')).scrollTop=view?.scroll||0;
  }
  const undoSteps=[];
  let historyState=null,historyGesture=null,gestureRecorded=false,restoringHistory=false,colorEditing=false,colorTimer=null;
  const blendLabels={"pass-through": "穿透", "normal": "正常", "darken": "变暗", "multiply": "正片叠底", "color-burn": "颜色加深", "linear-burn": "线性加深 · Plus darker", "lighten": "变亮", "screen": "滤色", "color-dodge": "颜色减淡", "linear-dodge": "线性减淡 · Plus lighter", "overlay": "叠加", "soft-light": "柔光", "hard-light": "强光", "difference": "差值", "exclusion": "排除", "hue": "色相", "saturation": "饱和度", "color": "颜色", "luminosity": "明度"};
  const uid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const workspace = () => modes[effect];
  function notify(message, error) {
    if(operationToast){operationToast.show(message,error);return;}
    status.textContent=message;
    status.setAttribute('role',error?'alert':'status');
  }
  function safeRecipe(input) {
    const result = api.normalize(input);
    for (const key of ['shape','radius','content','customPath','alphaMask','pathFillRule','backgroundCanvas','previewShape','previewAspect','backgroundRect','immutableMask']) delete result[key];
    return clone(result);
  }
  function getDraft() {
    const ws = workspace();
    if (!ws.drafts.has(ws.activeId)) {
      if (ws.activeId.startsWith('builtin:')) {
        const key = ws.activeId.slice(8);
        const settings = safeRecipe(api.createOptions(key));
        const name = builtinNames[key] || api.presets[key].label;
        ws.drafts.set(ws.activeId,{name,settings,initial:JSON.stringify(settings),originalName:name,layerId:null});
      } else {
        const record = library.list(effect).find(preset => preset.id === ws.activeId);
        if (!record) throw new Error('找不到这个自定义预设。');
        const settings = safeRecipe(record.settings);
        ws.drafts.set(ws.activeId,{name:record.name,settings,initial:JSON.stringify(settings),originalName:record.name,layerId:null});
      }
    }
    return ws.drafts.get(ws.activeId);
  }
  const getLayer = () => getDraft().settings.layers.find(layer => layer.id === getDraft().layerId);
  const dirty = () => { const draft=getDraft();return draft.name!==draft.originalName || JSON.stringify(draft.settings)!==draft.initial; };
  // Demo scenes may vary by material. A real PPT capture always shares its actual background.
  const targetBackground = () => ppt.target?.previewBackgrounds?.[effect] || ppt.target?.background;
  function demoBackdrop(target){
    const source=targetBackground(),w=canvas.width,h=canvas.height;
    if(target.previewBackdropSource!==source||target.previewBackdrop?.width!==w||target.previewBackdrop?.height!==h){
      const scene=document.createElement('canvas');scene.width=w;scene.height=h;
      const ctx=scene.getContext('2d'),scale=Math.max(w/source.width,h/source.height);
      ctx.drawImage(source,(w-source.width*scale)/2,(h-source.height*scale)/2,source.width*scale,source.height*scale);
      target.previewBackdrop=scene;target.previewBackdropSource=source;
    }
    return target.previewBackdrop;
  }
  function currentOptions() {
    if(hosted && ppt.target){
      const target=ppt.target,options={...getDraft().settings,shape:'rectangle',effect,content:false,immutableMask:true,alphaMask:target.mask,backgroundCanvas:targetBackground()};
      if(target.previewBackgrounds){
        const card=api.previewCard(canvas.width,canvas.height,target.shape.width/target.shape.height);
        options.backgroundCanvas=demoBackdrop(target);
        options.backgroundRect={x:card.x/canvas.width,y:card.y/canvas.height,w:card.w/canvas.width,h:card.h/canvas.height};
      }
      return options;
    }
    return {...getDraft().settings,...geometry,content:previewContent[effect],effect,...(effect==='glass'&&globalThis.MaterialBackgrounds?{backgroundCanvas:globalThis.MaterialBackgrounds.create(backgroundMode)}:{})};
  }
  function drawHostPreview(){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,target=ppt.target;
    if(!target && hasPreviewFrame)return null;
    if(!target){
      ctx.clearRect(0,0,w,h);
      ctx.fillStyle=getComputedStyle(root).getPropertyValue('--ml-muted');const hintSize=root.dataset.panelMode==='docked'?parseFloat(getComputedStyle(root).getPropertyValue('--pm-body'))*w/Math.max(1,canvas.getBoundingClientRect().width):22;ctx.font=hintSize+'px "Microsoft YaHei","Segoe UI",sans-serif';ctx.textAlign='center';
      ctx.fillText(ppt.readError?'形状读取失败，请刷新背景':'选择一个形状',w/2,h/2);ctx.textAlign='start';return null;
    }
    const card=api.previewCard(w,h,target.shape.width/target.shape.height);
    const source=target.render?.card || {x:126,y:111.6,w:648,h:496.8};
    const sx=card.w/source.w,sy=card.h/source.h;
    // Capture and material share this transform, preserving the real shape's aspect ratio.
    const dx=card.x-source.x*sx,dy=card.y-source.y*sy;
    const background=targetBackground();
    if(target.previewBackgrounds)demoBackdrop(target);
    else if(!target.previewBackdrop || target.previewBackdropSource!==background){
      const backdrop=document.createElement('canvas');backdrop.width=w;backdrop.height=h;
      const context=backdrop.getContext('2d');
      context.fillStyle='#f5f5f5';context.fillRect(0,0,w,h);
      if(target.previewScene){
        // Native capture includes the actual surroundings at the preview's aspect ratio.
        context.drawImage(target.previewScene,0,0,w,h);
      }else{
        // Older hosts may only provide the canonical material crop. Never smear its edges.
        context.drawImage(background,dx,dy,background.width*sx,background.height*sy);
      }
      target.previewBackdrop=backdrop;target.previewBackdropSource=background;
    }
    if(!hasPreviewFrame)ctx.drawImage(target.previewBackdrop,0,0);
    const options=currentOptions(),currentEffect=effect,serial=++previewSerial,backdrop=target.previewBackdrop;
    const paint=material=>{paintedSerial=serial;ctx.drawImage(backdrop,0,0);ctx.drawImage(material,card.x,card.y,card.w,card.h);hasPreviewFrame=true;root.dataset.previewReady='true';root.dataset.previewTarget=target.token;root.dataset.renderedBlur=String(options.blur);root.dataset.previewFrame=String(serial);root.dataset.renderedEffect=currentEffect;
      if(fadeNextPreview){fadeNextPreview=false;if(!reducedMotion.matches){canvas.getAnimations().forEach(a=>a.cancel());canvas.animate([{opacity:.88},{opacity:1}],{duration:100,easing:'ease-out'});}}
    };
    if(asyncRenderer){
      root.dataset.renderer='worker';
      asyncRenderer.render(options,(ppt.pointerDown||colorEditing)?.5:1.5).then(bitmap=>{
        if(!bitmap)return;
        if(ppt.target===target && effect===currentEffect && serial===previewSerial)paint(bitmap);
        bitmap.close();
      }).catch(()=>{asyncRenderer=null;root.dataset.renderer='fallback';if(serial===previewSerial)schedule();});
    }else{root.dataset.renderer='fallback';paint(api.exportMaterial(options,(ppt.pointerDown||colorEditing)?.5:1.5));}
    return {card};
  }
  function draw() {
    queued = false;lastPreviewTime=performance.now();
    try {
      lastFrame=hosted?drawHostPreview():api.render(canvas,currentOptions());
      root.dataset.renderCount=String(++renderCount);
      root.dataset.effect=effect;
      root.dataset.preset=workspace().activeId;
      root.dataset.shape=hosted?'powerpoint':geometry.shape;
      root.dataset.layerCount=String(getDraft().settings.layers.length);
      if(handles)handles.update();
      controlsUI?.refresh();
    } catch(error) { notify('预览失败：'+error.message,true);console.error(error); }
  }
  function schedule() {
    const delay=hosted&&(ppt.pointerDown||colorEditing)?Math.max(0,50-(performance.now()-lastPreviewTime)):0;
    clearTimeout(previewTimer);previewTimer=null;
    if(queued)return;
    if(delay>0){previewTimer=setTimeout(schedule,delay);return;}
    queued=true;requestAnimationFrame(draw);
  }
  function syncName() {
    const draft=getDraft(),baseline=draft.initial||draft.resetInitial;
    $('#ml-reset-preset').disabled=!baseline||JSON.stringify(draft.settings)===baseline&&draft.name===(draft.originalName||draft.resetName);
    const name=(getDraft().name || '未命名效果')+(dirty()?' · 已修改':'');
    if($('#ml-current-preset').textContent!==name)$('#ml-current-preset').textContent=name;
    $('#ml-current-preset').title=$('#ml-current-preset').textContent;
    const key=effect+'|'+workspace().activeId+'|'+name;
    if(key!==quickState){quickState=key;libraryUI?.refreshQuick();}
    $('#ml-material-name').textContent=(getDraft().name || '未命名效果')+(dirty()?' · 已修改':'');
    $('#ml-shape-name').textContent=hosted?(ppt.target?.shape.name || '尚未读取形状'):api.shapes[geometry.shape].label;
  }
  function historySnapshot(){return {effect,id:workspace().activeId,draft:clone(getDraft())};}
  function historyKey(state){return state&&JSON.stringify([state.effect,state.id,state.draft.name,state.draft.settings]);}
  function resetHistory(){undoSteps.length=0;historyGesture=null;gestureRecorded=false;historyState=historySnapshot();}
  function beginGesture(owner){if(historyGesture!==owner){historyGesture=owner;gestureRecorded=false;}}
  function finishGesture(){historyGesture=null;gestureRecorded=false;}
  function rememberChange(){
    const next=historySnapshot();
    if(!restoringHistory&&historyState&&historyKey(next)!==historyKey(historyState)&&(!historyGesture||!gestureRecorded)){
      undoSteps.push(historyState);if(undoSteps.length>10)undoSteps.shift();if(historyGesture)gestureRecorded=true;
    }
    historyState=next;
  }
  function changed() { ++previewSerial;rememberChange();recoveryAttempted=false;syncName();schedule();if(hosted){ppt.revision++;syncApplyState();} }
  document.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.shiftKey||event.altKey||event.key.toLowerCase()!=='z')return;
    if(root.querySelector('dialog[open]')||event.target.closest('textarea,[contenteditable="true"],input[type="text"],input[type="search"]'))return;
    const numberInput=event.target.closest('input[type="number"]');
    // Leave uncommitted text to native undo; committed parameters use material history.
    if(numberInput&&controlsUI?.numberEditing(numberInput))return;
    if(!root.contains(event.target)&&event.target!==document.body)return;
    if(hosted&&!ppt.target)return;
    if(!undoSteps.length)return;event.preventDefault();event.stopPropagation();
    const cancellingHandle=!!handleTransaction;
    if(handles)handles.cancel();finishLayerDrag(true);finishGesture();
    if(cancellingHandle)return;
    const previous=undoSteps.pop();if(!previous)return;
    restoringHistory=true;effect=previous.effect;workspace().activeId=previous.id;workspace().drafts.set(previous.id,clone(previous.draft));
    layerDetailsOpen=!!getDraft().layerId;syncControls();controlsUI?.syncNumbers();changed();restoringHistory=false;
  });
  root.addEventListener('pointerdown',event=>{finishGesture();if(event.target.matches('input[type="range"],input[type="color"],input[type="number"]'))beginGesture(event.target);},true);
  root.addEventListener('input',event=>{
    if(event.target.matches('input[type="range"],input[type="color"],input[type="number"],#ml-layer-name'))beginGesture(event.target);
    if(event.target.matches('input[type="color"]')){
      colorEditing=true;clearTimeout(colorTimer);
      colorTimer=setTimeout(()=>{colorEditing=false;ppt.pointerDown=false;schedule();syncApplyState();},200);
    }
  },true);
  root.addEventListener('change',event=>{if(event.target.type!=='color')queueMicrotask(finishGesture);},true);
  root.addEventListener('focusout',event=>{if(event.target===historyGesture)finishGesture();});
  function option(value,label) { const el=document.createElement('option');el.value=value;el.textContent=label;return el; }
  function syncLayerFields() {
    const layer=getLayer();
    $('#ml-layer-fields').hidden=!layer || !layerDetailsOpen;
    refreshLayerRows();
    if (!layer) {if(handles)handles.update();return;}
    const shadow=layer.type==='inner-shadow';
    $('#ml-contour-toggle-field').hidden=shadow;
    $('#ml-layer-contour').checked=layer.profile==='contour';
    $('#ml-contour-width-field').hidden=shadow||layer.profile!=='contour';
    $('#ml-light-fields').hidden=shadow;
    $('#ml-shadow-fields').hidden=!shadow;
    $('#ml-shadow-help').hidden=!shadow;
    $('#ml-layer-blur-label').textContent=shadow?'模糊（px）':'图层模糊';
    $('#ml-layer-name').value=layer.name;
    $('#ml-layer-color').value=layer.color;
    $('#ml-layer-type').textContent=shadow?'内阴影':layer.profile==='contour'?'贴边色光':'色光';
    $('#ml-layer-blend').value=layer.blendMode;
    root.querySelectorAll('[data-layer-key]').forEach(input=>{
      if(!(input.dataset.layerKey in layer))return;
      input.value=String(layer[input.dataset.layerKey]);
      $('#'+input.id+'-value').textContent=input.value;
    });
    $('#ml-stage-help').textContent=shadow?'拖中心调整偏移 · 拖旋转柄改变方向 · 圆环调模糊':'拖中心移动 · 圆环调模糊 · 顶部柄旋转 · Shift 吸附 15° / 等比缩放';
    if(handles)handles.update();controlsUI?.refresh();
  }
  function layerButton(label,css,text){
    const el=document.createElement('button');el.type='button';el.className=css;el.title=label;el.setAttribute('aria-label',label);el.textContent=text;return el;
  }
  function refreshLayerRows(){
    const draft=getDraft();
    root.querySelectorAll('.ml-layer-row').forEach(row=>{
      const layer=draft.settings.layers.find(item=>item.id===row.dataset.id);if(!layer)return;
      const selected=layer.id===draft.layerId;
      row.dataset.selected=String(selected);row.dataset.enabled=String(layer.enabled);
      const pick=row.querySelector('.ml-layer-pick');pick.setAttribute('aria-pressed',String(selected));pick.setAttribute('aria-expanded',String(selected&&layerDetailsOpen));
      pick.title=(layer.type==='inner-shadow'?'内阴影':'色光')+' · '+layer.name;
      row.querySelector('.ml-layer-title').textContent=layer.name||'未命名图层';
      row.querySelector('.ml-layer-chip').style.backgroundColor=layer.color;
      row.querySelector('.ml-layer-mode').textContent=blendLabels[layer.blendMode];
      const eye=row.querySelector('[data-action="visibility"]');eye.setAttribute('aria-label',(layer.enabled?'隐藏':'显示')+'图层 '+layer.name);eye.title=layer.enabled?'隐藏图层':'显示图层';eye.setAttribute('aria-pressed',String(layer.enabled));
      if(eye.dataset.visible!==String(layer.enabled)){eye.dataset.visible=String(layer.enabled);eye.innerHTML=layer.enabled?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 3l18 18M8 6c7-3 14 6 14 6s-2 4-6 6M5 8l-3 4s5 9 13 6"/></svg>';}
    });
  }
  function selectLayer(id){
    if(handles)handles.cancel();const draft=getDraft();draft.layerId=draft.layerId===id?null:id;layerDetailsOpen=!!draft.layerId;syncLayerFields();
  }
  function syncLayers(){
    if(layerDrag)finishLayerDrag(true);
    const draft=getDraft(),layers=draft.settings.layers,list=$('#ml-layer-list'),scroll=list.scrollTop;
    if(!layers.some(item=>item.id===draft.layerId))draft.layerId=null;
    list.replaceChildren();
    [...layers].reverse().forEach(layer=>{
      const row=document.createElement('div');row.className='ml-layer-row';row.dataset.id=layer.id;row.setAttribute('role','listitem');
      const grip=layerButton('拖动排序；Alt＋上下方向键调整顺序','ml-icon-button ml-layer-grip','⠿');
      const pick=layerButton('选择图层','ml-layer-pick','');pick.setAttribute('aria-controls','ml-layer-fields');
      const chip=document.createElement('span');chip.className='ml-layer-chip';chip.dataset.shadow=String(layer.type==='inner-shadow');
      const title=document.createElement('span');title.className='ml-layer-title';
      const mode=document.createElement('span');mode.className='ml-layer-mode';pick.append(chip,title,mode);
      const eye=layerButton('隐藏图层','ml-icon-button','');eye.dataset.action='visibility';
      const remove=layerButton('删除图层 '+layer.name,'ml-icon-button','−');remove.dataset.action='delete';
      row.append(grip,pick,eye,remove);list.append(row);
      pick.addEventListener('click',()=>selectLayer(layer.id));
      pick.addEventListener('dblclick',()=>renameLayer(row,layer));
      row.addEventListener('click',e=>{if(e.target===row)selectLayer(layer.id);});
      eye.addEventListener('click',()=>{layer.enabled=!layer.enabled;syncLayerFields();changed();});
      remove.addEventListener('click',()=>removeLayer(layer.id));
      grip.addEventListener('pointerdown',e=>startLayerDrag(e,layer.id,grip));
      grip.addEventListener('keydown',e=>{
        if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
        const from=layers.findIndex(x=>x.id===layer.id),to=from+(e.key==='ArrowUp'?1:-1);if(to<0||to>=layers.length)return;
        [layers[from],layers[to]]=[layers[to],layers[from]];draft.layerId=layer.id;syncLayers();changed();
        [...list.children].find(r=>r.dataset.id===layer.id)?.querySelector('.ml-layer-grip').focus();
      });
    });
    list.scrollTop=scroll;$('#ml-layer-empty').hidden=!!layers.length;
    $('#ml-add-layer').disabled=layers.length>=16;$('#ml-add-shadow').disabled=layers.length>=16;$('#ml-add-toggle').disabled=layers.length>=16;
    $('#ml-layer-count').textContent=layers.length+' / 16';
    syncLayerFields();
  }
  function renameLayer(row,layer){
    const pick=row.querySelector('.ml-layer-pick');if(!pick)return;
    const input=document.createElement('input');input.type='text';input.maxLength=40;input.value=layer.name;input.className='ml-row-rename';input.setAttribute('aria-label','重命名图层');pick.hidden=true;row.insertBefore(input,pick);
    let done=false;const finish=cancel=>{if(done)return;done=true;if(!cancel){layer.name=input.value.trim()||'未命名图层';changed();}input.remove();pick.hidden=false;syncLayerFields();};
    input.addEventListener('blur',()=>finish(false));input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(e.key==='Escape');pick.focus();}});input.focus();input.select();
  }
  function removeLayer(id){
    const draft=getDraft(),index=draft.settings.layers.findIndex(x=>x.id===id);if(index<0)return;
    if(handles)handles.cancel();finishGesture();
    draft.settings.layers.splice(index,1);if(draft.layerId===id){draft.layerId=null;layerDetailsOpen=false;}
    syncLayers();changed();
  }
  function setAddMenu(open){$('#ml-add-menu').hidden=!open;$('#ml-add-toggle').setAttribute('aria-expanded',String(open));}
  function insertLayer(layer){
    layer.rotation=layer.rotation||0;
    const draft=getDraft(),layers=draft.settings.layers;const index=layers.findIndex(x=>x.id===draft.layerId);
    layers.splice(index<0?layers.length:index+1,0,layer);draft.layerId=layer.id;layerDetailsOpen=true;setAddMenu(false);syncLayers();changed();
    [...$('#ml-layer-list').children].find(r=>r.dataset.id===layer.id)?.scrollIntoView({block:'nearest'});
  }
  function startLayerDrag(event,id,grip){
    if(event.button!==0||layerDrag)return;event.preventDefault();if(getDraft().layerId!==id)selectLayer(id);
    layerDrag={id,grip,pointer:event.pointerId,startY:event.clientY,y:event.clientY,draft:getDraft(),active:false,raf:null,epoch:ppt.epoch};
    grip.setPointerCapture(event.pointerId);
    const move=e=>{if(!layerDrag||e.pointerId!==layerDrag.pointer)return;layerDrag.y=e.clientY;if(Math.abs(e.clientY-layerDrag.startY)>4)layerDrag.active=true;};
    const up=e=>{if(layerDrag&&e.pointerId===layerDrag.pointer)finishLayerDrag(false);};
    const cancel=()=>finishLayerDrag(true);
    grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);grip.addEventListener('pointercancel',cancel);grip.addEventListener('lostpointercapture',cancel);
    layerDrag.cleanup=()=>{grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);grip.removeEventListener('pointercancel',cancel);grip.removeEventListener('lostpointercapture',cancel);};
    const tick=()=>{
      const d=layerDrag;if(!d)return;const list=$('#ml-layer-list'),scroll=layerScrollContainer(list),rect=scroll.getBoundingClientRect();
      if(d.active){
        if(d.y<rect.top+28)scroll.scrollTop-=9;else if(d.y>rect.bottom-28)scroll.scrollTop+=9;
        const rows=[...list.children];rows.forEach(r=>{delete r.dataset.drop;r.dataset.dragging=String(r.dataset.id===d.id);});
        const remaining=rows.filter(r=>r.dataset.id!==d.id);d.slot=remaining.findIndex(r=>{const b=r.getBoundingClientRect();return d.y<b.top+b.height/2;});
        if(d.slot<0)d.slot=remaining.length;
        if(remaining.length){const anchor=remaining[Math.min(d.slot,remaining.length-1)];anchor.dataset.drop=d.slot===remaining.length?'after':'before';}
      }
      d.raf=requestAnimationFrame(tick);
    };layerDrag.raf=requestAnimationFrame(tick);
  }
  function layerScrollContainer(list){
    for(let node=list;node&&root.contains(node);node=node.parentElement){
      if(/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight)return node;
    }
    return list;
  }
  function finishLayerDrag(cancel){
    const d=layerDrag;if(!d)return;layerDrag=null;cancelAnimationFrame(d.raf);d.cleanup();
    if(d.grip.hasPointerCapture(d.pointer))d.grip.releasePointerCapture(d.pointer);
    root.querySelectorAll('.ml-layer-row').forEach(r=>{delete r.dataset.dragging;delete r.dataset.drop;});
    if(!cancel && d.active && Number.isInteger(d.slot) && d.draft===getDraft() && d.epoch===ppt.epoch){
      const original=d.draft.settings.layers,visual=[...original].reverse(),item=visual.find(x=>x.id===d.id),remaining=visual.filter(x=>x.id!==d.id);remaining.splice(d.slot,0,item);
      const ordered=remaining.reverse();if(ordered.some((x,i)=>x.id!==original[i].id)){d.draft.settings.layers=ordered;syncLayers();changed();}
    }
    ppt.pointerDown=false;syncApplyState();
  }
  window.addEventListener('blur',()=>finishLayerDrag(true));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(layerDrag){e.preventDefault();finishLayerDrag(true);}setAddMenu(false);}});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.ml-add-wrap')&&e.target.id!=='ml-add-empty')setAddMenu(false);});
  $('#ml-add-toggle').addEventListener('click',()=>setAddMenu($('#ml-add-menu').hidden));
  $('#ml-add-empty').addEventListener('click',()=>{setAddMenu(true);$('#ml-add-layer').focus();});
  $('#ml-close-layer').addEventListener('click',()=>{if(handles)handles.cancel();getDraft().layerId=null;layerDetailsOpen=false;syncLayerFields();});
  function syncControls() {
    const draft=getDraft();
    root.querySelectorAll('[data-global-key]').forEach(input=>{
      input.value=String(draft.settings[input.dataset.globalKey]);
      $('#'+input.id+'-value').textContent=input.value;
    });
    $('#ml-base').value=draft.settings.base;
    $('#ml-secondary').value=draft.settings.secondary;
    $('#ml-glass-controls').hidden=effect!=='glass';
    $('#ml-background-field').hidden=hosted || effect!=='glass';
    $('#ml-base-label').textContent=effect==='glass'?'染色':'底色';
    $('#ml-opacity-label').textContent=effect==='glass'?'染色强度':'底色不透明度';
    $('#ml-base').setAttribute('aria-label',effect==='glass'?'玻璃染色':'底色');
    $('#ml-content').checked=previewContent[effect];
    $('#ml-parameters-title').textContent=effect==='glass'?'玻璃设置':'渐变设置';
    $('.ml-modes').dataset.selected=effect;
    root.querySelectorAll('button[data-effect]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.effect===effect)));
    $('#ml-editor').setAttribute('aria-labelledby','ml-tab-'+effect);
    syncLayers();syncName();schedule();
    controlsUI?.refresh();
    if(hosted)syncHost();
  }
  function selectPreset(id) { workspace().drafts.delete(id);workspace().activeId=id;syncControls();changed(); }
  function setEffect(value) {
    if(value===effect)return;
    handles?.cancel();controlsUI?.close();saveView();
    effect=value;layerDetailsOpen=viewStates.get(effect)?.layerDetailsOpen||false;fadeNextPreview=true;
    syncControls();changed();restoreView();
    if(!reducedMotion.matches){const panel=$('.ml-controls');panel.getAnimations().forEach(a=>a.cancel());panel.animate([{opacity:.8},{opacity:1}],{duration:140,easing:'ease-out'});}
    if(!hosted)notify(effect==='glass'?'切换文字或网格背景，可以查看玻璃边缘的折射。':'可编辑色光和内阴影；未保存的调整在切换时保留。');
  }
  root.querySelectorAll('button[data-effect]').forEach(button=>{
    button.addEventListener('click',()=>setEffect(button.dataset.effect));
    button.addEventListener('keydown',event=>{
      if (event.key==='ArrowLeft'||event.key==='ArrowRight') {
        event.preventDefault();setEffect(effect==='gradient'?'glass':'gradient');$('#ml-tab-'+effect).focus();
      }
    });
  });
  Object.entries(api.shapes).forEach(([key,value])=>$('#ml-shape').appendChild(option(key,value.label)));
  $('#ml-shape').value=geometry.shape;
  $('#ml-background').addEventListener('change',event=>{backgroundMode=event.target.value;schedule();});
  $('#ml-shape').addEventListener('change',event=>{
    geometry.shape=event.target.value;
    $('#ml-radius-field').hidden=geometry.shape!=='roundedRect';
    $('#ml-content-field').hidden=!['roundedRect','rectangle'].includes(geometry.shape);
    syncName();schedule();
  });
  $('#ml-radius').addEventListener('input',event=>{geometry.radius=Number(event.target.value);$('#ml-radius-value').textContent=event.target.value;schedule();});
  $('#ml-content').addEventListener('change',event=>{previewContent[effect]=event.target.checked;schedule();});
  root.querySelectorAll('[data-global-key]').forEach(input=>input.addEventListener('input',()=>{
    getDraft().settings[input.dataset.globalKey]=Number(input.value);$('#'+input.id+'-value').textContent=input.value;changed();
  }));
  ['base','secondary'].forEach(key=>$('#ml-'+key).addEventListener('input',event=>{getDraft().settings[key]=event.target.value;changed();}));
  $('#ml-add-layer').addEventListener('click',()=>{
    const draft=getDraft();if(draft.settings.layers.length>=16)return;
    insertLayer({id:'layer-'+uid(),type:'light',name:'色光 '+(draft.settings.layers.length+1),color:'#69d4ff',x:50,y:65,sizeX:65,sizeY:50,opacity:80,blur:25,blendMode:'screen',enabled:true});
  });
  $('#ml-add-shadow').addEventListener('click',()=>{
    const draft=getDraft();if(draft.settings.layers.length>=16)return;
    insertLayer({id:'layer-'+uid(),type:'inner-shadow',name:'内阴影 '+(draft.settings.layers.length+1),color:'#091127',offsetX:6,offsetY:8,spread:4,opacity:75,blur:28,blendMode:'multiply',enabled:true});
  });
  root.querySelectorAll('[data-layer-key]').forEach(input=>input.addEventListener('input',()=>{
    const layer=getLayer();if(!layer||!(input.dataset.layerKey in layer))return;layer[input.dataset.layerKey]=Number(input.value);$('#'+input.id+'-value').textContent=input.value;changed();
  }));
  $('#ml-layer-name').addEventListener('input',event=>{const layer=getLayer();if(layer){layer.name=event.target.value;refreshLayerRows();changed();}});
  $('#ml-layer-color').addEventListener('input',event=>{const layer=getLayer();if(layer){layer.color=event.target.value;refreshLayerRows();changed();}});
  $('#ml-layer-blend').addEventListener('change',event=>{const layer=getLayer();if(layer){layer.blendMode=event.target.value;refreshLayerRows();changed();}});
  $('#ml-layer-contour').addEventListener('change',event=>{
    const layer=getLayer();if(!layer||layer.type==='inner-shadow')return;
    if(event.target.checked){layer.profile='contour';layer.edgeWidth=30;layer.edgeInset=0;}
    else{delete layer.profile;delete layer.edgeWidth;delete layer.edgeInset;}
    syncLayerFields();changed();
  });
  $('#ml-shadow-glow').addEventListener('click',()=>{
    const layer=getLayer();if(!layer||layer.type!=='inner-shadow')return;
    Object.assign(layer,{color:'#A9DEFF',blendMode:'screen',offsetX:0,offsetY:0,spread:6,blur:28,opacity:80});
    syncLayerFields();changed();
  });
  function activateRecord(record) {
    effect=record.effect;workspace().activeId=record.id;workspace().drafts.delete(record.id);syncControls();
    historyState=historySnapshot();finishGesture();
    notify(library.storageWarning || '预设已保存。');
  }
  $('#ml-new').addEventListener('click',()=>{
    const settings=safeRecipe(api.createOptions(effect==='glass'?'glass':'blue'));
    settings.layers=[];settings.glow=100;settings.highlight=effect==='glass'?70:0;settings.grain=0;
    const name=effect==='glass'?'我的玻璃':'我的渐变';
    workspace().activeId='draft:'+uid();workspace().drafts.set(workspace().activeId,{name,settings,initial:'',originalName:'',resetInitial:JSON.stringify(settings),resetName:name,layerId:null});
    syncControls();changed();notify('已创建空白效果。');
  });
  $('#ml-reset-preset').addEventListener('click',()=>{
    handles?.cancel();finishGesture();
    const draft=getDraft(),baseline=draft.initial||draft.resetInitial;if(!baseline)return;
    draft.settings=clone(JSON.parse(baseline));draft.name=draft.originalName||draft.resetName||draft.name;
    draft.layerId=null;layerDetailsOpen=false;syncControls();controlsUI?.syncNumbers();changed();
    notify('已恢复预设参数。');
  });
  function download(blob,name) {
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function hostNotify(message,error){
    $('#ml-host-status').textContent=message;
    $('#ml-host-status').title=message;
    $('#ml-host-status').setAttribute('role',error?'alert':'status');
    if(error)notify(message,true);
  }
  function syncHost(){
    root.dataset.hostConnected=String(ppt.connected);root.dataset.hostBusy=String(ppt.busy);
    root.dataset.hostTarget=ppt.target?.token || '';
    $('#ml-preview-loading').hidden=!!ppt.target || (!hasPreviewFrame&&!ppt.busy&&!ppt.pendingSelection);
    $('#ml-preview-loading').textContent=ppt.busy||ppt.pendingSelection?'正在读取背景…':ppt.readError?'预览已暂停 · 形状读取失败':'预览已暂停 · 请选择形状';
    $('#ml-host-capture').disabled=!ppt.connected || ppt.busy;
    $('#ml-host-apply').disabled=!ppt.connected || ppt.busy || !ppt.target;
    $('#ml-host-restore').disabled=!ppt.connected || ppt.busy || !ppt.target?.canRestore;
    $('#ml-editor').inert=ppt.busy&&!ppt.applying;$('.ml-modes').inert=ppt.busy&&!ppt.applying;
    $('#ml-host-apply').textContent=ppt.applying?'应用中…':'应用到选中形状';
    root.dataset.unapplied=String(!!ppt.target&&ppt.revision>ppt.synced);
    const selectedShape=(ppt.target||ppt.info)?.shape;
    $('#ml-host-apply').title=selectedShape?'应用到 '+selectedShape.name+' · Ctrl+Enter':'请在 PowerPoint 中选择形状';
    $('#ml-host-help').textContent=ppt.target?'调参仅更新预览。点击应用或按 Ctrl+Enter 写入 PPT；背景变化后点击刷新背景。':'在 PowerPoint 中选择一个绘图形状。';
  }
  function syncApplyState(){
    if(!hosted)return;
    root.dataset.unapplied=String(!!ppt.target&&ppt.revision>ppt.synced);
    if(ppt.target&&!ppt.busy&&ppt.revision>ppt.synced)hostNotify('');
  }
  function invalidateHostTarget(){
    if(layerDrag)finishLayerDrag(true);if(handles)handles.cancel();finishGesture();
    ppt.epoch++;ppt.target=null;ppt.info=null;ppt.synced=ppt.revision;
    syncName();syncHost();schedule();
  }
  function queueSelectionCapture(){
    clearTimeout(selectionTimer);
    if(!ppt.pendingSelection || ppt.busy)return;
    selectionTimer=setTimeout(()=>{
      if(ppt.busy)return;
      const selection=ppt.pendingSelection;ppt.pendingSelection=null;
      if(selection?.supported===false){hostNotify(selection.reason || '选择一个形状开始编辑');return;}
      hostOperation(async()=>{
        hostNotify('读取当前页背景…');
        const target=await readHostTarget({preserve:selection.preserve,resetWhenEmpty:!!selection?.materialChanged});
        if(target){
          // A moved/copied material needs a fresh background even without slider input.
          if(selection.reapply && !selection.materialChanged && (target.settings || (selection.preserve && target.identity===selection.preserve.target.identity && target.materialState===selection.preserve.target.materialState)))ppt.revision++;
          hostNotify(selection?.materialChanged?'已跟随 PowerPoint 更新':'已就绪');
        }
      });
    },250);
  }
  async function exportRendered(options,scale){
    if(asyncRenderer){
      try{const bitmap=await asyncRenderer.render(options,scale,true);const result=document.createElement('canvas');result.width=bitmap.width;result.height=bitmap.height;result.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return result;}
      catch{asyncRenderer=null;}
    }
    return api.exportMaterial(options,scale);
  }
  async function applyHostMaterial(){
    const target=ppt.target,epoch=ppt.epoch,revision=ppt.revision;
    if(!target)throw new Error('请选择一个形状。');
    hostNotify('生成高清材质…');
    const started=performance.now();
    const settings=safeRecipe(getDraft().settings),out=await exportRendered({...currentOptions(),content:false},finalRenderScale(target));
    const rendered=performance.now();
    if(epoch!==ppt.epoch || ppt.target!==target)return;
    const png=await new Promise((resolve,reject)=>out.toBlob(blob=>{
      if(!blob){reject(new Error('生成材质图片失败。'));return;}
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('编码材质图片失败。'));reader.readAsDataURL(blob);
    },'image/png'));
    if(epoch!==ppt.epoch || ppt.target!==target)return;
    hostNotify('正在应用到 PPT…');
    host.request('log',{message:'Apply.RenderAndEncode render_ms='+Math.round(rendered-started)+' encode_ms='+Math.round(performance.now()-rendered)}).catch(()=>{});
    const result=await host.request('applyMaterial',{token:target.token,png,settings});
    if(epoch!==ppt.epoch)return;
    if(result.token){target.token=result.token;target.canRestore=true;target.settings=settings;if(result.materialState!==undefined)target.materialState=result.materialState;}
    else { await readHostTarget(); } // Compatibility with the 0.6 host's single-use captures.
    ppt.synced=revision;hostNotify(ppt.revision>revision?'':'已应用');
  }
  function finalRenderScale(target=ppt.target){
    // Aim for four source pixels per PPT point; bound both dimensions and memory.
    return target?Math.min(4096/600,Math.max(3,target.shape.width*4/600,target.shape.height*4/460)):3;
  }
  function decodeHostImage(source){
    return new Promise((resolve,reject)=>{
      if(typeof source!=='string' || !source.startsWith('data:image/png;base64,')){reject(new Error('加载项未返回有效的形状图像。'));return;}
      const image=new Image(),timer=setTimeout(()=>reject(new Error('读取形状图像超时，请重新读取。')),12000);
      image.onload=()=>{
        clearTimeout(timer);
        if(!image.naturalWidth || !image.naturalHeight || image.naturalWidth>8192 || image.naturalHeight>8192){reject(new Error('形状图像尺寸超出支持范围。'));return;}
        const result=document.createElement('canvas');result.width=image.naturalWidth;result.height=image.naturalHeight;
        result.getContext('2d').drawImage(image,0,0);resolve(result);
      };
      image.onerror=()=>{clearTimeout(timer);reject(new Error('形状图像读取失败，请重新读取。'));};image.src=source;
    });
  }
  async function readHostTarget({preserve=null,resetWhenEmpty=false,forceRefresh=false}={}){
    const capture={preserve};activeCapture=capture;
    try{
    const epoch=ppt.epoch;
    ppt.target=null;syncHost();schedule();
    if(ppt.quickSelection){
      hostNotify('读取形状…');
      const info=await host.request('selectionInfo',{},15000);
      if(epoch!==ppt.epoch)return null;
      ppt.info=info;syncHost();hostNotify('更新背景…');
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(epoch!==ppt.epoch)return null;
    }
    const captured=await host.request('captureSelection',{forceRefresh},180000);
    if(captured.supported===false)throw new Error(captured.message || '暂不支持当前所选对象，请选中一个可填充形状。');
    if(typeof captured.token!=='string' || !captured.token || !Number.isFinite(captured.shape?.width) || !Number.isFinite(captured.shape?.height) || captured.shape.width<=0 || captured.shape.height<=0)throw new Error('加载项未返回有效的目标形状。');
    const [mask,background,previewScene]=await Promise.all([decodeHostImage(captured.maskPng),decodeHostImage(captured.backgroundPng),captured.previewScenePng?decodeHostImage(captured.previewScenePng):Promise.resolve(null)]);
    const maskProbe=document.createElement('canvas');maskProbe.width=maskProbe.height=128;
    const probeContext=maskProbe.getContext('2d');probeContext.drawImage(mask,0,0,128,128);
    const alpha=probeContext.getImageData(0,0,128,128).data;let covered=0;for(let i=3;i<alpha.length;i+=4)covered+=alpha[i]/255;
    root.dataset.maskCoverage=(covered/(128*128)).toFixed(4);
    if(covered===0)throw new Error('读取到的形状轮廓为空，材质无法显示。请重新选择形状并刷新背景。');
    let previewBackgrounds;
    if(captured.backgroundSource==='preview' && captured.previewBackgrounds){
      const [gradient,glass]=await Promise.all(['gradient','glass'].map(mode=>decodeHostImage(captured.previewBackgrounds[mode])));
      previewBackgrounds={gradient,glass};
    }
    if(epoch!==ppt.epoch)return null;
    ppt.target={...captured,mask,background,previewScene,previewBackgrounds,shape:{...captured.shape,name:captured.shape.name || '所选形状'},canRestore:captured.canRestore ?? !!captured.settings};
    // A refresh preserves the draft only for the same document/shape and material state.
    const sameTarget=preserve && (captured.identity && preserve.target.identity
      ? captured.identity===preserve.target.identity
      : captured.shape.id===preserve.target.shape.id && captured.shape.name===preserve.target.shape.name);
    const keepDraft=sameTarget && (captured.materialState!==undefined && preserve.target.materialState!==undefined
      ? captured.materialState===preserve.target.materialState
      : JSON.stringify(captured.settings||null)===JSON.stringify(preserve.target.settings||null));
    if(keepDraft){effect=preserve.effect;workspace().activeId=preserve.id;ppt.synced=preserve.synced;}
    else if(captured.settings && ['glass','gradient'].includes(captured.settings.effect)){
      effect=captured.settings.effect;
      const settings=safeRecipe(captured.settings),id='host:'+captured.token;
      for(const mode of Object.values(modes))for(const key of mode.drafts.keys())if(key.startsWith('host:') && key!==mode.activeId)mode.drafts.delete(key);
      workspace().activeId=id;workspace().drafts.set(id,{name:'形状中的材质',settings,initial:JSON.stringify(settings),originalName:'形状中的材质',layerId:null});
    } else if(resetWhenEmpty || sameTarget){
      effect='gradient';const settings=safeRecipe(api.createOptions('blue'));
      Object.assign(settings,{layers:[],glow:0,highlight:0,grain:0,opacity:0});
      const id='host:'+captured.token;workspace().activeId=id;
      workspace().drafts.set(id,{name:'未应用材质',settings,initial:JSON.stringify(settings),originalName:'未应用材质',layerId:null});
    }
    if(!keepDraft){
      for(const mode of Object.values(modes))for(const draft of mode.drafts.values())draft.layerId=null;
      layerDetailsOpen=false;ppt.synced=ppt.revision;resetHistory();
    }
    ppt.readError=false;ppt.failedDraft=null;syncControls();return captured;
    }finally{if(activeCapture===capture)activeCapture=null;}
  }
  async function hostOperation(action,applying=false){
    if(ppt.busy || !ppt.connected)return;
    const previousDraft=ppt.target?{target:ppt.target,effect,id:workspace().activeId,synced:ppt.synced}:ppt.failedDraft;
    ppt.busy=true;ppt.applying=applying;syncHost();
    try{await action();}
    catch(error){
      const preserve=ppt.target?{target:ppt.target,effect,id:workspace().activeId,synced:ppt.synced}:null;
      invalidateHostTarget();
      // Re-read changed geometry, but never retry a write without another click.
      if(applying && error.code==='STALE_TARGET' && !recoveryAttempted){
        recoveryAttempted=true;ppt.pendingSelection=ppt.pendingSelection || {supported:true,preserve,reapply:true};
        hostNotify('形状已变化，正在重新读取…');
      }else {
        ppt.readError=error.code==='GEOMETRY_UNAVAILABLE'||String(error.message).includes('GEOMETRY_UNAVAILABLE');
        if(ppt.readError)ppt.failedDraft=previousDraft;
        hostNotify(error.message || '操作失败，请重新读取形状。',true);
      }
    }
    finally{ppt.busy=false;ppt.applying=false;syncHost();if(ppt.pendingSelection)queueSelectionCapture();else syncApplyState();}
  }
  if(hosted){
    root.dataset.hosted='true';document.documentElement.dataset.materialHosted='true';
    root.append(status); // Keep fixed feedback outside scrolling/hidden panel content.
    $('#ml-host-panel').hidden=false;$('#ml-environment').textContent='PowerPoint 加载项';
    $('#ml-host-footer').hidden=false;$('#ml-host-capture').hidden=false;
    $('#ml-host-restore').after($('#ml-export-png'));
    $('#ml-geometry-field').hidden=true;$('#ml-background-field').hidden=true;$('#ml-preview-options').hidden=true;
    function layoutDockedPanel(docked){
      const editor=$('.ml-workspace'),preview=$('.ml-preview-column'),controls=$('.ml-controls');
      let scroll=$('#ml-docked-scroll');
      if(docked && !scroll){
        scroll=document.createElement('div');scroll.id='ml-docked-scroll';
        scroll.setAttribute('role','region');scroll.setAttribute('aria-label','预设与材质参数');
        // Keep the actual preview and its toolbar outside the scrolling controls.
        editor.append(scroll);
        scroll.append($('#ml-quick-presets'),controls);
      }else if(!docked && scroll){
        preview.append($('#ml-quick-presets'));
        editor.append(controls);scroll.remove();
      }
    }
    function syncPanelMode(data){
      if(data?.previewWorker===false && asyncRenderer){asyncRenderer.dispose();asyncRenderer=null;}
      if(!data?.panelMode)return;
      const docked=data.panelMode==='docked';
      root.dataset.panelMode=docked?'docked':'floating';
      arrangeWorkspace();
      document.documentElement.dataset.panelMode=root.dataset.panelMode;
      const modeButton=$('#ml-host-mode'),label=docked?'切换为悬浮':'停靠到右侧';
      modeButton.hidden=!data.canSwitchPanel;modeButton.setAttribute('aria-label',label);modeButton.title=label;
      modeButton.innerHTML=docked?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6-8 8M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 12h6m-2-2 2 2-2 2"/></svg>';
      $('#ml-host-pin').closest('label').hidden=docked;
      $('#ml-preview-toggle').hidden=true;root.dataset.previewCollapsed='false';
      if(!docked){root.dataset.previewCollapsed='false';$('#ml-preview-toggle').textContent='收起';$('#ml-preview-toggle').setAttribute('aria-expanded','true');}
      $('.ml-stage').style.removeProperty('max-width');
      requestAnimationFrame(()=>{window.dispatchEvent(new Event('resize'));schedule();});
    }
    function arrangeWorkspace(){
      const stacked=root.dataset.panelMode==='docked'||innerWidth<=640;
      root.dataset.stacked=String(stacked);layoutDockedPanel(stacked);
    }
    window.addEventListener('resize',arrangeWorkspace);
    host.on('host.ready',data=>{$('#ml-host-version').textContent=data.version?'v'+data.version:'';syncPanelMode(data);});
    host.on('panel.mode',syncPanelMode);
    $('#ml-host-mode').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{await host.request('setPanelMode',{mode:root.dataset.panelMode==='docked'?'floating':'docked'});}
      catch(error){hostNotify(error.message,true);}
      finally{button.disabled=false;}
    });
    $('#ml-preview-toggle').addEventListener('click',()=>{
      const collapsed=root.dataset.previewCollapsed!=='true';root.dataset.previewCollapsed=String(collapsed);
      $('#ml-preview-toggle').textContent=collapsed?'展开':'收起';$('#ml-preview-toggle').setAttribute('aria-expanded',String(!collapsed));
      if(!collapsed)schedule();
    });
    host.on('selection.changed',data=>{
      const candidate=ppt.target?{target:ppt.target,effect,id:workspace().activeId,synced:ppt.synced}:ppt.pendingSelection?.preserve||activeCapture?.preserve||ppt.failedDraft;
      const preserve=(data.supported!==false||data.readError)&&data.identity&&candidate?.target.identity===data.identity&&!data.materialChanged?candidate:null;
      ppt.readError=!!data.readError;ppt.failedDraft=preserve;
      // Keep the draft through repeated notifications while capture clears ppt.target.
      // A different target or external material change invalidates it immediately.
      if(activeCapture)activeCapture.preserve=preserve;
      recoveryAttempted=false;invalidateHostTarget();ppt.pendingSelection={...data,preserve,reapply:data.supported!==false&&!data.materialChanged};hostNotify(data.supported===false?(data.reason || '选择一个形状开始编辑'):'读取形状…');queueSelectionCapture();
    });
    $('#ml-host-pin').addEventListener('change',async event=>{
      try{await host.request('setPinned',{enabled:event.target.checked});}
      catch(error){event.target.checked=!event.target.checked;hostNotify(error.message,true);}
    });
    root.addEventListener('pointerdown',()=>{ppt.pointerDown=true;});
    window.addEventListener('pointerup',()=>{ppt.pointerDown=false;schedule();syncApplyState();});
    window.addEventListener('pointercancel',()=>{ppt.pointerDown=false;schedule();syncApplyState();});
    $('#ml-host-capture').addEventListener('click',()=>hostOperation(async()=>{
      const preserve=ppt.target?{target:ppt.target,effect,id:workspace().activeId,synced:ppt.synced}:ppt.failedDraft;
      invalidateHostTarget();hostNotify('刷新背景…');if(await readHostTarget({preserve,forceRefresh:true}))hostNotify('已就绪');
    }));
    $('#ml-host-apply').addEventListener('click',()=>hostOperation(()=>applyHostMaterial(),true));
    document.addEventListener('keydown',event=>{
      if(!event.ctrlKey||event.altKey||event.shiftKey||event.key!=='Enter'||event.repeat||root.querySelector('dialog[open]'))return;
      if(!root.contains(event.target)&&event.target!==document.body)return;
      if($('#ml-host-apply').disabled)return;
      event.preventDefault();event.stopPropagation();hostOperation(()=>applyHostMaterial(),true);
    });
    $('#ml-host-restore').addEventListener('click',()=>hostOperation(async()=>{
      const target=ppt.target;if(!target)throw new Error('请先读取选中形状。');
      ppt.synced=ppt.revision;hostNotify('恢复中…');await host.request('restoreMaterial',{token:target.token});
      try{await readHostTarget();hostNotify('已恢复原样');}
      catch(error){throw new Error('形状已恢复；重新读取未完成：'+error.message);}
    }));
    globalThis.PangPanelReady=(async()=>{
      try{
        const data=await host.request('hostStatus',{protocol:1},15000);
        syncPanelMode(data);ppt.quickSelection=!!data.quickSelection;ppt.connected=true;$('#ml-host-version').textContent=data.version?'v'+data.version:'';$('#ml-host-pin').checked=data.pinned!==false;syncHost();
        const selection=data.selection;
        if(selection?.supported===false){ppt.readError=!!selection.readError;syncHost();hostNotify(selection.reason||'选择一个形状');schedule();}
        else await hostOperation(async()=>{hostNotify('读取形状…');if(await readHostTarget())hostNotify('已就绪');});
      }catch(error){hostNotify('无法连接加载项：'+error.message,true);}
    })();
  }
  {
    $('#ml-export-png').addEventListener('click',async()=>{
      try{
        if(hosted && !ppt.target)throw new Error('请先读取 PowerPoint 中的形状。');
        const capturedEffect=effect,capturedShape=geometry.shape;
        const out=await exportRendered(currentOptions(),finalRenderScale());
        out.toBlob(blob=>{
          if(!blob){notify('导出失败，请重试。',true);return;}
          download(blob,'shape-'+capturedEffect+'-'+capturedShape+'.png');
          notify('已导出 '+out.width+' × '+out.height+' PNG，不含示例文字。'+(capturedEffect==='glass'?(hosted?'玻璃包含当前幻灯片背景采样。':'玻璃包含当前示例背景采样。'):''));
        },'image/png');
      }catch(error){notify('导出失败：'+error.message,true);}
    });
  }
  if(globalThis.MaterialHandles){
    handles=globalThis.MaterialHandles.create({canvas,overlay:$('#ml-overlay'),getFrame:()=>lastFrame?.card,
      getSelection:()=>{const layer=getLayer();return layer?{key:effect+'|'+workspace().activeId+'|'+layer.id,layer,visible:$('#ml-show-handles').checked&&layer.enabled&&(!hosted||!!ppt.target)}:null;},
      onChange:patch=>{const layer=getLayer();if(!layer)return;Object.assign(layer,patch);syncLayerFields();changed();},
      onStart:()=>{beginGesture(handles);handleTransaction={epoch:ppt.epoch,revision:ppt.revision,draft:getDraft(),snapshot:clone(getDraft()),details:layerDetailsOpen,undo:undoSteps.slice()};},
      onDuplicate:()=>{
        const draft=getDraft(),source=getLayer();
        if(!source||draft.settings.layers.length>=16){notify('最多支持 16 个效果图层。',true);return null;}
        const copy={...clone(source),id:uid(),name:(source.name+' 副本').slice(0,40)};
        draft.settings.layers.splice(draft.settings.layers.indexOf(source)+1,0,copy);draft.layerId=copy.id;layerDetailsOpen=true;
        // Update the drag identity before refreshing the handles for the new selection.
        queueMicrotask(()=>{syncLayers();changed();});
        return effect+'|'+workspace().activeId+'|'+copy.id;
      },
      onFinish:result=>{if(result==='cancel'){
        if(handleTransaction?.epoch===ppt.epoch && handleTransaction.draft===getDraft()){Object.assign(getDraft(),clone(handleTransaction.snapshot));layerDetailsOpen=handleTransaction.details;ppt.revision=handleTransaction.revision;undoSteps.splice(0,undoSteps.length,...handleTransaction.undo);historyState=historySnapshot();syncLayers();syncName();schedule();syncApplyState();}
      }handleTransaction=null;finishGesture();}
    });
    $('#ml-show-handles').addEventListener('change',()=>handles.update());
  }
  controlsUI=globalThis.MaterialControls?.create(root);
  root.querySelectorAll('details').forEach(el=>{
    const summary=el.querySelector('summary');let animation=null,expanded=el.open;
    el.dataset.expanded=String(expanded);
    const finish=()=>{animation?.cancel();animation=null;el.open=expanded;el.style.height='';el.style.overflow='';};
    el.finishDisclosure=()=>{if(animation)finish();};
    summary.addEventListener('click',event=>{
      event.preventDefault();
      const start=el.getBoundingClientRect().height;
      expanded=animation?!expanded:!el.open;animation?.cancel();animation=null;
      el.open=true;el.style.height='';el.dataset.expanded=String(expanded);
      const end=expanded?el.getBoundingClientRect().height:summary.getBoundingClientRect().height+parseFloat(getComputedStyle(summary).marginBottom||0);
      if(reducedMotion.matches){finish();return;}
      el.style.overflow='hidden';
      animation=el.animate([{height:start+'px',opacity:expanded?.86:1},{height:end+'px',opacity:expanded?1:.86}],{duration:180,easing:'cubic-bezier(.22,1,.36,1)'});
      animation.onfinish=finish;
    });
  });
  libraryUI=globalThis.MaterialLibraryUI?.create({root,api,library,builtinNames,download,notify,controls:controlsUI,
    current:()=>({effect,id:workspace().activeId,draft:getDraft()}),
    beforeOpen:()=>{if(handles)handles.cancel();},afterClose:()=>syncApplyState(),
    use:record=>{effect=record.effect;selectPreset(record.id);},save:activateRecord,
    remove:record=>{for(const mode of Object.values(modes)){const draft=mode.drafts.get(record.id);if(draft){const id='draft:'+uid();mode.drafts.set(id,{...draft,originalName:'',initial:''});mode.drafts.delete(record.id);if(mode.activeId===record.id)mode.activeId=id;}}syncName();},
    rename:record=>{for(const mode of Object.values(modes)){const draft=mode.drafts.get(record.id);if(draft){draft.name=record.name;draft.originalName=record.name;}}syncName();}
  });
  syncControls();resetHistory();
  if(hosted)notify('');
  if(library.storageWarning)notify(library.storageWarning);
  if(typeof ResizeObserver!=='undefined'){
    new ResizeObserver(schedule).observe(canvas);
    if(hosted){
      const column=$('.ml-preview-column'),stage=$('.ml-stage');let resizeQueued=false;
      const fitPreview=()=>{resizeQueued=false;if(innerWidth<=640||root.dataset.panelMode==='docked'){stage.style.removeProperty('max-width');return;}
        const style=getComputedStyle(column);let occupied=0;
        for(const child of column.children){if(child===stage || getComputedStyle(child).display==='none')continue;const css=getComputedStyle(child);occupied+=child.getBoundingClientRect().height+(parseFloat(css.marginTop)||0)+(parseFloat(css.marginBottom)||0);}
        const height=Math.max(120,column.clientHeight-occupied-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0)-4);
        const maxWidth=Math.floor(height*1.25)+'px';if(stage.style.maxWidth!==maxWidth)stage.style.maxWidth=maxWidth;
      };
      const observer=new ResizeObserver(()=>{if(!resizeQueued){resizeQueued=true;requestAnimationFrame(fitPreview);}});
      observer.observe(column);for(const selector of ['.ml-preview-bar','.ml-preset-toolbar','#ml-quick-presets','#ml-status'])observer.observe($(selector));
    }
  }
})();
