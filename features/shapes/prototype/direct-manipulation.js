/* Local editor handles. They never enter the material renderer or PNG output. */
(function(global){
  'use strict';
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const round=value=>Math.round(value*10)/10;
  const rotate=(x,y,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [x*c-y*s,x*s+y*c];};
  const wrap=value=>round(((value+180)%360+360)%360-180);
  function create({canvas,overlay,getSelection,getFrame,onChange,onFinish,onStart,onDuplicate}){
    const box=overlay.querySelector('#ml-gizmo-box');
    const caption=overlay.querySelector('#ml-gizmo-caption');
    const buttons=[...overlay.querySelectorAll('[data-handle]')];
    const blurRing=overlay.querySelector('#ml-blur-ring');
    const blurValue=overlay.querySelector('#ml-ring-blur-value');
    let drag=null;
    function frame(){
      const card=getFrame();if(!card)return null;
      const bounds=canvas.getBoundingClientRect();
      return {left:bounds.left,top:bounds.top,x:card.x*bounds.width/canvas.width,y:card.y*bounds.height/canvas.height,w:card.w*bounds.width/canvas.width,h:card.h*bounds.height/canvas.height,width:bounds.width,height:bounds.height};
    }
    function patchValues(layer,handle){return handle==='blur'?{blur:layer.blur}:handle==='rotate'?{rotation:layer.rotation||0}:layer.type==='inner-shadow'?{offsetX:layer.offsetX,offsetY:layer.offsetY,rotation:layer.rotation||0}:{x:layer.x,y:layer.y,sizeX:layer.sizeX,sizeY:layer.sizeY,rotation:layer.rotation||0};}
    function stop(restore){
      if(!drag)return;const previous=drag;drag=null;overlay.dataset.dragging='false';overlay.dataset.adjustingBlur='false';
      if(previous.button.hasPointerCapture?.(previous.pointerId))previous.button.releasePointerCapture(previous.pointerId);
      const selected=getSelection();
      if(restore&&selected?.key===previous.key)onChange(previous.original);
      if(onFinish)onFinish(restore?'cancel':'commit');
    }
    function update(){
      const selected=getSelection(),f=frame();
      if(drag&&(!selected||selected.key!==drag.key||!selected.visible))stop(false);
      overlay.hidden=!selected||!selected.visible||!f;
      if(overlay.hidden)return;
      const layer=selected.layer,shadow=layer.type==='inner-shadow';
      const angle=layer.rotation||0,offset=rotate(layer.offsetX||0,layer.offsetY||0,angle);
      const cx=f.x+f.w*(shadow ? 0.5+offset[0]/600 : layer.x/100);
      const cy=f.y+f.h*(shadow ? 0.5+offset[1]/460 : layer.y/100);
      const width=shadow?0:f.w*layer.sizeX/100,height=shadow?0:f.h*layer.sizeY/100;
      box.hidden=shadow;
      if(!shadow){box.style.left=(cx-width/2)+'px';box.style.top=(cy-height/2)+'px';box.style.width=width+'px';box.style.height=height+'px';const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),ratio=(f.h/460)/(f.w/600);box.style.transform=`matrix(${c},${s*ratio},${-s/ratio},${c},0,0)`;}
      caption.textContent=(shadow?'内阴影偏移 · ':'色光 · ')+(layer.name||'未命名图层');
      // Keep edge handles reachable for broad light fields that extend past the preview.
      const handleW=shadow?112:Math.max(width,4),handleH=shadow?112:Math.max(height,4);
      const local={nw:[-handleW/2,-handleH/2],n:[0,-handleH/2],ne:[handleW/2,-handleH/2],e:[handleW/2,0],se:[handleW/2,handleH/2],s:[0,handleH/2],sw:[-handleW/2,handleH/2],w:[-handleW/2,0],rotate:[0,-handleH/2-26]};
      const points={move:[cx,cy]};for(const [name,[x,y]]of Object.entries(local)){const p=rotate(x/f.w*600,y/f.h*460,angle);points[name]=[cx+p[0]/600*f.w,cy+p[1]/460*f.h];}
      for(const button of buttons){
        const name=button.dataset.handle;button.hidden=shadow&&!['move','rotate'].includes(name);
        const [x,y]=points[name],margin=name==='move'?36:16;
        button.style.left=clamp(x,margin,f.width-margin)+'px';button.style.top=clamp(y,margin,f.height-margin)+'px';
        if(name==='move')button.setAttribute('aria-label',shadow?'移动内阴影偏移':'移动当前色光');
        if(name==='rotate'){button.setAttribute('aria-valuenow',angle);button.setAttribute('aria-valuetext',angle+'°');button.title='旋转 '+angle+'° · Shift 吸附 15°';}
      }
      blurRing.style.left=clamp(cx,36,f.width-36)+'px';blurRing.style.top=clamp(cy,36,f.height-36)+'px';
      blurRing.style.setProperty('--ml-blur-angle',(layer.blur*3.6)+'deg');
      blurRing.setAttribute('aria-valuenow',String(layer.blur));
      blurRing.setAttribute('aria-valuetext',String(layer.blur)+(shadow?' px':'，范围 0 到 100'));
      blurRing.setAttribute('aria-label',shadow?'内阴影模糊，拖动圆环调整':'色光模糊，拖动圆环调整');
      blurValue.textContent=String(layer.blur);
    }
    function angleAt(event,center){return (Math.atan2(event.clientY-center.y,event.clientX-center.x)*180/Math.PI+450)%360;}
    function rotationAt(event,state){return Math.atan2((event.clientY-state.center.y)/state.frame.h*460,(event.clientX-state.center.x)/state.frame.w*600)*180/Math.PI;}
    const angleDelta=(next,previous)=>(next-previous+540)%360-180;
    function calculate(original,handle,dx,dy,proportional){
      if('offsetX'in original){const p=rotate(dx,dy,-original.rotation);return {offsetX:round(clamp(original.offsetX+p[0],-100,100)),offsetY:round(clamp(original.offsetY+p[1],-100,100))};}
      if(handle==='move')return {x:round(clamp(original.x+dx,0,100)),y:round(clamp(original.y+dy,0,100))};
      const local=rotate(dx*6,dy*4.6,-original.rotation);dx=local[0]/6;dy=local[1]/4.6;
      const horizontal=handle.includes('e')?1:handle.includes('w')?-1:0;
      const vertical=handle.includes('s')?1:handle.includes('n')?-1:0;
      let width=clamp(original.sizeX+horizontal*dx,1,150),height=clamp(original.sizeY+vertical*dy,1,150);
      if(proportional&&horizontal&&vertical){
        const fw=width/original.sizeX,fh=height/original.sizeY;
        let factor=Math.abs(fw-1)>=Math.abs(fh-1)?fw:fh;
        factor=clamp(factor,Math.max(1/original.sizeX,1/original.sizeY),Math.min(150/original.sizeX,150/original.sizeY));
        width=original.sizeX*factor;height=original.sizeY*factor;
      }
      const shift=rotate(horizontal*(width-original.sizeX)*3,vertical*(height-original.sizeY)*2.3,original.rotation);
      return {sizeX:round(width),sizeY:round(height),x:round(clamp(original.x+shift[0]/6,0,100)),y:round(clamp(original.y+shift[1]/4.6,0,100))};
    }
    box.dataset.handle='move';
    for(const button of [...buttons,box,blurRing]){
      button.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;const selection=getSelection(),f=frame();if(!selection?.visible||!f)return;
        const handle=button===blurRing?'blur':button.dataset.handle;
        const rect=button.getBoundingClientRect(),center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
        if(handle==='blur'&&Math.hypot(event.clientX-center.x,event.clientY-center.y)<18)return;
        event.preventDefault();stop(false);button.focus({preventScroll:true});
        drag={key:selection.key,original:patchValues(selection.layer,handle),handle,startX:event.clientX,startY:event.clientY,frame:f,pointerId:event.pointerId,button,center,copyPending:handle==='move'&&event.ctrlKey};
        if(onStart)onStart();
        button.setPointerCapture(event.pointerId);overlay.dataset.dragging='true';
        if(handle==='rotate'){
          const layer=selection.layer,shadow=layer.type==='inner-shadow';
          drag.center={x:f.left+f.x+f.w*(shadow?.5:layer.x/100),y:f.top+f.y+f.h*(shadow?.5:layer.y/100)};
          drag.lastAngle=rotationAt(event,drag);drag.angle=layer.rotation||0;
        }
        if(handle==='blur'){
          overlay.dataset.adjustingBlur='true';drag.lastAngle=angleAt(event,center);
          // Grabbing the thumb preserves its value; clicking elsewhere seeks to that angle.
          drag.blurValue=Math.abs(angleDelta(drag.lastAngle,selection.layer.blur*3.6))<15?selection.layer.blur:drag.lastAngle/3.6;
          onChange({blur:Math.round(drag.blurValue)});
        }
      });
      button.addEventListener('pointermove',event=>{
        if(!drag||event.pointerId!==drag.pointerId)return;
        const selection=getSelection();if(!selection||selection.key!==drag.key){stop(false);return;}
        if(drag.copyPending){
          if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<4)return;
          const key=onDuplicate?.();
          if(!key){stop(true);return;}
          drag.key=key;drag.copyPending=false;
        }
        if(drag.handle==='rotate'){
          const next=rotationAt(event,drag);drag.angle+=angleDelta(next,drag.lastAngle);drag.lastAngle=next;
          onChange({rotation:wrap(event.shiftKey?Math.round(drag.angle/15)*15:drag.angle)});return;
        }
        if(drag.handle==='blur'){
          if(Math.hypot(event.clientX-drag.center.x,event.clientY-drag.center.y)<12)return;
          const next=angleAt(event,drag.center);
          // Integrate the shortest angular delta so crossing the top saturates at 0/100.
          drag.blurValue=clamp(drag.blurValue+angleDelta(next,drag.lastAngle)/3.6,0,100);drag.lastAngle=next;
          onChange({blur:Math.round(drag.blurValue)});return;
        }
        const shadow='offsetX'in drag.original;
        const dx=(event.clientX-drag.startX)/drag.frame.w*(shadow?600:100),dy=(event.clientY-drag.startY)/drag.frame.h*(shadow?460:100);
        onChange(calculate(drag.original,drag.handle,dx,dy,event.shiftKey));
      });
      button.addEventListener('pointerup',event=>{if(drag&&event.pointerId===drag.pointerId)stop(false);});
      button.addEventListener('pointercancel',event=>{if(drag&&event.pointerId===drag.pointerId)stop(true);});
      button.addEventListener('lostpointercapture',()=>{if(drag)stop(true);});
      button.addEventListener('keydown',event=>{
        if(button.dataset.handle==='rotate'){
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;
          const selection=getSelection();if(!selection?.visible||drag)return;event.preventDefault();
          const step=event.shiftKey?15:1;
          onChange({rotation:event.key==='Home'?0:wrap((selection.layer.rotation||0)+(['ArrowRight','ArrowUp'].includes(event.key)?step:-step))});if(onFinish)onFinish('commit');return;
        }
        if(button===blurRing){
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
          const selection=getSelection();if(!selection?.visible)return;event.preventDefault();
          if(drag)return;
          const step=event.shiftKey?10:1,value=event.key==='Home'?0:event.key==='End'?100:selection.layer.blur+(['ArrowRight','ArrowUp'].includes(event.key)?step:-step);
          onChange({blur:clamp(value,0,100)});if(onFinish)onFinish('commit');return;
        }
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        const selection=getSelection();if(!selection?.visible)return;
        event.preventDefault();const step=event.shiftKey?10:1;
        const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
        onChange(calculate(patchValues(selection.layer),button.dataset.handle,dx,dy,false));
        if(onFinish)onFinish('commit');
      });
    }
    const escape=event=>{if(event.key==='Escape'&&drag){event.preventDefault();stop(true);}};
    document.addEventListener('keydown',escape);
    return {update,cancel:()=>stop(true),dispose:()=>{stop(false);document.removeEventListener('keydown',escape);}};
  }
  global.MaterialHandles=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
