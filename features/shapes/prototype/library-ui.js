(function(global){
 'use strict';
 function create({root,api,library,builtinNames,download,notify,current,beforeOpen,afterClose,use,save,remove,rename,controls}){
  const $=s=>root.querySelector(s);let type='gradient',query='',sort='recent',selected=null,undo=null,undoTimer=null,saveAction=null;
  let meta={panel:{},recent:{}};try{const stored=JSON.parse(localStorage.getItem('ppt-material-library-meta-v1')||'null');if(stored&&typeof stored==='object'){if(stored.recent&&typeof stored.recent==='object'&&!Array.isArray(stored.recent))meta.recent=stored.recent;for(const effect of ['gradient','glass'])if(Array.isArray(stored.panel?.[effect]))meta.panel[effect]=[...new Set(stored.panel[effect].filter(x=>typeof x==='string'))].slice(0,6);}}catch{}
  const persist=()=>{try{localStorage.setItem('ppt-material-library-meta-v1',JSON.stringify(meta));return true;}catch{message('面板显示设置或最近使用记录未能保存到本机。');return false;}};
  const markup=`<dialog id="ml-library-dialog" aria-labelledby="ml-library-heading"><div class="ml-library-shell">
   <div class="ml-library-header"><strong class="ml-library-title" id="ml-library-heading">预设库</strong><div class="ml-library-types" role="group" aria-label="预设类型"><button class="ml-action" type="button" data-library-type="gradient">弥散渐变</button><button class="ml-action" type="button" data-library-type="glass">液态玻璃</button></div><div class="ml-actions"><button class="ml-action" id="ml-library-import" type="button">导入</button><button class="ml-icon-button" id="ml-library-close" type="button" aria-label="关闭预设库">×</button></div></div>
   <div class="ml-library-tools"><input type="search" id="ml-library-search" aria-label="搜索预设" placeholder="搜索预设"><select id="ml-library-sort" aria-label="预设排序"><option value="recent">排序：最近使用</option><option value="name">排序：名称</option></select></div>
   <div class="ml-library-body"><div id="ml-library-grid" class="ml-library-grid" role="list" aria-label="预设列表"></div></div>
   <div id="ml-library-record-actions" class="ml-record-menu" hidden><button type="button" id="ml-library-rename">重命名</button><button type="button" id="ml-library-copy">复制</button><button type="button" id="ml-library-export">导出</button><button type="button" id="ml-library-delete">删除</button></div>
   <div class="ml-library-footer"><span id="ml-library-panel-count" class="ml-note" aria-live="polite"></span><div id="ml-library-message" role="status" aria-live="polite"></div></div><input type="file" id="ml-library-file" accept=".json,application/json" hidden>
  </div></dialog><dialog id="ml-save-dialog" aria-labelledby="ml-save-heading"><form id="ml-save-form"><h3 id="ml-save-heading">保存预设</h3><label class="ml-field"><span class="ml-label">预设名称</span><input id="ml-save-name" type="text" maxlength="60" required></label><div id="ml-save-error" role="alert"></div><div class="ml-actions"><button type="button" class="ml-action" id="ml-save-cancel">取消</button><button type="button" class="ml-action" id="ml-save-update">更新当前</button><button type="submit" class="ml-action ml-primary" id="ml-save-confirm">另存副本</button></div></form></dialog>`;
  root.insertAdjacentHTML('beforeend',markup);const dialog=$('#ml-library-dialog'),saveDialog=$('#ml-save-dialog');controls?.enhance();
  const art=new Image();art.src=global.MaterialLibraryArtwork||'';const scene=document.createElement('canvas');scene.width=900;scene.height=720;
  const artReady=art.decode().then(()=>{const x=scene.getContext('2d'),scale=Math.max(900/art.width,720/art.height);x.drawImage(art,(900-art.width*scale)/2,(720-art.height*scale)/2,art.width*scale,art.height*scale);},()=>scene.getContext('2d').drawImage(MaterialBackgrounds.create('silk'),0,0));
  const black=document.createElement('canvas');black.width=900;black.height=720;black.getContext('2d').fillRect(0,0,900,720);
  const thumbs=new Map();let renderEpoch=0,thumbObserver=null,thumbnailsAfter=0;
  let thumbRenderer=global.MaterialAsyncRenderer?.create();
  const pendingThumbs=new Map();
  function records(){return [...Object.keys(api.presets).map(key=>({id:'builtin:'+key,name:builtinNames[key]||api.presets[key].label,effect:api.presets[key].effect,previewShape:api.presets[key].previewShape,settings:api.createOptions(key),builtin:true})),...library.list()];}
  function getRecord(id){return records().find(x=>x.id===id);}
  function panelIds(effect){
   const all=records().filter(r=>r.effect===effect);
   if(!Array.isArray(meta.panel[effect]))meta.panel[effect]=all.filter(r=>r.builtin).slice(0,6).map(r=>r.id);
   return meta.panel[effect].filter(id=>all.some(r=>r.id===id)).slice(0,6);
  }
  function syncPanelChoices(){
   const ids=panelIds(type);$('#ml-library-panel-count').textContent='在面板显示 '+ids.length+' / 6';
   root.querySelectorAll('.ml-panel-choice').forEach(button=>{const chosen=ids.includes(button.dataset.id);button.setAttribute('aria-pressed',String(chosen));const label=(chosen?'从面板移除':'在面板显示')+' '+button.dataset.name;button.setAttribute('aria-label',label);button.title=label;});
  }
  function togglePanel(record){
   const ids=panelIds(record.effect),chosen=ids.includes(record.id);
   if(!chosen&&ids.length>=6){message('最多显示 6 个预设，请先取消一个。');return;}
   const previous=meta.panel[record.effect];meta.panel[record.effect]=chosen?ids.filter(id=>id!==record.id):[...ids,record.id];
   if(!persist()){meta.panel[record.effect]=previous;return;}
   message('');syncPanelChoices();refreshQuick();
  }
  function message(text){$('#ml-library-message').textContent=text;}
  async function draw(canvas,record){
   const key=record.effect+'|'+(record.previewShape||'roundedRect')+JSON.stringify(record.settings);canvas.dataset.recipe=key;
   if(record.effect==='glass')await artReady;
   if(canvas.dataset.recipe!==key||!canvas.isConnected)return;
   if(!thumbs.has(key)){
    if(!pendingThumbs.has(key))pendingThumbs.set(key,(async()=>{
     const c=document.createElement('canvas');c.width=300;c.height=240;
     const options={...record.settings,thumbnail:true,shape:record.previewShape==='circle'?'ellipse':'roundedRect',...(record.previewShape==='circle'?{previewAspect:1}:{}),radius:34,content:false,backgroundCanvas:record.effect==='glass'?scene:black};
     let rendered=false;
     if(thumbRenderer)try{const bitmap=await thumbRenderer.render(options,1,true);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();rendered=true;root.dataset.thumbnailRenderer='worker';}catch{thumbRenderer=null;root.dataset.thumbnailRenderer='fallback';}
     if(!rendered){await new Promise(resolve=>setTimeout(resolve,40));api.render(c,options);}
     if(thumbs.size>=110)thumbs.delete(thumbs.keys().next().value);thumbs.set(key,c);
    })().finally(()=>pendingThumbs.delete(key)));
    await pendingThumbs.get(key);
   }
   if(canvas.isConnected&&canvas.dataset.recipe===key&&thumbs.has(key))canvas.getContext('2d').drawImage(thumbs.get(key),0,0,canvas.width,canvas.height);
  }
  let quickSignature='';
  function useRecord(record){if(!record)return;meta.recent[record.id]=Date.now();persist();if(dialog.open)close();use(record);refreshQuick();}
  function refreshQuick(){
   const state=current(),all=records().filter(r=>r.effect===state.effect);
   const list=panelIds(state.effect).map(id=>all.find(r=>r.id===id)).filter(Boolean);
   const signature=JSON.stringify(list);const grid=$('#ml-quick-presets');
   if(signature!==quickSignature){quickSignature=signature;grid.replaceChildren();
    list.forEach(record=>{
    const button=document.createElement('button');button.type='button';button.className='ml-quick-preset';button.dataset.id=record.id;button.title='使用 '+record.name;button.setAttribute('aria-label','使用 '+record.name);
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=192;
    const name=document.createElement('span');name.textContent=Array.from(record.name).slice(0,4).join('');button.append(canvas,name);grid.append(button);draw(canvas,record);button.addEventListener('click',()=>useRecord(record));
   });
   }
   grid.querySelectorAll('.ml-quick-preset').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.id===state.id)));
  }
  function selection(){
   $('#ml-library-record-actions').hidden=true;
   root.querySelectorAll('.ml-library-card').forEach(c=>c.dataset.selected=String(c.dataset.id===current().id));
  }
  function render(){
   $('.ml-library-types').dataset.selected=type;
   const epoch=++renderEpoch;root.querySelectorAll('[data-library-type]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.libraryType===type)));
   let list=records().filter(r=>r.effect===type&&r.name.toLowerCase().includes(query.toLowerCase()));
   list.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):(Number(meta.recent[b.id])||0)-(Number(meta.recent[a.id])||0)||a.name.localeCompare(b.name,'zh-CN'));
   if(!list.some(r=>r.id===selected))selected=list[0]?.id||null;
   const grid=$('#ml-library-grid');thumbObserver?.disconnect();thumbObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const record=getRecord(entry.target.closest('.ml-library-card').dataset.id);if(record&&epoch===renderEpoch){const wait=Math.max(0,thumbnailsAfter-performance.now());if(wait)setTimeout(()=>{if(epoch===renderEpoch && entry.target.isConnected)draw(entry.target,record);},wait);else draw(entry.target,record);}thumbObserver.unobserve(entry.target);}},{root:grid,rootMargin:'100px'});grid.replaceChildren();if(!list.length){const empty=document.createElement('div');empty.className='ml-library-empty';empty.textContent=query?'没有匹配的预设':'暂无预设';grid.append(empty);}
   list.forEach(record=>{
    const card=document.createElement('div');card.className='ml-library-card';card.dataset.id=record.id;card.setAttribute('role','listitem');
    const pick=document.createElement('div');pick.className='ml-card-pick';
    const canvas=document.createElement('canvas');canvas.width=300;canvas.height=240;const name=document.createElement('span');name.className='ml-card-name';name.textContent=record.name;name.title=record.name;pick.append(canvas);
    const bottom=document.createElement('div');bottom.className='ml-card-bottom';const actions=document.createElement('div');actions.className='ml-actions';
    const panelChoice=document.createElement('button');panelChoice.type='button';panelChoice.className='ml-panel-choice';panelChoice.dataset.id=record.id;panelChoice.dataset.name=record.name;panelChoice.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6"/></svg>';panelChoice.addEventListener('click',()=>togglePanel(record));actions.append(panelChoice);
    const more=document.createElement('button');more.type='button';more.className='ml-icon-button ml-library-more';more.textContent='⋯';more.setAttribute('aria-label','管理 '+record.name);more.addEventListener('click',()=>{
     selected=record.id;const menu=$('#ml-library-record-actions'),wasOpen=!menu.hidden&&menu.dataset.id===record.id;selection();if(wasOpen)return;
     menu.dataset.id=record.id;menu.hidden=false;$('#ml-library-rename').hidden=!!record.builtin;$('#ml-library-delete').hidden=!!record.builtin;
     const rect=more.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(rect.right-150,innerWidth-158))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+5,innerHeight-menu.offsetHeight-8))+'px';$('#ml-library-copy').focus();
    });actions.append(more);
    const apply=document.createElement('button');apply.type='button';apply.className='ml-card-use';apply.textContent='使用预设';apply.setAttribute('aria-label','使用预设 '+record.name);apply.addEventListener('click',()=>useRecord(record));
    bottom.append(name,actions);card.append(pick,bottom,apply);grid.append(card);
    thumbObserver.observe(canvas);
   });selection();syncPanelChoices();controls?.refresh();refreshQuick();
  }
  function open(){beforeOpen();type=current().effect;query='';$('#ml-library-search').value='';selected=current().id;message('');dialog.showModal();render();$('#ml-library-grid').scrollTop=0;}
  function close(){controls?.close();dialog.close();}
  dialog.addEventListener('close',()=>{renderEpoch++;thumbObserver?.disconnect();afterClose();});$('#ml-library-close').onclick=close;
  $('#ml-open-library').onclick=open;
  root.querySelectorAll('[data-library-type]').forEach(b=>b.onclick=()=>{type=b.dataset.libraryType;thumbnailsAfter=performance.now()+300;render();});
  $('#ml-library-sort').onchange=e=>{sort=e.target.value;render();};$('#ml-library-search').oninput=e=>{query=e.target.value;render();};
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.ml-library-more')&&!e.target.closest('#ml-library-record-actions'))$('#ml-library-record-actions').hidden=true;});
  $('#ml-library-grid').addEventListener('scroll',()=>$('#ml-library-record-actions').hidden=true);
  $('#ml-library-record-actions').addEventListener('click',()=>$('#ml-library-record-actions').hidden=true);
  $('#ml-library-record-actions').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();$('#ml-library-record-actions').hidden=true;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...$('#ml-library-record-actions').querySelectorAll('button')].filter(b=>!b.hidden),i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}});
  function promptName(title,value,action,update=false){beforeOpen();saveAction=action;$('#ml-save-heading').textContent=title;$('#ml-save-name').value=value;$('#ml-save-error').textContent='';$('#ml-save-update').hidden=!update;$('#ml-save-confirm').textContent=title==='保存预设'?'另存副本':'确定';saveDialog.showModal();$('#ml-save-name').focus();$('#ml-save-name').select();}
  function submit(update){try{const name=$('#ml-save-name').value.trim();if(!name)throw new Error('请输入预设名称。');saveAction(name,update);saveDialog.close();}catch(e){$('#ml-save-error').textContent=e.message;}}
  $('#ml-save-form').onsubmit=e=>{e.preventDefault();submit(false);};$('#ml-save-update').onclick=()=>submit(true);$('#ml-save-cancel').onclick=()=>saveDialog.close();saveDialog.addEventListener('close',afterClose);
  $('#ml-save-preset').onclick=()=>{const state=current(),snapshot=JSON.parse(JSON.stringify(state.draft.settings)),id=state.id;promptName('保存预设',state.draft.name,(name,update)=>{const r=update?library.update(id,name,snapshot):library.saveNew(name,snapshot);save(r);},library.list().some(r=>r.id===id));};
  $('#ml-library-rename').onclick=()=>{const r=getRecord(selected);if(!r||r.builtin)return;promptName('重命名预设',r.name,name=>{const updated=library.update(r.id,name,r.settings);rename(updated);render();message('已重命名。');});};
  $('#ml-library-copy').onclick=()=>{const r=getRecord(selected);if(!r)return;promptName('复制预设',r.name+' 副本',name=>{const copy=library.saveNew(name,r.settings);query='';$('#ml-library-search').value='';selected=copy.id;render();message('已复制到我的预设。');});};
  $('#ml-library-export').onclick=()=>{const r=getRecord(selected);if(!r)return;download(new Blob([library.exportPreset(r.name,r.settings)],{type:'application/json'}),'shape-material-preset.json');message('已导出预设文件。');};
  function deleteRecord(r){
   if(!r||r.builtin)return;
   const ids=panelIds(r.effect),panelIndex=ids.indexOf(r.id);
   library.remove(r.id);meta.panel[r.effect]=ids.filter(id=>id!==r.id);persist();remove(r);
   clearTimeout(undoTimer);undo={record:r,panelIndex};render();message('已删除预设。');
   const button=document.createElement('button');button.type='button';button.textContent='撤销';$('#ml-library-message').append(button);
   button.onclick=()=>{try{
    if(!undo)return;const restored=undo.record;library.restore(restored);selected=restored.id;
    const currentIds=panelIds(restored.effect);
    if(undo.panelIndex>=0&&currentIds.length<6){currentIds.splice(Math.min(undo.panelIndex,currentIds.length),0,restored.id);meta.panel[restored.effect]=currentIds;persist();}
    undo=null;clearTimeout(undoTimer);render();message('已恢复预设。');
   }catch(e){message(e.message);}};
   undoTimer=setTimeout(()=>{undo=null;message('预设已删除，当前编辑内容保留。');},7000);
  }
  $('#ml-library-delete').onclick=()=>deleteRecord(getRecord(selected));
  $('#ml-library-import').onclick=()=>$('#ml-library-file').click();$('#ml-library-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>200*1024)throw new Error('预设文件不能超过 200 KB。');const r=library.importPreset(await file.text());if(!dialog.open)dialog.showModal();type=r.effect;query='';$('#ml-library-search').value='';selected=r.id;render();message(library.storageWarning||'已导入到我的预设；点击使用后才载入编辑器。');}catch(error){message(error.message);}finally{e.target.value='';}};
  refreshQuick();return {open,refreshQuick};
 }
 global.MaterialLibraryUI={create};
})(globalThis);
