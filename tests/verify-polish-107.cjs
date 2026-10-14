const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];try{
 const p=await b.newPage({viewport:{width:1000,height:1040}});p.on('pageerror',e=>errors.push(e.message));
 const url=m=>pathToFileURL(path.join(root,'build/protected-web',m,'index.html')).href;
 await p.goto(url('animations')+'?surface=floating&demo=1');await p.waitForFunction(()=>globalThis.MotionPreview);
 await p.evaluate(()=>{MotionPreview.selectEffect('focus',{play:false});MotionPreview.seek(10)});
 await p.locator('[data-effect=jelly]').hover();await p.waitForTimeout(220);assert.equal(await p.evaluate(()=>MotionPreview.getState().playing),false);
 await p.locator('[data-effect=focus]').hover();assert.equal(await p.evaluate(()=>MotionPreview.getState().playing),true);
 await p.locator('[data-effect=jelly]').click();assert.equal(await p.evaluate(()=>MotionPreview.getState().effectId),'jelly');assert.equal(await p.evaluate(()=>MotionPreview.getState().playing),true);checks.push('hover other card never restarts selected stage; selected hover and click do');
 await p.locator('.mode-tabs button').last().click();
 const plate=await p.locator('.mode-tabs').evaluate(e=>({plate:getComputedStyle(e,'::before').display,transition:getComputedStyle(e,'::before').transitionDuration,buttons:[...e.children].map(x=>({bg:getComputedStyle(x).backgroundColor,shadow:getComputedStyle(x).boxShadow,outline:getComputedStyle(x).outlineStyle}))}));
 assert.equal(plate.plate,'block');assert(plate.buttons.every(x=>x.bg==='rgba(0, 0, 0, 0)'&&x.shadow==='none'&&x.outline==='none'));checks.push('single plate, no duplicate background or pointer focus frame');
 const footer=[];await p.evaluate(()=>PangSurface.set('sidebar'));
 for(const w of [280,320,480]){await p.setViewportSize({width:w,height:1000});const v=await p.locator('.apply-controls').evaluate(e=>[...e.querySelectorAll('.brand-select>button,.primary')].map(x=>{const r=x.getBoundingClientRect();return{h:r.height,w:r.width,bottom:innerHeight-r.bottom}}));assert(v.every(x=>x.h===36));assert(v[2].w>v[0].w&&v[2].w>v[1].w);footer.push(v[2]);}
 const delays=await p.evaluate(()=>{const original=setTimeout,list=[];globalThis.setTimeout=(fn,ms)=>{list.push(ms);return original(()=>{},0)};try{const t=PangToast.create(document.querySelector('#toast'));t.show('请先在 PPT 中选择元素。');t.show('请先选择形状',true);t.show('长'.repeat(200),true);t.clear();return list}finally{globalThis.setTimeout=original}});assert.deepEqual(delays,[1800,2800,5000]);checks.push('shared feedback: short 1.8s, errors 2.8–5s');
 const s=await b.newPage({viewport:{width:320,height:1000}});s.on('pageerror',e=>errors.push(e.message));
 await s.addInitScript(()=>{let receive;globalThis.hostCalls=[];globalThis.hints=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t,...args){if(t==='选择一个形状')hints.push({font:this.font,width:this.canvas.width,css:this.canvas.getBoundingClientRect().width});return fill.call(this,t,...args)};
 globalThis.chrome={webview:{addEventListener:(n,cb)=>receive=cb,postMessage:r=>{hostCalls.push(r.type);setTimeout(()=>receive({data:{type:'response',id:r.id,ok:true,data:{connected:true,panelMode:'docked',canSwitchPanel:true,selection:{supported:false,reason:'请选择形状'}}}}),0)}}};});
 await s.goto(url('shapes')+'?host=powerpoint');await s.waitForFunction(()=>globalThis.PangPanelReady);await s.evaluate(()=>PangPanelReady);
 assert.equal(await s.locator('#ml-status').textContent(),'');assert.equal(await s.evaluate(()=>hostCalls.includes('captureSelection')),false);
 await s.waitForFunction(()=>hints.length>0);const hint=await s.evaluate(()=>hints.at(-1));assert(Math.abs(parseFloat(hint.font)*hint.css/hint.width-12)<.1);checks.push('startup with no shape: no capture error toast; docked hint 12 CSS pixels');
 const shapePlate=await s.locator('.ml-modes').evaluate(e=>({display:getComputedStyle(e,'::before').display,transition:getComputedStyle(e,'::before').transitionDuration}));assert.equal(shapePlate.display,'block');assert.equal(shapePlate.transition,plate.transition);
 for(const [i,w] of [280,320,480].entries()){await s.setViewportSize({width:w,height:1000});const v=await s.locator('#ml-host-apply').evaluate(x=>{const r=x.getBoundingClientRect();return{h:r.height,bottom:innerHeight-r.bottom}});assert.equal(v.h,36);assert(Math.abs(v.bottom-footer[i].bottom)<1,JSON.stringify({w,v,animation:footer[i]}));}checks.push('both docked footers: 36px buttons and matching bottom inset; animation primary wider');
 await s.locator('.ml-modes button').last().click();await s.waitForTimeout(200);assert.equal(await s.locator('.ml-modes').getAttribute('data-selected'),'glass');checks.push('shape and animation switch share 170ms moving plate');
 assert.deepEqual(errors,[]);const out=path.join(root,'tests/results/polish-107');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log('PASS '+checks.length+' shared polish checks');
 }finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
