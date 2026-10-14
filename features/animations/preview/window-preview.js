(function(){
 const desktop=document.getElementById('desktop'),panel=document.getElementById('plugin-window'),frame=document.getElementById('plugin-frame');
 let mode='floating',drag=null;
 function layout(){frame.contentWindow?.PangSurface?.set(mode==='sidebar'||innerWidth<760?'sidebar':'floating');}
 function set(next){mode=next;desktop.dataset.view=mode;panel.removeAttribute('style');document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.view===mode));});document.getElementById('reset-window').disabled=mode==='sidebar';layout();}
 document.querySelectorAll('button[data-view]').forEach(b=>b.onclick=()=>set(b.dataset.view));
 addEventListener('message',event=>{if(event.origin!==location.origin)return;if(event.data?.type==='pangmen-animation-surface')set(event.data.mode);if(event.data?.type==='pangmen-animation-topmost')panel.dataset.pinned=String(event.data.enabled);});
 document.getElementById('reset-window').onclick=()=>set(mode);
 frame.src='index.html?surface=floating&demo=1&refresh='+Date.now();
 frame.addEventListener('load',layout);addEventListener('resize',()=>{panel.removeAttribute('style');layout();});
 const title=document.getElementById('window-title');
 title.addEventListener('pointerdown',e=>{if(mode!=='floating'||e.target.closest('button'))return;const r=panel.getBoundingClientRect(),d=desktop.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left-d.left,top:r.top-d.top};title.setPointerCapture(e.pointerId);panel.style.transform='none';panel.style.left=drag.left+'px';panel.style.top=drag.top+'px';});
 title.addEventListener('pointermove',e=>{if(!drag)return;panel.style.left=Math.max(0,Math.min(desktop.clientWidth-panel.offsetWidth,drag.left+e.clientX-drag.x))+'px';panel.style.top=Math.max(0,Math.min(desktop.clientHeight-panel.offsetHeight,drag.top+e.clientY-drag.y))+'px';});
 title.addEventListener('pointerup',()=>drag=null);title.addEventListener('pointercancel',()=>drag=null);
})();
