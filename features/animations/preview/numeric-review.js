(function(){
 'use strict';
 const cases={integer:{numberEnd:12860,numberGrouping:true},carry:{numberEnd:1000,numberGrouping:true},percent:{numberEnd:98.6,numberDecimals:1,numberSuffix:'%',numberGrouping:false},negative:{numberEnd:-125.30,numberDecimals:2,numberGrouping:false}};
 let scenes=[],raf=0,epoch=0,time=0,playing=false;
 const duration=1.6,play=document.querySelector('#play'),timeline=document.querySelector('#timeline'),clock=document.querySelector('#time');
 function render(t){time=t;scenes.forEach(s=>s.render(t));timeline.value=t;clock.textContent=`${t.toFixed(2)} / ${duration.toFixed(2)} s`;}
 function pause(){playing=false;cancelAnimationFrame(raf);raf=0;play.textContent='播放对照';}
 function tick(now){const t=Math.min(duration,(now-epoch)/1000);render(t);if(t<duration)raf=requestAnimationFrame(tick);else pause();}
 function start(){pause();render(0);playing=true;play.textContent='暂停';epoch=performance.now();raf=requestAnimationFrame(tick);}
 function select(id){pause();scenes.forEach(s=>s.destroy());scenes=['count','roll'].map(style=>MotionNumbers.create(document.querySelector('#'+style),{...cases[id],duration,numberStyle:style}));document.querySelectorAll('[data-case]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.case===id)));start();}
 play.addEventListener('click',()=>{if(playing)pause();else{if(time>=duration)render(0);playing=true;play.textContent='暂停';epoch=performance.now()-time*1000;raf=requestAnimationFrame(tick);}});
 timeline.addEventListener('input',()=>{pause();render(Number(timeline.value));});
 document.querySelectorAll('[data-case]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.case)));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 globalThis.NumericReview={select,render(t){pause();render(t);},get scenes(){return scenes;}};
 select('integer');
})();
