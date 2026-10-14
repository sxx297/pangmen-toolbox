/* Original procedural scenes for seeing transmitted and refracted background detail. */
(function(global){
  'use strict';
  const cache=new Map();
  function create(mode,width=900,height=720){
    const key=[mode,width,height].join(':');if(cache.has(key))return cache.get(key);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.scale(width/900,height/720);
    if(mode==='grid'){
      ctx.fillStyle='#e9edf5';ctx.fillRect(0,0,900,720);
      for(let y=0;y<720;y+=40)for(let x=0;x<900;x+=40){ctx.fillStyle=((x+y)/40)%2?'#ccd5e7':'#f6f8fb';ctx.fillRect(x,y,40,40);}
      ctx.strokeStyle='#6f7b97';ctx.lineWidth=1;
      for(let x=0;x<=900;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,720);ctx.stroke();}
      for(let y=0;y<=720;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(900,y);ctx.stroke();}
      ctx.fillStyle='#ff624f';ctx.fillRect(200,0,20,720);ctx.fillStyle='#2563eb';ctx.fillRect(0,490,900,20);
      ctx.fillStyle='#1d2a45';ctx.font='500 46px "Segoe UI",sans-serif';ctx.fillText('0123456789',265,296);
      ctx.fillText('REFRACTION',265,440);
    }else if(mode==='type'){
      ctx.fillStyle='#eeeae4';ctx.fillRect(0,0,900,720);
      ctx.fillStyle='#ef5d43';ctx.beginPath();ctx.arc(706,146,244,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#334ed0';ctx.fillRect(36,470,860,158);
      ctx.fillStyle='#192039';ctx.font='500 154px "Segoe UI",sans-serif';ctx.fillText('GLASS',80,290);
      ctx.font='500 118px "Segoe UI",sans-serif';ctx.fillText('OPTICS',220,436);
      ctx.fillStyle='#fff';ctx.font='500 54px "Segoe UI",sans-serif';ctx.fillText('Light through matter',107,574);
      ctx.strokeStyle='#222842';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,318);ctx.lineTo(900,318);ctx.stroke();
    }else{
      const bg=ctx.createLinearGradient(0,0,900,720);bg.addColorStop(0,'#b8ccfa');bg.addColorStop(.5,'#7770c9');bg.addColorStop(1,'#242663');ctx.fillStyle=bg;ctx.fillRect(0,0,900,720);
      // Each closed curve is a folded ribbon, so boundaries remain legible through glass.
      const ribbons=[
        {path:'M-180 700C-60 240 560 180 430 -150L850 -150C940 320 50 285 250 820Z',stops:[[0,'#eeefff'],[.32,'#a6befe'],[.51,'#576ada'],[.68,'#293496'],[1,'#a4b1fb']]},
        {path:'M380 -120C950 100 135 350 170 720L520 820C210 290 1100 290 990 -100Z',stops:[[0,'#939cf4'],[.25,'#dce5ff'],[.43,'#748fef'],[.64,'#33469f'],[1,'#161e65']]},
        {path:'M-100 630C100 320 330 760 970 360L990 720H-100Z',stops:[[0,'#7e91e5'],[.45,'#c4d9ff'],[.52,'#799bef'],[.67,'#4761c6'],[1,'#192856']]}
      ];
      for(let i=0;i<ribbons.length;i++){
        const r=ribbons[i],gradient=ctx.createLinearGradient(i===1?250:0,0,850,720);
        r.stops.forEach(([at,color])=>gradient.addColorStop(at,color));ctx.fillStyle=gradient;ctx.fill(new Path2D(r.path));
      }
      ctx.save();ctx.strokeStyle='#e7edff66';ctx.lineWidth=1.3;
      ctx.stroke(new Path2D('M850 -20C940 320 50 285 250 820'));ctx.stroke(new Path2D('M-100 630C100 320 330 760 970 360'));ctx.restore();
    }
    cache.set(key,canvas);return canvas;
  }
  global.MaterialBackgrounds=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
