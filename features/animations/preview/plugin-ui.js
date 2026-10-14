(function () {
  const $=id=>document.getElementById(id);
  const demo=new URLSearchParams(location.search).get('demo')==='1';
  let session=null, selection=null, busy=false, operation='', lastNumericSelection=null, topmost=true;
  let applied=null, dirty=false, nativePreviewActive=false;
  const embedded=new URLSearchParams(location.search).get('embedded')==='1' && !!globalThis.chrome?.webview;
  const pending=new Map();let requestId=0;
  if(demo){session='demo';selection={ok:true,count:1,name:'示例元素',signature:'demo'};applied={selection:'demo',effectId:MotionPreview.getState().effectId,token:'demo'};}
  if(embedded) chrome.webview.addEventListener('message',event=>{
    const item=pending.get(event.data.id);if(!item)return;
    pending.delete(event.data.id);clearTimeout(item.timer);
    const value=event.data.value;value.ok?item.resolve(value):item.reject(new Error(value.error||'操作未完成'));
  });
  async function request(route,data) {
    if(embedded)return new Promise((resolve,reject)=>{
      const id=String(++requestId);
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('PPT 响应超时，请检查当前动画是否已应用。'));},120000);
      pending.set(id,{resolve,reject,timer});chrome.webview.postMessage({id,route,data:data||null,session});
    });
    const response=await fetch('/api/'+route,{method:data?'POST':'GET',cache:'no-store',
      headers:data?{'Content-Type':'application/json','X-Pang-Session':session}:undefined,
      body:data?JSON.stringify(data):undefined});
    if(!response.ok)throw new Error('PPT 连接暂不可用');
    const value=await response.json();if(!value.ok)throw new Error(value.error||'操作未完成');return value;
  }
  const matchesApplied=()=>!!applied && !!selection?.count && applied.selection===selection.signature;
  const canPreview=()=>!!selection?.count && (selection.animationCount>0 || (selection.animationCount==null && matchesApplied()));
  function actionLabel(){
    if(nativePreviewActive)return '正在预览…';
    if(busy)return operation==='preview'?'正在预览…':operation==='update'?'正在更新…':'正在应用…';
    if(matchesApplied())return dirty?'更新并预览':'预览动画';
    return '预览动画';
  }
  function refreshControls(){
    const effect=MotionCatalog.effects.find(e=>e.id===MotionPreview.getState().effectId);
    const ready=!!session && !!selection?.count;
    $('apply-animation').disabled=busy||nativePreviewActive||!ready||!(canPreview()||(matchesApplied()&&dirty));
    $('replace-mode').disabled=busy||nativePreviewActive;
    $('start-trigger').disabled=busy||nativePreviewActive;
    $('apply-animation').textContent=actionLabel();
    $('connection-dot').classList.toggle('connected',!!session);
    $('selection-status').textContent=demo?'示例元素 · 界面预览':busy?(operation==='preview'?'正在调用 PowerPoint 预览…':'正在写入 PPT 动画…'):ready?`已选择 ${selection.count} 个元素${selection.count===1?' · '+selection.name:''}`:session?'请在 PPT 中选择元素':'未连接 PowerPoint';
    $('apply-help').textContent=demo?'仅演示界面交互，不写入 PowerPoint。':ready?(canPreview()&&!(matchesApplied()&&dirty)?'在当前编辑页面调用 PowerPoint 原生动画预览，按当前页时间线播放。':matchesApplied()?'参数已变化，更新后在当前编辑页面预览。':effect?.native.target==='multiple'?'选择至少两个元素，再点击动画卡片立即应用。':['number-count','number-roll'].includes(effect?.id)?'选择数字文本框，再点击动画卡片立即应用。':'点击动画卡片即可立即应用。'):session?'选择元素后，回到面板点击动画卡片。':'在 PowerPoint 功能区打开「旁门动画库」即可应用。';
  }
  function markDirty(){if(busy)return;dirty=true;refreshControls();}
  function syncNumber(value){
    if(!value.numeric || !['number-count','number-roll'].includes(MotionPreview.getState().effectId))return;
    const key=JSON.stringify([value.signature,value.numeric]);
    if(key===lastNumericSelection)return;
    if(lastNumericSelection!==null && applied?.selection===value.signature)dirty=true;
    const n=value.numeric,wasPlaying=MotionPreview.getState().playing;
    MotionPreview.updateParameters({numberMinDigits:n.minDigits||1,numberSign:n.sign||'',numberStart:0,numberEnd:n.value,numberDecimals:n.decimals,numberGrouping:n.grouping,numberPrefix:n.prefix||'',numberSuffix:n.suffix||''},wasPlaying && operation!=='preview' && !nativePreviewActive);
    lastNumericSelection=key;
  }
  async function poll(force=false){
    if(demo){refreshControls();return;}
    // Selection availability must update even while a looping card preview is
    // playing; otherwise existing PPT animations can stay disabled indefinitely.
    if(busy || document.visibilityState==='hidden' || (embedded && !force && !document.hasFocus()))return;
    try{if(!session){const boot=await request('bootstrap');session=boot.session;topmost=boot.topmost!==false;$('pin-toggle').checked=topmost;}const current=await request('selection');nativePreviewActive=!!current.previewing;if(nativePreviewActive){refreshControls();return;}selection=current;if(applied && applied.selection!==selection.signature){applied=null;dirty=false;}syncNumber(selection);}
    catch{session=null;selection=null;}
    refreshControls();
  }
  async function preview(){
    if(demo){
      if(!globalThis.PangSurface || PangSurface.wantsStage()){MotionPreview.seek(0);MotionPreview.play();}
      MotionPreview.notify('界面预览：正在模拟选中元素动画预览，不写入 PPT。');return true;
    }
    if(busy||nativePreviewActive)return false;
    if(!session||!canPreview()){MotionPreview.notify('请先选择已有动画的元素。');return false;}
    MotionPreview.pause();MotionPreview.stopHover();busy=true;operation='preview';refreshControls();
    try{
      const expected=selection.signature,current=await request('selection');selection=current;
      if(current.signature!==expected){applied=null;dirty=false;throw new Error('PPT 选区已变化，请重新点击预览。');}
      if(!canPreview())throw new Error('选中元素还没有动画。');
      await request('preview',{selection:selection.signature});return true;
    }
    catch(error){MotionPreview.notify(error.message);return false;}
    finally{busy=false;operation='';refreshControls();await poll(true);}
  }
  async function apply(id,options={}){
    if(demo){
      applied={selection:'demo',effectId:id||MotionPreview.getState().effectId,token:'demo'};dirty=false;refreshControls();
      if(!globalThis.PangSurface || PangSurface.wantsStage()){MotionPreview.seek(0);MotionPreview.play();}
      if(options.previewAfter)await preview();
      return true;
    }
    if(busy||nativePreviewActive)return false;
    if(!session){MotionPreview.notify('当前为界面预览。请在 PowerPoint 功能区打开旁门动画库。');return;}
    const isUpdate=!id&&matchesApplied();
    // Writing PPT tracks must not stop the independent floating sample preview.
    // Only the explicit native-preview action takes over playback.
    if(options.previewAfter)MotionPreview.pause();
    busy=true;operation=isUpdate?'update':'apply';refreshControls();
    let success=false;
    try {
      const current=await request('selection');if(!current.count)throw new Error('请先在 PPT 中选择元素。');
      if(['number-count','number-roll'].includes(id||MotionPreview.getState().effectId)&&current.numericError)throw new Error(current.numericError);
      lastNumericSelection=null;syncNumber(current);
      const state=MotionPreview.getState(),plan=PangNativePlan(id||state.effectId,state.options);
      const result=await request('apply',{selection:current.signature,plan,trigger:Number($('start-trigger').value),replaceExisting:$('replace-mode').value==='replace',updateToken:isUpdate?applied.token:null});
      selection=current;applied={selection:current.signature,effectId:plan.id,token:result.token||null};dirty=false;success=true;
    } catch(error){MotionPreview.notify(error.message);}finally{busy=false;operation='';refreshControls();await poll(true);}
    if(success&&options.previewAfter)await preview();
    return success;
  }
  async function primaryAction(){if(matchesApplied()&&dirty)return apply(null,{previewAfter:true});return preview();}
  async function changeSurface(mode){
    if(!['floating','sidebar'].includes(mode))return;
    try{
      if(demo){
        if(parent!==window)parent.postMessage({type:'pangmen-animation-surface',mode},location.origin);
        else PangSurface.set(mode);
        return;
      }
      if(!embedded){PangSurface.set(mode);return;}
      if(!session)session=(await request('bootstrap')).session;
      await request('mode',{mode});
    }catch(error){MotionPreview.notify(error.message);}
  }
  async function changeTopmost(enabled){
    topmost=!!enabled;
    try{
      if(demo){
        if(parent!==window)parent.postMessage({type:'pangmen-animation-topmost',enabled:topmost},location.origin);
        return;
      }
      if(!embedded)return;
      if(!session){const boot=await request('bootstrap');session=boot.session;}
      const result=await request('topmost',{enabled:topmost});
      topmost=result.topmost!==false;$('pin-toggle').checked=topmost;
    }catch(error){$('pin-toggle').checked=!topmost;topmost=!topmost;MotionPreview.notify(error.message);}
  }
  $('apply-animation').addEventListener('click',primaryAction);
  $('start-trigger').addEventListener('change',markDirty);
  document.addEventListener('pang:effectchange',markDirty);
  document.addEventListener('pang:parameterchange',markDirty);
  $('pin-toggle').addEventListener('change',event=>changeTopmost(event.target.checked));
  globalThis.PangPlugin={apply,poll:()=>poll(true),preview,changeSurface,changeTopmost,getState:()=>({busy,dirty,applied:{...applied}})};

  // Custom select uses real buttons and preserves the original form field/change event.
  let opened=null;
  function close(){if(opened){opened.list.hidden=true;opened.button.setAttribute('aria-expanded','false');opened=null;}}
  document.querySelectorAll('select').forEach(select=>{
    const wrap=document.createElement('div');wrap.className='brand-select';select.parentNode.insertBefore(wrap,select);wrap.appendChild(select);select.hidden=true;
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    const list=document.createElement('div');list.className='brand-select-list';list.id=select.id+'-options';list.setAttribute('role','listbox');list.hidden=true;button.setAttribute('aria-controls',list.id);
    wrap.append(button,list);
    const label=select.getAttribute('aria-label')||select.closest('label')?.querySelector('span')?.textContent||'选项';button.setAttribute('aria-label',label);
    function sync(){const label=select.selectedOptions[0]?.textContent||'';if(button.textContent!==label)button.textContent=label;button.disabled=select.disabled;for(const b of list.children)b.setAttribute('aria-selected',String(b.dataset.value===select.value));}
    for(const opt of select.options){const b=document.createElement('button');b.type='button';b.textContent=opt.textContent;b.dataset.value=opt.value;b.setAttribute('role','option');b.addEventListener('click',e=>{e.preventDefault();select.value=opt.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();button.focus();});list.appendChild(b);}
    button.addEventListener('click',e=>{e.preventDefault();const was=opened?.button===button;close();if(!was){list.hidden=false;button.setAttribute('aria-expanded','true');opened={list,button};list.querySelector('[aria-selected=true]')?.focus();}});
    wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();e.stopPropagation();}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();if(list.hidden)button.click();const children=[...list.children];let i=children.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?children.length-1:(i+(e.key==='ArrowDown'?1:-1)+children.length)%children.length;children[i].focus();}});
    select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{attributes:true,attributeFilter:['disabled']});sync();
    // app syncControls also assigns values without dispatching change.
    document.addEventListener('pang:controls',sync);
  });
  document.addEventListener('pointerdown',e=>{if(opened&&!e.target.closest('.brand-select'))close();});
  document.addEventListener('focusin',e=>{if(opened&&!e.target.closest('.brand-select'))close();});
  const tooltip=document.createElement('div');tooltip.className='brand-tooltip';tooltip.id='pang-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;document.body.appendChild(tooltip);
  let tipTimer=0,tipTarget=null;
  function hideTip(){clearTimeout(tipTimer);tooltip.hidden=true;if(tipTarget)tipTarget.removeAttribute('aria-describedby');tipTarget=null;}
  function showTip(target){hideTip();tipTimer=setTimeout(()=>{if(!target.isConnected)return;tipTarget=target;tooltip.textContent=target.dataset.tooltip;tooltip.hidden=false;target.setAttribute('aria-describedby',tooltip.id);const r=target.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(innerWidth-tooltip.offsetWidth-8,r.left))+'px';tooltip.style.top=Math.max(8,Math.min(innerHeight-tooltip.offsetHeight-8,r.bottom+7))+'px';},550);}
  document.addEventListener('pointerover',e=>{const t=e.target.closest('[data-tooltip]');if(t&&!t.contains(e.relatedTarget))showTip(t);});
  document.addEventListener('pointerout',e=>{const t=e.target.closest('[data-tooltip]');if(t && (!e.relatedTarget || !t.contains(e.relatedTarget)))hideTip();});
  document.addEventListener('focusin',e=>{const t=e.target.closest('[data-tooltip]');if(t)showTip(t);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();},true);document.addEventListener('scroll',hideTip,true);
  new MutationObserver(refreshControls).observe($('effect-name'),{childList:true});
  window.addEventListener('focus',()=>poll(true));
  document.addEventListener('pointerenter',()=>poll(true));
  globalThis.PangPanelReady=poll(true);setInterval(poll,2000);
})();
