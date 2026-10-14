/* Shared desktop/browser export UI. Selection follows desktop list conventions. */
(()=>{'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const hosted=!!globalThis.chrome?.webview, pending=new Map(), thumbs=new Map();
let serial=0, doc, selected=new Set(), active=1, anchor=null, busy=false, stop=false;
let thumbTask=Promise.resolve(), cardObserver;
const presets={small:{dpi:150,quality:85},balanced:{dpi:240,quality:92},best:{dpi:300,quality:96}};
function status(text,error=false){$('#status').textContent=text;$('#status').dataset.error=String(error);}
function progress(data){$('#progress').hidden=false;$('#progress').value=data.done/Math.max(1,data.total)*100;status(data.stage+' · '+data.done+' / '+data.total);}
if(hosted)chrome.webview.addEventListener('message',e=>{
 const m=e.data;if(m.type==='progress'){progress(m);return;}
 const r=pending.get(m.id);if(r){pending.delete(m.id);m.ok?r.resolve(m.data):r.reject(new Error(m.error));}
});
function request(type,payload={}){
 return hosted?new Promise((resolve,reject)=>{const id='pdf-'+(++serial);pending.set(id,{resolve,reject});chrome.webview.postMessage({id,type,payload});}):demoRequest(type,payload);
}
function settings(){
 const mode=$('#export-quality').value, custom=mode==='custom';
 const {dpi,quality}=custom?{dpi:Number($('#dpi').value),quality:92}:presets[mode];
 if(!Number.isInteger(dpi)||dpi<72||dpi>600)throw new Error('分辨率需为 72–600 DPI。');
 if(!Number.isFinite(doc.width)||!Number.isFinite(doc.height)||doc.width<=0||doc.height<=0)throw new Error('无法读取页面尺寸，请重新打开导出窗口。');
 let w=Math.max(1,Math.round(doc.width*dpi/72)),h=Math.max(1,Math.round(doc.height*dpi/72)),adapted=false;
 if(w*h>24000000||w>12000||h>12000){
  if(custom)throw new Error('当前 DPI 超过单页 2400 万像素或单边 12000 像素限制，请降低 DPI 或选择均衡档位。');
  const scale=Math.min(1,12000/w,12000/h,Math.sqrt(24000000/(w*h)));
  w=Math.max(1,Math.floor(w*scale));h=Math.max(1,Math.floor(h*scale));adapted=true;
 }
 return{dpi,quality,compression:custom&&$('#lossless').checked?'lossless':'auto',w,h,adapted,fitToLimits:!custom,pages:[...selected].sort((a,b)=>a-b)};
}
function sync(){
 if(!doc)return;
 $('#selection-summary').textContent='已选 '+selected.size+' / '+doc.pages.length+' 页';
 for(const card of $$('.slide-card')){
  const i=Number(card.dataset.index);card.setAttribute('aria-selected',String(selected.has(i)));card.tabIndex=i===active?0:-1;
 }
 let valid=true;
 const notice=$('#settings-notice');notice.textContent='';notice.dataset.error='false';
 try{const s=settings();$('#pixel-size').textContent=s.w+' × '+s.h+' 像素 / 页';if(s.adapted)notice.textContent='已适配大尺寸页面：'+s.w+' × '+s.h+' 像素 / 页';}
 catch(e){valid=false;$('#pixel-size').textContent=e.message;notice.textContent=e.message;notice.dataset.error='true';}
 $('#export').disabled=busy||!selected.size||!valid;
 $('#custom-settings').hidden=$('#export-quality').value!=='custom';
}
function setSelection(values){selected=new Set(values);anchor=null;sync();status('');}
function selectIndex(index,event={}){
 if(busy)return;
 const multi=event.ctrlKey||event.metaKey;
 if(event.shiftKey){
  const from=anchor??active;
  if(!multi)selected.clear();
  for(let i=Math.min(from,index);i<=Math.max(from,index);i++)selected.add(i);
  anchor=from;
 }else if(multi){
  selected.has(index)?selected.delete(index):selected.add(index);anchor=index;
 }else{selected=new Set([index]);anchor=index;}
 active=index;sync();status('');
}
function buildCards(){
 const grid=$('#page-grid');cardObserver?.disconnect();grid.replaceChildren();
 cardObserver=new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;cardObserver.unobserve(entry.target);
   const index=Number(entry.target.dataset.index);
   thumbTask=thumbTask.then(async()=>{
    if(busy)return;
    try{const r=await request('thumbnail',{index});thumbs.set(index,r.url);entry.target.querySelector('img').src=r.url;}
    catch(e){status('第 '+index+' 页缩略图加载失败：'+e.message,true);}
   });
  }
 },{root:grid,rootMargin:'100px'});
 for(const p of doc.pages){
  const card=document.createElement('button');card.type='button';card.className='slide-card';card.dataset.index=p.index;
  card.setAttribute('role','option');card.setAttribute('aria-label','第 '+p.index+' 页：'+p.title+(p.hidden?'（隐藏页）':''));
  const picture=document.createElement('span');picture.className='slide-picture';picture.style.aspectRatio=doc.width+'/'+doc.height;
  const img=document.createElement('img');img.alt='';img.draggable=false;picture.append(img);
  const meta=document.createElement('span');meta.className='slide-meta';
  const number=document.createElement('span');number.className='page-number';number.textContent=String(p.index).padStart(2,'0');
  if(p.hidden){const hidden=document.createElement('span');hidden.className='slide-hidden';hidden.textContent='隐藏';number.append(hidden);}
  const mark=document.createElement('span');mark.className='slide-mark';mark.setAttribute('aria-hidden','true');
  const tick=document.createElementNS('http://www.w3.org/2000/svg','svg');tick.setAttribute('viewBox','0 0 16 16');tick.setAttribute('focusable','false');
  const stroke=document.createElementNS('http://www.w3.org/2000/svg','path');stroke.setAttribute('d','M3.5 8.5 6.5 11.5 12.5 5');tick.append(stroke);mark.append(tick);
  meta.append(number,mark);card.append(picture,meta);grid.append(card);
  card.onclick=e=>{selectIndex(p.index,e);card.focus({preventScroll:true});};
  card.onmousedown=e=>{if(e.shiftKey)e.preventDefault();};
  if(thumbs.has(p.index))img.src=thumbs.get(p.index);else cardObserver.observe(card);
 }
}
$('#page-grid').onkeydown=e=>{
 if(busy)return;
 const multi=e.ctrlKey||e.metaKey;
 if(multi&&e.key.toLowerCase()==='a'){e.preventDefault();setSelection(doc.pages.map(p=>p.index));return;}
 const current=e.target.closest('.slide-card');if(!current)return;
 const index=Number(current.dataset.index), cards=$$('.slide-card');
 if(e.key===' '||e.key==='Enter'){
  e.preventDefault();selectIndex(index,e.key===' '&&!e.shiftKey?{ctrlKey:true}:e);return;
 }
 const columns=cards.filter(c=>c.offsetTop===cards[0].offsetTop).length||1;
 const moves={ArrowRight:index+1,ArrowLeft:index-1,ArrowDown:index+columns,ArrowUp:index-columns,Home:1,End:doc.pages.length};
 if(!(e.key in moves))return;
 e.preventDefault();const next=Math.max(1,Math.min(doc.pages.length,moves[e.key]));
 if(multi&&!e.shiftKey){active=next;sync();}else selectIndex(next,e);
 cards[next-1].focus();
};
function setBusy(value){
 if(value)closeQuality();
 busy=value;if(!value)buildCards();
 for(const e of $$('.workspace button,#custom-settings input,#export-quality'))e.disabled=value;
 $('#cancel').hidden=!value;$('#cancel').disabled=false;$('#progress').hidden=!value;
 $('#export').textContent=value?'正在导出…':'导出 PDF';sync();
}
$('#select-all').onclick=()=>setSelection(doc.pages.map(x=>x.index));
$('#select-none').onclick=()=>setSelection([]);
$('#invert').onclick=()=>setSelection(doc.pages.filter(x=>!selected.has(x.index)).map(x=>x.index));
const qualityTrigger=$('#export-quality'), qualityMenu=$('#quality-menu'), qualityOptions=$$('[data-quality]');
function closeQuality(restoreFocus=false){
 qualityMenu.hidden=true;qualityTrigger.setAttribute('aria-expanded','false');
 if(restoreFocus)qualityTrigger.focus();
}
function openQuality(){
 if(busy)return;
 qualityMenu.hidden=false;qualityTrigger.setAttribute('aria-expanded','true');
 qualityOptions.find(option=>option.dataset.quality===qualityTrigger.value).focus();
}
qualityTrigger.onclick=()=>qualityMenu.hidden?openQuality():closeQuality();
qualityTrigger.onkeydown=e=>{
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();openQuality();}
 if(e.key==='Escape'){e.preventDefault();closeQuality();}
};
for(const option of qualityOptions){option.tabIndex=-1;option.onclick=()=>{
 if(busy)return;
 qualityTrigger.value=option.dataset.quality;$('#quality-value').textContent=option.textContent;
 for(const item of qualityOptions)item.setAttribute('aria-selected',String(item===option));
 closeQuality(true);sync();status('');
};}
qualityMenu.onkeydown=e=>{
 if(e.key==='Tab'){closeQuality(true);return;}
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeQuality(true);return;}
 const current=qualityOptions.indexOf(document.activeElement);
 const next={ArrowDown:(current+1)%qualityOptions.length,ArrowUp:(current+qualityOptions.length-1)%qualityOptions.length,Home:0,End:qualityOptions.length-1}[e.key];
 if(next!==undefined){e.preventDefault();qualityOptions[next].focus();}
};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.quality-picker'))closeQuality();});
document.addEventListener('focusin',e=>{if(!e.target.closest('.quality-picker'))closeQuality();});
$('#dpi').oninput=()=>{sync();status('');};$('#lossless').onchange=()=>{sync();status('');};
$('#cancel').onclick=()=>{stop=true;$('#cancel').disabled=true;status('正在取消…');request('cancel').catch(e=>status(e.message,true));};
$('#export').onclick=async()=>{
 if(busy)return;
 try{
  const config=settings();if(!config.pages.length)throw new Error('请至少选择一页。');
  stop=false;setBusy(true);status(hosted?'请选择保存位置…':'正在准备导出…');
  await thumbTask;const r=stop?{cancelled:true}:await request('export',config);
  status(r.cancelled?'已取消导出。':hosted?'已导出 '+r.count+' 页 · '+(r.bytes/1048576).toFixed(2)+' MB · '+r.path:'示例 PDF 已下载 · '+r.count+' 页 · '+(r.bytes/1048576).toFixed(2)+' MB');
 }catch(e){status(e.message,true);}finally{setBusy(false);}
};
async function initialize(){
 try{
  doc=await request('document');selected=new Set(doc.pages.map(x=>x.index));active=doc.current;
  $('#document-name').textContent=doc.name;$('#preview-badge').hidden=hosted;
  buildCards();sync();document.body.dataset.ready='true';
 }catch(e){status(e.message,true);}
}

// Clearly labelled browser fixture with actual downloadable PDF output.
const demoTitles=['让好设计，更进一步','从想法到落地','年度成果，一目了然','把复杂留给工具','少一点操作，多一点创造','让细节经得起放大','为每一次表达加分','以清晰，传递价值','一份文稿，多种可能','每一步，都有回应','下一站，更多可能','感谢每一次认真'];
function demoCanvas(index,width){const c=document.createElement('canvas');c.width=width;c.height=Math.round(width*9/16);const x=c.getContext('2d'),w=c.width,h=c.height;x.scale(w/960,h/540);const dark=index%3===1;x.fillStyle=dark?'#25221f':'#f5f0e9';x.fillRect(0,0,960,540);x.fillStyle=dark?'#aaa096':'#9b8a7a';x.font='16px Microsoft YaHei';x.fillText('PANGMEN    /    DESIGN NOTES',55,55);x.fillText(String(index).padStart(2,'0')+' / 12',835,55);x.fillStyle=dark?'#fff6ee':'#382d24';x.font='bold 45px Microsoft YaHei';x.fillText(demoTitles[index-1],55,158);x.font='18px Microsoft YaHei';x.fillStyle=dark?'#aaa096':'#928171';x.fillText('让每一页的表达，都有自己的分量。',58,198);if(index%3===0){for(let i=0;i<3;i++){x.fillStyle=i===0?'#ff5500':'#e8dfd3';x.fillRect(55+i*285,257,263,185);x.fillStyle=i===0?'white':'#594332';x.font='bold 57px Segoe UI';x.fillText(['120+','98%','03'][i],77+i*285,336);x.font='17px Microsoft YaHei';x.fillText(['创意项目','交付满意度','核心方向'][i],80+i*285,395);}}else{const g=x.createLinearGradient(400,200,920,500);g.addColorStop(0,dark?'#f77c33':'#d6c0a8');g.addColorStop(.5,'#ef6a20');g.addColorStop(1,dark?'#502b20':'#f4b175');x.fillStyle=g;for(let i=0;i<5;i++){x.beginPath();x.ellipse(705+i*27,350-i*15,185-i*15,115-i*10,-.5,0,Math.PI*2);x.fill();}x.fillStyle=dark?'#b7aaa0':'#7c6b5b';x.font='18px Microsoft YaHei';x.fillText('清晰的内容',58,302);x.fillText('自然的节奏',58,346);x.fillText('恰当的细节',58,390);}x.fillStyle=dark?'#72685e':'#b5a594';x.fillRect(55,480,850,1);x.font='12px Microsoft YaHei';x.fillText('旁门 · 示例页面 / 用于预览导出效果',55,508);return c;}
async function demoRequest(type,payload){if(type==='document')return{name:'设计提案 · 示例文稿.pptx',width:960,height:540,current:1,pages:demoTitles.map((title,i)=>({index:i+1,title,hidden:i===10}))};if(type==='thumbnail')return{url:demoCanvas(payload.index,480).toDataURL()};if(type==='cancel'){stop=true;return{cancelled:true};}if(type==='export')return demoExport(payload);throw new Error('未知操作');}
async function demoExport(config){const encoder=new TextEncoder(),chunks=[],offsets=[0,0,0],kids=[];let length=0;const put=v=>{const bytes=typeof v==='string'?encoder.encode(v):v;chunks.push(bytes);length+=bytes.length;};const object=(id,body)=>{offsets[id]=length;put(id+' 0 obj\n'+body+'\nendobj\n');};const binary=(id,dict,bytes)=>{offsets[id]=length;put(id+' 0 obj\n<< '+dict+' /Length '+bytes.length+' >>\nstream\n');put(bytes);put('\nendstream\nendobj\n');};put('%PDF-1.4\n');
 for(let i=0;i<config.pages.length;i++){if(stop)return{cancelled:true};progress({done:i,total:config.pages.length,stage:'正在导出第 '+config.pages[i]+' 页'});await new Promise(r=>setTimeout(r,20));const canvas=demoCanvas(config.pages[i],config.w);let bytes,filter;const jpeg=async()=>new Uint8Array(await (await new Promise(r=>canvas.toBlob(r,'image/jpeg',config.quality/100))).arrayBuffer());
 if(config.compression!=='jpeg'&&typeof CompressionStream!=='undefined'){const rgba=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,rgb=new Uint8Array(canvas.width*canvas.height*3);for(let s=0,d=0;s<rgba.length;s+=4){rgb[d++]=rgba[s];rgb[d++]=rgba[s+1];rgb[d++]=rgba[s+2];}bytes=new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());filter='FlateDecode';if(config.compression==='auto'){const j=await jpeg();if(j.length<bytes.length){bytes=j;filter='DCTDecode';}}}else{if(config.compression==='lossless')throw new Error('此浏览器不支持无损压缩，请使用 JPEG 或更新浏览器。');bytes=await jpeg();filter='DCTDecode';}
 const id=3+i*3;kids.push(id);object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+doc.width+' '+doc.height+'] /Resources << /XObject << /Im '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');binary(id+1,'/Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /'+filter,bytes);binary(id+2,'',encoder.encode('q '+doc.width+' 0 0 '+doc.height+' 0 0 cm /Im Do Q'));canvas.width=1;canvas.height=1;
 }if(stop)return{cancelled:true};object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Count '+kids.length+' /Kids ['+kids.map(id=>id+' 0 R').join(' ')+'] >>');const xref=length;put('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');for(let i=1;i<offsets.length;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');put('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');const blob=new Blob(chunks,{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='旁门-PDF导出示例.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return{count:kids.length,bytes:blob.size};}
initialize();
})();
