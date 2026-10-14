const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:480,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  let receive;const state=globalThis.mock={fail:false,calls:[],serial:0,hints:[],identity:'doc:1:3'};
  const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t,...args){state.hints.push(t);return fill.call(this,t,...args)};
  const image=()=>{const c=document.createElement('canvas');c.width=c.height=100;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,100,100);return c.toDataURL()};
  state.emit=data=>receive({data:{type:'selection.changed',data}});
  globalThis.chrome={webview:{addEventListener:(type,handler)=>receive=handler,postMessage:r=>{
   state.calls.push(r);setTimeout(()=>{
    let data={connected:true,panelMode:'docked',previewWorker:false},ok=true;
    if(r.type==='hostStatus'&&location.search.includes('readerror'))data.selection={supported:false,readError:true,reason:'暂时无法读取轮廓'};
    if(r.type==='captureSelection'){
     if(state.fail){ok=false;data={code:'GEOMETRY_UNAVAILABLE',message:'已选中形状，但暂时无法读取其轮廓。请点击刷新背景。'}}
     else data={token:'capture-'+ ++state.serial,identity:state.identity,materialState:'original',shape:{id:3,name:'导入路径',left:10,top:10,width:100,height:100},render:{width:900,height:720,card:{x:126,y:111.6,w:648,h:496.8}},maskPng:image(),backgroundPng:image()};
    }
    receive({data:{id:r.id,type:'response',ok,...(ok?{data}:{error:data})}});
   },10);
  }}};
 });
 await page.goto(pathToFileURL(path.join(root,'build/protected-web/shapes/index.html')).href+'?host=powerpoint');
 const apply=page.locator('#ml-host-apply'),refresh=page.locator('#ml-host-capture'),opacity=page.locator('#ml-opacity');
 async function idle(){await page.waitForFunction(()=>document.querySelector('#ppt-material-lab').dataset.hostBusy==='false')}
 try{await page.waitForFunction(()=>!!document.querySelector('#ppt-material-lab').dataset.hostTarget,{},{timeout:8000})}catch(e){console.error(await page.evaluate(()=>({calls:mock.calls,status:document.querySelector('#ml-host-status')?.textContent,toast:document.querySelector('#ml-status')?.textContent})));console.error(errors);throw e}
 await opacity.fill('37');await opacity.dispatchEvent('input');await opacity.dispatchEvent('change');
 await page.evaluate(()=>mock.fail=true);await refresh.click();await idle();
 assert(await apply.isDisabled());assert.equal(await opacity.inputValue(),'37');
 assert.match(await page.locator('#ml-preview-loading').textContent(),/形状读取失败/);
 checks.push('capture failure invalidates token, distinguishes read error from no selection and retains parameter');
 await page.evaluate(()=>{mock.fail=false});await refresh.click();await idle();
 assert(await apply.isEnabled());assert.equal(await opacity.inputValue(),'37');checks.push('manual refresh restores same target without replacing draft');
 await page.evaluate(()=>mock.emit({identity:mock.identity,supported:false,readError:true,reason:'暂时无法读取轮廓'}));
 await page.waitForFunction(()=>!document.querySelector('#ppt-material-lab').dataset.hostTarget);await idle();assert(await apply.isDisabled());
 await page.evaluate(()=>mock.emit({identity:mock.identity,supported:true,materialChanged:false}));
 await page.waitForFunction(()=>!!document.querySelector('#ppt-material-lab').dataset.hostTarget);await idle();
 assert.equal(await opacity.inputValue(),'37');
 assert.equal(await page.evaluate(()=>mock.calls.filter(r=>r.type==='applyMaterial').length),0);
 checks.push('selection-watch failure and recovery retain draft and never auto-apply');
 await page.goto(pathToFileURL(path.join(root,'build/protected-web/shapes/index.html')).href+'?host=powerpoint&readerror=1');
 await page.waitForFunction(()=>mock.hints.includes('形状读取失败，请刷新背景'));checks.push('initial geometry failure displays readable canvas hint');
 await page.evaluate(()=>{mock.hints=[];mock.emit({supported:false,signature:'none',reason:'选择一个形状'})});await idle();
 await page.waitForFunction(()=>mock.hints.includes('选择一个形状'));assert(await apply.isDisabled());checks.push('clearing selection restores normal empty state');
 assert.deepEqual(errors,[]);
 const output=path.join(root,'tests/results/freeform-ui-110');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2));console.log('PASS '+checks.length+' freeform UI checks');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
