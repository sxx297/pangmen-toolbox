const scenes=[
 ['shape-gradient','形状效果 · 侧栏渐变','形状效果',320,960,'/shapes/windows-preview-frame.html?mode=docked','gradient'],
 ['shape-glass','形状效果 · 侧栏玻璃','形状效果',320,960,'/shapes/windows-preview-frame.html?mode=docked','glass'],
 ['shape-floating','形状效果 · 悬浮窗','形状效果',1000,1000,'/shapes/windows-preview-frame.html?mode=floating','gradient'],
 ['presets-gradient','预设库 · 弥散渐变','形状效果',320,960,'/shapes/windows-preview-frame.html?mode=docked','presets-gradient'],
 ['presets-glass','预设库 · 液态玻璃','形状效果',320,960,'/shapes/windows-preview-frame.html?mode=docked','presets-glass'],
 ['save-preset','预设 · 保存弹窗','形状效果',320,960,'/shapes/windows-preview-frame.html?mode=docked','save-preset'],
 ['animation-element','动画库 · 元素侧栏','动画库',320,960,'/animations/index.html?surface=sidebar&demo=1','element'],
 ['animation-text','动画库 · 文本侧栏','动画库',320,960,'/animations/index.html?surface=sidebar&demo=1','text'],
 ['animation-floating','动画库 · 悬浮窗','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','exit'],
 ['animation-notice','动画库 · 操作提示','动画库',320,960,'/animations/index.html?surface=sidebar&demo=1','notice'],
 ['animation-pivot','动画库 · 旋转支点','动画库',320,960,'/animations/index.html?surface=sidebar&demo=1','pivot'],
 ['animation-axis','动画库 · 翻转轴向','动画库',320,960,'/animations/index.html?surface=sidebar&demo=1','axis'],
 ['animation-angle','动画库 · 自由角度','动画库',320,960,'/animations/index.html?surface=sidebar&demo=1','angle'],
 ['new-alternate-in','新增动画 · 交错入场','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','new:alternate-in'],
 ['new-text-tracking','新增动画 · 字距收拢','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','new:text-tracking'],
 ['new-text-flip','新增动画 · 字符翻入','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','new:text-flip'],
 ['new-text-highlight','新增动画 · 荧光标记','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','new:text-highlight'],
 ['new-orbit','新增动画 · 轨道浮游','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','new:orbit'],
 ['new-text-scatter','新增动画 · 向外飞散','动画库',1000,1000,'/animations/index.html?surface=floating&demo=1','new:text-scatter'],
 ['pdf','PDF · 选页导出','导出 PDF',1200,820,'/export/pdf-export.html?preview=1','pdf'],
 ['pdf-settings','PDF · 自定义质量','导出 PDF',1200,820,'/export/pdf-export.html?preview=1','pdf-settings'],
 ['about','关于旁门工具箱','关于旁门工具箱',640,350,'/about.html','about']
];
globalThis.reviewScenes=scenes;
async function prepare(doc,kind){
 const win=doc.defaultView;const wait=async f=>{for(let i=0;i<80;i++){if(f())return;await new Promise(r=>setTimeout(r,100))}throw Error('预览加载超时')};
 if(['gradient','glass','presets-gradient','presets-glass','save-preset'].includes(kind)){
  await wait(()=>doc.querySelector('#ml-tab-glass')&&win.MaterialLab);await new Promise(r=>setTimeout(r,500));
  doc.querySelector(kind.includes('glass')?'#ml-tab-glass':'#ml-tab-gradient').click();
  if(kind.startsWith('presets')){await new Promise(r=>setTimeout(r,100));doc.querySelector('#ml-open-library').click()}
  if(kind==='save-preset'){await new Promise(r=>setTimeout(r,1800));doc.querySelector('#ml-save-preset').click()}
 }
 if(['element','text','exit','notice','pivot','axis','angle'].includes(kind)){
  await wait(()=>win.PangSurface);if(kind==='text'||kind==='notice')doc.querySelector('#mode-text').click();
  if(kind==='exit'){doc.querySelector('#category-exit').click();win.MotionPreview.selectEffect('roll-out',{play:false})}
  if(kind==='notice'){const e=doc.querySelector('#toast');e.textContent='请选择只包含一个数值的文本框。';e.classList.add('visible')}
  if(['pivot','axis','angle'].includes(kind)){
   win.MotionPreview.selectEffect({pivot:'pivot-in',axis:'flip-in',angle:'float-in'}[kind],{play:false});
   win.MotionPreview.updateParameter('direction',{pivot:'bottom-left',axis:'up',angle:'custom'}[kind]);
   if(kind==='angle'){win.MotionPreview.updateParameter('directionAngle',77);doc.querySelector('#direction-angle-number').focus()}
   doc.querySelector('#direction-field').scrollIntoView({block:'center'});
  }
 }
 if(kind.startsWith('new:')){await wait(()=>win.MotionPreview);win.MotionPreview.selectEffect(kind.slice(4),{play:false});win.MotionPreview.seek(kind==='new:text-highlight'?.7:.35)}
 if(kind==='pdf-settings'){await wait(()=>doc.body.dataset.ready==='true');doc.querySelector('#export-quality').click();doc.querySelector('[data-quality="custom"]')?.click()}
}
globalThis.prepareReview=prepare;
const nav=document.querySelector('#nav'),overview=document.querySelector('#overview'),frame=document.querySelector('#frame');
const all=document.createElement('button');all.textContent='全部界面';all.className='active';all.onclick=()=>{document.querySelectorAll('aside button').forEach(b=>b.classList.remove('active'));all.classList.add('active');overview.hidden=false;document.querySelector('#detail').hidden=true;document.querySelector('#size-label').hidden=true;document.querySelector('#title').textContent='全部界面'};nav.append(all);
for(const scene of scenes){const b=document.createElement('button');b.textContent=scene[1];nav.append(b);const card=document.createElement('button');card.className='card';card.innerHTML=`<img src="/shots/${scene[0]}.png" alt="${scene[1]}"><strong>${scene[1]}</strong><span>打开交互预览 ↗</span>`;overview.append(card);b.onclick=card.onclick=()=>{document.querySelectorAll('aside button').forEach(x=>x.classList.remove('active'));b.classList.add('active');overview.hidden=true;document.querySelector('#detail').hidden=false;document.querySelector('#size-label').hidden=false;document.querySelector('#title').textContent=scene[1];document.querySelector('#panel-title').textContent=scene[2];document.querySelector('#width').value=String(scene[3]);document.querySelector('#shell').style.width=scene[3]+'px';frame.style.height=scene[4]+'px';frame.onload=()=>prepare(frame.contentDocument,scene[6]);frame.src=scene[5]}}
document.querySelector('#width').onchange=e=>document.querySelector('#shell').style.width=e.target.value+'px';
