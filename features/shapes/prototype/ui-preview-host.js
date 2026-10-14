// UI review fixture only. Never loaded by the installed PowerPoint editor.
(() => {
 const listeners=new Set();let settings=null,applied=false,pinned=true,sceneRefresh=false;
 const config=globalThis.previewConfig;
 const artwork=new Image();artwork.src='assets/glass-silk-amber-v1.png';
 const artworkReady=artwork.decode().then(()=>true,()=>false);
 function png(mask,background){
  const c=document.createElement('canvas');c.width=900;c.height=720;const ctx=c.getContext('2d');
  if(mask){
   ctx.fillStyle='#fff';ctx.beginPath();
   if(config.shape==='circle')ctx.arc(450,360,350,0,Math.PI*2);
   else if(config.shape==='star'){
    for(let i=0;i<10;i++){const angle=i*Math.PI/5-Math.PI/2,r=i%2?155:350;const x=450+Math.cos(angle)*r,y=360+Math.sin(angle)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();
   }else ctx.roundRect(5,5,890,710,95);
   ctx.fill();
  }else{
   ctx.fillStyle=background==='black'?'#000000':background==='white'?'#ffffff':background==='light'?'#f0f3f9':'#10172c';ctx.fillRect(0,0,900,720);
   if(background==='silk'||background==='grid')ctx.drawImage(MaterialBackgrounds.create(background),0,0,900,720);
   if(background==='artwork'){
    if(artwork.complete&&artwork.naturalWidth){
     const scale=Math.max(900/artwork.naturalWidth,720/artwork.naturalHeight);
     const width=artwork.naturalWidth*scale,height=artwork.naturalHeight*scale;
     ctx.drawImage(artwork,(900-width)/2,(720-height)/2,width,height);
    }else ctx.drawImage(MaterialBackgrounds.create('silk'),0,0,900,720);
   }
   if(background==='light'){
    const g=ctx.createLinearGradient(160,120,680,620);g.addColorStop(0,'#78b7f4');g.addColorStop(.55,'#566bdd');g.addColorStop(1,'#a7b6f2');
    ctx.fillStyle=g;ctx.save();ctx.translate(360,350);ctx.rotate(-.45);ctx.fillRect(-100,-520,200,1040);ctx.restore();
    ctx.fillStyle='#f2af8a';ctx.beginPath();ctx.arc(720,200,150,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#455570';ctx.lineWidth=3;
    for(const y of [170,535]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(900,y);ctx.stroke();}
   }
   if(background==='dark'){const g=ctx.createLinearGradient(100,0,800,720);g.addColorStop(0,'#3078be');g.addColorStop(.5,'#313365');g.addColorStop(1,'#8254b2');ctx.fillStyle=g;ctx.fillRect(240,0,140,720);ctx.fillRect(650,0,100,720);}
  }return c.toDataURL();
 }
 const names={rounded:'圆角矩形',circle:'圆形',star:'星形'};
 globalThis.updatePreviewScene=next=>{
  Object.assign(config,next);sceneRefresh=true;
  listeners.forEach(f=>f({data:{type:'selection.changed',data:{signature:config.shape+':'+JSON.stringify(config.backgrounds),supported:true}}}));
 };
 globalThis.chrome=globalThis.chrome||{};
 chrome.webview={addEventListener:(_,f)=>listeners.add(f),postMessage:message=>{
  setTimeout(async()=>{
   if(message.type==='captureSelection'&&Object.values(config.backgrounds).includes('artwork'))await artworkReady;
   let data={};
   if(message.type==='hostStatus')data={connected:true,version:'0.7 UI 预览',pinned,autoSelection:true,reusableCapture:true};
   if(message.type==='captureSelection'){
    data={token:'preview-shape',shape:{id:1,name:names[config.shape],width:320,height:config.shape==='rounded'?256:320},maskPng:png(true),backgroundPng:png(false,'black'),backgroundSource:'preview',previewBackgrounds:{gradient:png(false,config.backgrounds.gradient),glass:png(false,config.backgrounds.glass)},settings:sceneRefresh?null:settings,canRestore:applied};sceneRefresh=false;
   }
   if(message.type==='applyMaterial'){settings=message.payload.settings;applied=true;data={token:'preview-shape',canRestore:true};}
   if(message.type==='restoreMaterial'){settings=null;applied=false;data={canRestore:false};}
   if(message.type==='setPinned'){pinned=message.payload.enabled;data={pinned};}
   listeners.forEach(f=>f({data:{id:message.id,type:'response',ok:true,data}}));
  },30);
 }};
})();
