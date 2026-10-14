const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];try{
 const page=await browser.newPage({viewport:{width:1000,height:1040}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  let receive;globalThis.chrome={webview:{addEventListener:(event,cb)=>receive=cb,postMessage:req=>{
   if(!req.id)return;
   const value=req.route==='bootstrap'?{ok:true,session:'test'}:req.route==='selection'?{ok:true,count:1,signature:'1:2',numeric:{value:123,decimals:0,grouping:false}}:{ok:true};
   // Simulate Office taking focus while it writes the selected animation.
   if(req.route==='apply')setTimeout(()=>window.dispatchEvent(new Event('blur')),80);
   setTimeout(()=>receive({data:{id:req.id,value}}),req.route==='apply'?500:0);
  }}};
 });
 await page.goto(pathToFileURL(path.join(root,'build/protected-web/animations/index.html')).href+'?embedded=1&surface=floating');
 await page.waitForFunction(()=>globalThis.PangPlugin);await page.evaluate(()=>PangPlugin.poll());
 for(const id of ['zoom-in','text-tracking','number-roll']){
  await page.evaluate(id=>MotionPreview.selectEffect(id,{play:false}),id);
  await page.locator(`[data-effect="${id}"]`).click();
  await page.waitForFunction(()=>!PangPlugin.getState().busy&&MotionPreview.getState().time>.1);
  await page.waitForFunction(()=>document.querySelector('#stage-state').textContent==='播放完成');
  checks.push(id+': card click + hosted apply blur reaches final frame');
 }
 await page.evaluate(()=>{MotionPreview.selectEffect('zoom-in');MotionPreview.seek(.12);window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
 await page.waitForTimeout(250);let state=await page.evaluate(()=>MotionPreview.getState());assert.equal(state.playing,false);assert.equal(state.time,.12);checks.push('manual seek/pause survives focus return');
 await page.evaluate(()=>{MotionPreview.play();window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('blur'));});
 await page.waitForFunction(()=>document.querySelector('#stage-state').textContent==='播放完成');checks.push('repeated blur/focus does not interrupt resumed playback');
 await page.evaluate(()=>{MotionPreview.selectEffect('orbit');window.dispatchEvent(new Event('blur'));});await page.waitForTimeout(200);assert(await page.evaluate(()=>MotionPreview.getState().playing));checks.push('visible loop keeps playing after blur');
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>MotionPreview.getState().playing),false);checks.push('hidden document still pauses');
 await page.evaluate(()=>{delete document.visibilityState;PangSurface.set('sidebar');MotionPreview.play();});assert.equal(await page.evaluate(()=>MotionPreview.getState().playing),false);checks.push('hidden sidebar stage cannot play');
 await page.evaluate(()=>{PangSurface.set('floating');MotionPreview.play();window.dispatchEvent(new Event('pagehide'));});assert.equal(await page.evaluate(()=>MotionPreview.getState().playing),false);checks.push('pagehide still stops playback');
 await page.evaluate(()=>{MotionPreview.play();PangPlugin.preview();});assert.equal(await page.evaluate(()=>MotionPreview.getState().playing),false);checks.push('native slideshow preview still pauses sample');
 assert.deepEqual(errors,[]);const out=path.join(root,'tests/results/preview-focus-108');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log('PASS '+checks.length+' preview focus checks');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
