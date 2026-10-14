// At most one active preview and one latest pending preview. Exports are never dropped.
(function(global){
 function create(){
  if(!global.Worker || !global.OffscreenCanvas || !global.MaterialRenderWorkerSource)return null;
  let worker,active=null,preview=null,exports=[],serial=0,failed=false,timer=null;
  const sentImages={};
  try{const url=URL.createObjectURL(new Blob([global.MaterialRenderWorkerSource],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);}catch{return null;}
  function fail(error){failed=true;clearTimeout(timer);worker.terminate();active?.reject(error);preview?.reject(error);exports.forEach(task=>task.reject(error));active=preview=null;exports=[];}
  function pump(){
   if(active||failed)return;const task=exports.shift()||preview;if(!task)return;if(task===preview)preview=null;active=task;
   try{
    const options={...task.options},images={};
    for(const key of (options.thumbnail?['backgroundCanvas']:['alphaMask','backgroundCanvas'])){
     const canvas=options[key];if(!canvas)throw new Error('后台预览缺少图像');
     if(sentImages[key]!==canvas){images[key]=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);sentImages[key]=canvas;}
     delete options[key];
    }
    timer=setTimeout(()=>fail(new Error('后台渲染超时')),task.exporting?120000:30000);
    worker.postMessage({id:task.id,options,scale:task.scale,images});
   }catch(error){fail(error);}
  }
  worker.onmessage=event=>{const message=event.data;if(!active||message.id!==active.id){message.bitmap?.close();return;}
   clearTimeout(timer);const task=active;active=null;if(message.error){task.reject(new Error(message.error));fail(new Error(message.error));return;}task.resolve(message.bitmap);pump();};
  worker.onerror=event=>{event.preventDefault();fail(new Error(event.message||'后台渲染不可用'));};
  return {render(options,scale,exporting=false){return new Promise((resolve,reject)=>{
   if(failed){reject(new Error('后台渲染不可用'));return;}
   const task={id:++serial,options:{...options,layers:options.layers.map(layer=>({...layer}))},scale,exporting,resolve,reject};
   if(exporting)exports.push(task);else{preview?.resolve(null);preview=task;}pump();
  })},dispose(){fail(new Error('渲染器已关闭'));}};
 }
 global.MaterialAsyncRenderer={create};
})(globalThis);
