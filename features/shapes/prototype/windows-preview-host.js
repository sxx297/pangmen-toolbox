/* Browser-only host fixture for design review. It never reads or writes PowerPoint. */
(function(global){
  const query=new URLSearchParams(location.search),listeners=new Map();
  let mode=query.get('mode')==='floating'?'floating':'docked',id=1,revision=0;
  let settings=MaterialLab.createOptions('glass'),geometry='roundedRect';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const emit=(name,value)=>{for(const fn of listeners.get(name)||[])fn(value);};
  const identity=()=>`preview:slide:shape-${id}`;
  const status=()=>({connected:true,version:'0.9.16 · 界面预览',platform:'Windows preview',panelMode:mode,pinned:true,canSwitchPanel:true,previewWorker:true,quickSelection:true});
  let backgroundsReady;
  function demoBackgrounds(){
    if(!backgroundsReady)backgroundsReady=(async()=>{
      const gradient=document.createElement('canvas');gradient.width=900;gradient.height=720;
      const dark=gradient.getContext('2d');dark.fillStyle='#000';dark.fillRect(0,0,900,720);
      const glass=document.createElement('canvas');glass.width=900;glass.height=720;
      const artwork=new Image();artwork.src=global.MaterialLibraryArtwork;
      await artwork.decode();
      const scale=Math.max(900/artwork.width,720/artwork.height);
      glass.getContext('2d').drawImage(artwork,(900-artwork.width*scale)/2,(720-artwork.height*scale)/2,artwork.width*scale,artwork.height*scale);
      return {gradient:gradient.toDataURL(),glass:glass.toDataURL()};
    })().catch(error=>{backgroundsReady=null;throw error;});
    return backgroundsReady;
  }
  async function capture(){
    const mask=document.createElement('canvas');mask.width=600;mask.height=460;const c=mask.getContext('2d');c.fillStyle='#fff';c.beginPath();
    if(geometry==='ellipse'||geometry==='circle')c.ellipse(300,230,300,230,0,0,Math.PI*2);else if(geometry==='rectangle')c.rect(0,0,600,460);else c.roundRect(0,0,600,460,50);c.fill();
    const previewBackgrounds=await demoBackgrounds();
    return {supported:true,identity:identity(),token:'preview-'+id,materialState:String(revision),settings:copy(settings),canRestore:true,
      shape:{id,name:'示例形状 '+id,width:320,height:geometry==='circle'?320:256,left:100,top:100,rotation:0},
      maskPng:mask.toDataURL(),backgroundPng:previewBackgrounds.glass,backgroundSource:'preview',previewBackgrounds,
      render:{width:900,height:720,card:{x:126,y:111.6,w:648,h:496.8}}};
  }
  global.MaterialHost={available:true,on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},async request(type,payload={}){
    if(type==='hostStatus')return status();
    if(type==='selectionInfo')return {identity:identity(),supported:true,shape:{id,name:'示例形状 '+id,width:320,height:geometry==='circle'?320:256}};
    if(type==='captureSelection')return capture();
    if(type==='applyMaterial'){settings=copy(payload.settings);revision++;return {token:'preview-'+id,materialState:String(revision)};}
    if(type==='restoreMaterial'){settings=MaterialLab.createOptions('glass');revision++;return {};}
    if(type==='setPanelMode'){mode=payload.mode;emit('host.ready',status());return status();}
    return {};
  }};
  global.addEventListener('message',e=>{
    if(e.source!==parent||e.data?.type!=='pangmen-preview')return;
    const action=e.data.action;
    if(action==='mode'){mode=e.data.value;emit('host.ready',status());}
    if(action==='theme')document.documentElement.style.colorScheme=e.data.value;
    if(action==='shape'){geometry=e.data.value;revision++;emit('selection.changed',{supported:true,identity:identity()});}
  });
  document.documentElement.style.colorScheme=query.get('theme')==='dark'?'dark':'light';
})(globalThis);
