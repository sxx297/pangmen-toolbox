/* Shared transient operation feedback for hosted tool panels. */
(function(global){
  'use strict';
  function create(element){
    let timer=0;
    element.classList.add('pm-toast');
    element.setAttribute('aria-atomic','true');
    function clear(){clearTimeout(timer);element.classList.remove('visible');element.textContent='';}
    function show(message,error=false){
      clearTimeout(timer);
      const text=String(message||'');
      if(!text){clear();return;}
      element.setAttribute('role',error?'alert':'status');
      element.setAttribute('aria-live',error?'assertive':'polite');
      element.textContent=text;
      element.classList.add('visible');
      // Give multi-line messages time to be read, and replace the previous timer.
      timer=setTimeout(clear,error?Math.max(2800,Math.min(5000,text.length*45)):Math.max(1800,Math.min(3500,text.length*40)));
    }
    global.addEventListener('pagehide',clear);
    return Object.freeze({show,clear});
  }
  global.PangToast=Object.freeze({create});
})(globalThis);
