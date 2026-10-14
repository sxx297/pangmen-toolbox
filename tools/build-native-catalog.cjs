const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../features/animations'),context=vm.createContext({Intl,console});
for(const file of ['catalog.js','native-support.js','motion-engine.js','native-plan.js'])vm.runInContext(fs.readFileSync(path.join(root,'preview',file),'utf8'),context);
const plans=vm.runInContext(`MotionCatalog.effects.map(e=>PangNativePlan(e.id,{duration:e.duration,stagger:e.stagger,intensity:1,direction:e.id==='orbit'?'right':'up',split:'char',directionAngle:0,dust:true,curvature:.5,markColor:'#ffe066'}))`,context);
fs.writeFileSync(path.join(root,'powerpoint/native-catalog.json'),JSON.stringify(plans,null,2));
console.log('Generated '+plans.length+' native animation plans');
