(function () {
  const priority = new Set(['anvil','pivot-in','pivot-out','jack-in','roll-in','roll-out','grid-in','grid-out','flip-once','wipe-in','wipe-out','text-lines-in','text-lines-out','number-roll','number-count']);
  const angles = {up:0,'up-right':45,right:90,'down-right':135,down:180,'down-left':225,left:270,'up-left':315};
  const nativeDirections = {up:1,right:2,down:3,left:4,'up-left':6,'up-right':7,'down-right':8,'down-left':9,'top-left':12,'top-right':13,'bottom-right':14,'bottom-left':15};
  globalThis.PangNativePlan = function (id, options) {
    const effect = MotionCatalog.effects.find(e => e.id === id);
    if (!effect) throw new Error('此动画不在当前 PPT 动画库中。');
    const o = {...options};
    const angle = ((Number(o.directionAngle ?? angles[o.direction] ?? 0) % 360) + 360) % 360;
    const frames = [];
    if (!priority.has(id)) {
      for (let i=0;i<=48;i++) {
        const p=i/48, s=MotionEngine.sample(id,p,0,1,o.intensity,o.direction,{curvature:o.curvature},angle);
        frames.push({t:p,x:s.x,y:s.y,sx:Math.max(.001,s.sx),sy:Math.max(.001,s.sy),r:s.rz,opacity:s.opacity});
      }
      for (const key of ['x','y','sx','sy','r','opacity']) {
        const baseline=['sx','sy','opacity'].includes(key)?1:0;
        if(frames.every(f=>Math.abs(f[key]-baseline)<1e-8)) for(const f of frames)delete f[key];
      }
    }
    return {id,mode:effect.mode,category:effect.category,duration:o.duration,stagger:o.stagger,
      intensity:o.intensity,direction:o.direction,directionAngle:angle,nativeDirection:nativeDirections[o.direction] ?? 0,
      split:o.split,dust:o.dust,curvature:o.curvature,markColor:o.markColor,frames,
      numberStart:o.numberStart,numberEnd:o.numberEnd,numberDecimals:o.numberDecimals,
      numberPrefix:o.numberPrefix,numberSuffix:o.numberSuffix,numberGrouping:o.numberGrouping,numberStyle:id==='number-count'?'count':'roll'};
  };
})();
