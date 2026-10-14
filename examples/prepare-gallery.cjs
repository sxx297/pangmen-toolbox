// Prepare the released catalog and render all built-in material thumbnails.
// node examples/prepare-gallery.cjs [source root] [working output] [media output]
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const output=path.resolve(process.argv[3]||path.join(__dirname,'output/gallery'));
const media=path.resolve(process.argv[4]||path.join(root,'docs/media/gallery'));
for(const dir of [output,media])fs.mkdirSync(dir,{recursive:true});
for(const name of ['catalog.js','native-support.js','motion-engine.js','native-plan.js'])vm.runInThisContext(fs.readFileSync(path.join(root,'features/animations/preview',name),'utf8'));
const plans=MotionCatalog.effects.map(e=>({...e,plan:PangNativePlan(e.id,{duration:e.duration,stagger:e.stagger,intensity:1,direction:e.id.startsWith('pivot-')?'bottom-left':['orbit','spin'].includes(e.id)?'right':'up',split:'char',dust:true,curvature:.5,markColor:'#ffe066'})}));
fs.writeFileSync(path.join(output,'plans.json'),JSON.stringify(plans,null,2));
const {chromium}=require(require.resolve('playwright',{paths:[root,path.join(root,'.tools/js')]}));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.goto('about:blank');
 await page.addScriptTag({path:path.join(root,'features/shapes/prototype/material-renderer.js')});
 // Use the same artwork as the built-in preset library; no synthetic replacement.
 const artwork=fs.readFileSync(path.join(root,'features/shapes/prototype/assets/glass-silk-amber-v1.png')).toString('base64');
 await page.evaluate(async data=>{globalThis.galleryArtwork=new Image();galleryArtwork.src='data:image/png;base64,'+data;await galleryArtwork.decode();},artwork);
 const aliases={blue:'冰蓝弥散',purple:'紫色辉光',aurora:'极光混色',glass:'通透玻璃',frosted:'柔雾玻璃',smoked:'深色玻璃'};
 const materials=await page.evaluate(()=>Object.entries(MaterialLab.presets).map(([id,p])=>({id,name:p.label,effect:p.effect,shape:p.previewShape||'roundedRect'})));
 for(const item of materials){
  item.name=aliases[item.id]||item.name;
  const png=await page.evaluate(item=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=440;
   const background=document.createElement('canvas');background.width=900;background.height=720;
   const ctx=background.getContext('2d');
   if(item.effect==='glass'){
    const scale=Math.max(900/galleryArtwork.width,720/galleryArtwork.height);
    ctx.drawImage(galleryArtwork,(900-galleryArtwork.width*scale)/2,(720-galleryArtwork.height*scale)/2,galleryArtwork.width*scale,galleryArtwork.height*scale);
   }else{ctx.fillStyle='#090B13';ctx.fillRect(0,0,900,720);}
   MaterialLab.render(canvas,{preset:item.id,shape:item.shape==='circle'?'ellipse':'roundedRect',...(item.shape==='circle'?{previewAspect:1}:{}),content:false,backgroundCanvas:background});
   return canvas.toDataURL('image/png').split(',')[1];
  },item);
  fs.writeFileSync(path.join(media,'material-'+item.id+'.png'),Buffer.from(png,'base64'));
 }
 const inventory={version:'1.0.11',animations:plans.map(({id,name,mode,category,duration})=>({id,name,mode,category,duration})),materials};
 fs.writeFileSync(path.join(output,'inventory.json'),JSON.stringify(inventory,null,2));
 console.log(`Prepared ${plans.length} animation plans and ${materials.length} material thumbnails`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
