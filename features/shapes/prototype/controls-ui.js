(function(global){
 'use strict';
 function create(root){
  const selects=new Map(),numbers=new Map();let popup=null,owner=null,ownerRect=null;
  let tip=null,tipOwner=null,tipTimer=null;
  function convertTitle(node){
   if(node.nodeType!==1)return;
   if(node.hasAttribute('title')){node.dataset.mlTooltip=node.getAttribute('title');node.removeAttribute('title');}
   node.querySelectorAll('[title]').forEach(convertTitle);
  }
  function hideTip(){
   clearTimeout(tipTimer);
   if(tipOwner&&tip){const ids=(tipOwner.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);if(ids.length)tipOwner.setAttribute('aria-describedby',ids.join(' '));else tipOwner.removeAttribute('aria-describedby');}
   tip?.remove();tip=null;tipOwner=null;
  }
  function requestTip(target){
   const anchor=target.closest?.('[title],[data-ml-tooltip]');
   if(!anchor||!root.contains(anchor)||anchor.disabled){hideTip();return;}
   convertTitle(anchor);if(tipOwner===anchor)return;hideTip();tipOwner=anchor;
   tipTimer=setTimeout(()=>{
    if(!anchor.isConnected||!anchor.dataset.mlTooltip)return;
    tip=document.createElement('div');tip.id='ml-tooltip';tip.className='ml-tooltip';tip.setAttribute('role','tooltip');tip.textContent=anchor.dataset.mlTooltip;
    (anchor.closest('dialog')||root).append(tip);
    const rect=anchor.getBoundingClientRect(),bounds=tip.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(rect.left+(rect.width-bounds.width)/2,innerWidth-bounds.width-8))+'px';
    tip.style.top=(rect.bottom+8+bounds.height<=innerHeight-8?rect.bottom+8:Math.max(8,rect.top-bounds.height-8))+'px';
    anchor.setAttribute('aria-describedby',((anchor.getAttribute('aria-describedby')||'')+' '+tip.id).trim());
   },450);
  }
  convertTitle(root);
  new MutationObserver(entries=>{for(const entry of entries){if(entry.type==='attributes')convertTitle(entry.target);else entry.addedNodes.forEach(convertTitle);}}).observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});
  root.addEventListener('pointerover',e=>requestTip(e.target));
  root.addEventListener('pointerout',e=>{if(tipOwner&&!tipOwner.contains(e.relatedTarget))hideTip();});
  root.addEventListener('focusin',e=>requestTip(e.target));root.addEventListener('focusout',hideTip);
  document.addEventListener('pointerdown',hideTip,true);document.addEventListener('scroll',hideTip,true);document.addEventListener('close',hideTip,true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();});window.addEventListener('resize',hideTip);
  function close(focus=false){if(popup)popup.remove();popup=null;if(owner){owner.setAttribute('aria-expanded','false');if(focus)owner.focus({preventScroll:true});}owner=null;ownerRect=null;}
  function focusOption(item){
   if(!item||!popup)return;item.focus({preventScroll:true});
   const itemRect=item.getBoundingClientRect(),menuRect=popup.getBoundingClientRect();
   if(itemRect.top<menuRect.top+5)popup.scrollTop-=menuRect.top+5-itemRect.top;
   else if(itemRect.bottom>menuRect.bottom-5)popup.scrollTop+=itemRect.bottom-menuRect.bottom+5;
  }
  function menu(select,button){
   if(owner===button){close(true);return;}close();owner=button;button.setAttribute('aria-expanded','true');
   popup=document.createElement('div');popup.className='ml-select-menu'+(select.id==='ml-layer-blend'?' ml-blend-menu':'');popup.setAttribute('role','listbox');popup.setAttribute('aria-label',select.getAttribute('aria-label')||'选择选项');
   const host=button.closest('dialog')||root;host.append(popup);const entries=[];
   for(const node of select.children){
    if(node.tagName==='OPTGROUP'){const heading=document.createElement('div');heading.className='ml-menu-group';heading.textContent=node.label;popup.append(heading);}
    const options=node.tagName==='OPTGROUP'?[...node.children]:[node];
    for(const option of options){
     const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.disabled=option.disabled||node.disabled;item.textContent=option.label;popup.append(item);entries.push(item);
     item.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));close(true);refresh();});
    }
   }
   const rect=button.getBoundingClientRect();popup.style.width=Math.max(select.id==='ml-layer-blend'?230:160,rect.width)+'px';popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-popup.offsetWidth-8))+'px';
   const availableBelow=innerHeight-rect.bottom-10,above=rect.top-10,limit=select.id==='ml-layer-blend'?560:340;
   popup.style.maxHeight=Math.max(80,Math.min(limit,Math.max(above,availableBelow)))+'px';
   popup.style.top=(availableBelow>=Math.min(popup.scrollHeight,limit)?rect.bottom+5:Math.max(8,rect.top-popup.offsetHeight-5))+'px';
   ownerRect=button.getBoundingClientRect();
   focusOption(entries.find(e=>e.getAttribute('aria-selected')==='true'&&!e.disabled)||entries.find(e=>!e.disabled));
   popup.addEventListener('keydown',e=>{const enabled=entries.filter(x=>!x.disabled),index=enabled.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?enabled.length-1:(index+(e.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;focusOption(enabled[i]);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key==='Tab')close();});
  }
  function enhance(){
   root.querySelectorAll('select').forEach(select=>{
    if(selects.has(select))return;const button=document.createElement('button');button.type='button';button.className='ml-select-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-label',select.getAttribute('aria-label')||select.closest('label')?.querySelector('span')?.textContent||'选择选项');
    select.classList.add('ml-native-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.after(button);selects.set(select,button);
    button.addEventListener('click',e=>{e.preventDefault();menu(select,button);});button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();menu(select,button);}});select.addEventListener('change',refresh);
   });
   root.querySelectorAll('input[type="range"]').forEach(range=>{
    if(numbers.has(range))return;const output=root.querySelector('#'+range.id+'-value');if(!output)return;
    const input=document.createElement('input');input.type='number';input.className='ml-number';input.min=range.min;input.max=range.max;input.step=range.step||'1';input.setAttribute('aria-label',(range.closest('label')?.querySelector('.ml-label')?.childNodes[0]?.textContent||'参数')+'数值');output.classList.add('ml-value-source');output.after(input);numbers.set(range,input);
    const commit=()=>{if(input.value!==''&&Number.isFinite(input.valueAsNumber)){range.value=String(Math.min(+range.max,Math.max(+range.min,input.valueAsNumber)));range.dispatchEvent(new Event('input',{bubbles:true}));}input.value=range.value;refresh();};
    input.addEventListener('change',commit);input.addEventListener('keydown',e=>{if(e.key==='Enter'){commit();input.blur();}if(e.key==='Escape'){input.value=range.value;input.blur();}});
   });
   refresh();
  }
  function refresh(){
   for(const [select,button]of selects){const label=select.selectedOptions[0]?.label||'请选择';if(button.textContent!==label)button.textContent=label;button.disabled=select.disabled;button.hidden=select.hidden;}
   for(const [range,input]of numbers){if(document.activeElement!==input)input.value=range.value;input.disabled=range.disabled;const value=100*(+range.value-+range.min)/(+range.max-+range.min);range.style.setProperty('--ml-range-progress',value+'%');}
  }
  root.addEventListener('input',()=>requestAnimationFrame(refresh));
  document.addEventListener('pointerdown',e=>{if(popup&&!popup.contains(e.target)&&e.target!==owner)close();});
  document.addEventListener('scroll',e=>{if(popup&&!popup.contains(e.target)&&ownerRect){const rect=owner.getBoundingClientRect();if(Math.abs(rect.top-ownerRect.top)>1||Math.abs(rect.left-ownerRect.left)>1)close();}},true);window.addEventListener('resize',()=>close());
  function numberEditing(input){
   for(const [range,number]of numbers)if(number===input)return input.validity.badInput||input.value!==range.value;
   return true;
  }
  function syncNumbers(){for(const [range,input]of numbers)input.value=range.value;}
  enhance();return {enhance,refresh,close,numberEditing,syncNumbers};
 }
 global.MaterialControls={create};
})(globalThis);
