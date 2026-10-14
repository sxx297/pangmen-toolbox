/* Request/response transport for the local PowerPoint WebView2 host. */
(function(global){
  'use strict';
  const transport=global.chrome?.webview;
  const available=!!transport && typeof transport.postMessage==='function' && typeof transport.addEventListener==='function';
  const pending=new Map(),listeners=new Map();
  let serial=0;
  function hostError(value,fallback){
    const error=new Error(typeof value==='string'?value:value?.message || fallback || 'PowerPoint 操作失败。');
    error.code=value?.code || 'HOST_ERROR';return error;
  }
  if(available)transport.addEventListener('message',event=>{
    let message=event.data;
    if(typeof message==='string'){try{message=JSON.parse(message);}catch{return;}}
    if(!message || typeof message!=='object')return;
    if(message.type==='response' && typeof message.id==='string'){
      const request=pending.get(message.id);if(!request)return;
      pending.delete(message.id);clearTimeout(request.timer);
      if(message.ok===true)request.resolve(message.data || {});
      else request.reject(hostError(message.error));
    } else if(typeof message.type==='string'){
      for(const listener of listeners.get(message.type) || [])listener(message.data || message.payload || {});
    }
  });
  function request(type,payload={},timeout=45000){
    if(!available)return Promise.reject(hostError({code:'HOST_UNAVAILABLE',message:'请从 PowerPoint 中打开形状效果加载项。'}));
    return new Promise((resolve,reject)=>{
      const id='material-'+Date.now().toString(36)+'-'+(++serial);
      const timer=setTimeout(()=>{pending.delete(id);reject(hostError({code:'HOST_TIMEOUT',message:'操作超时，请在 PowerPoint 中检查结果后重新读取形状。'}));},timeout);
      pending.set(id,{resolve,reject,timer});
      try{transport.postMessage({id,type,payload});}
      catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  function on(type,listener){
    if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);
    return ()=>listeners.get(type)?.delete(listener);
  }
  global.MaterialHost=Object.freeze({available,request,on});
})(globalThis);
