// Resources are immutable snapshots, replaced when the captured target/background changes.
let resources={};
onmessage=event=>{
 const {id,options,scale,images}=event.data;
 try{
  for(const [key,image] of Object.entries(images||{})){
   const canvas=new OffscreenCanvas(image.width,image.height);
   canvas.getContext('2d').putImageData(image,0,0);resources[key]=canvas;
  }
  let canvas;
  if(options.thumbnail){
   canvas=new OffscreenCanvas(300,240);
   MaterialLab.render(canvas,{...options,backgroundCanvas:resources.backgroundCanvas});
  }else canvas=MaterialLab.exportMaterial({...options,immutableMask:true,alphaMask:resources.alphaMask,backgroundCanvas:resources.backgroundCanvas},scale);
  const bitmap=canvas.transferToImageBitmap();postMessage({id,bitmap},[bitmap]);
 }catch(error){postMessage({id,error:error.message});}
};
