// Render documented recipes with the production material renderer.
// Usage: node examples/render-materials.cjs [source root] [output directory]
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const output=path.resolve(process.argv[3]||path.join(__dirname,'output'));
const {chromium}=require(path.join(root,'node_modules/playwright'));
(async()=>{fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage();await page.goto('about:blank');
await page.addScriptTag({path:path.join(root,'features/shapes/prototype/material-renderer.js')});
for(const key of ['blue','purple','aurora','glass','mistLens','cloudPane']){
 const png=await page.evaluate(key=>{const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=828;
 // The native renderer supplies the glass sample backdrop and material itself.
 if(['glass','mistLens','cloudPane'].includes(key))MaterialLab.render(canvas,{preset:key,content:false});
 else{const texture=MaterialLab.exportMaterial({preset:key,content:false},1.8);canvas.getContext('2d').drawImage(texture,0,0,1080,828);}
 return canvas.toDataURL('image/png').split(',')[1];},key);
 fs.writeFileSync(path.join(output,'material-'+key+'.png'),Buffer.from(png,'base64'));
}console.log('Rendered six material recipes');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
