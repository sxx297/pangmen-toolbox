using System;using System.IO;using System.Linq;using System.Reflection;using System.Collections.Generic;using System.Drawing;using System.Drawing.Imaging;using System.Web.Script.Serialization;using System.Diagnostics;
class FreeformOfficeRegression {
 static BindingFlags F=BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance;
 static List<object> report=new List<object>();
 static object Call(object b,string name,params object[] args){try{return b.GetType().GetMethod(name,F).Invoke(b,args);}catch(TargetInvocationException e){throw e.InnerException;}}
 static Dictionary<string,object> Request(object b,string name,Dictionary<string,object> args=null){return (Dictionary<string,object>)Call(b,"Handle",name,args??new Dictionary<string,object>());}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS "+message);}
 static string Png(){using(var b=new Bitmap(64,64)){using(var g=Graphics.FromImage(b))g.Clear(Color.DeepSkyBlue);using(var s=new MemoryStream()){b.Save(s,ImageFormat.Png);return "data:image/png;base64,"+Convert.ToBase64String(s.ToArray());}}}
 [STAThread]static int Main(string[] args){dynamic app=null,doc=null,previous=null;try{
  if(args[0]=="--seed"){
   app=Activator.CreateInstance(Type.GetTypeFromProgID("PowerPoint.Application"));try{previous=app.ActiveWindow;}catch{}
   doc=app.Presentations.Add(0);dynamic seedSlide=doc.Slides.Add(1,12);
   dynamic builder=seedSlide.Shapes.BuildFreeform(1,100,100);builder.AddNodes(0,0,300,100);builder.AddNodes(0,0,300,240);builder.AddNodes(0,0,100,100);builder.ConvertToShape();
   builder=seedSlide.Shapes.BuildFreeform(1,100,100);builder.AddNodes(1,1,140,50,260,50,300,100);builder.AddNodes(0,0,300,240);builder.AddNodes(1,1,250,290,150,290,100,240);builder.AddNodes(0,0,100,100);builder.ConvertToShape();
   seedSlide.Shapes.AddShape(5,100,100,200,100);doc.SaveAs(Path.GetFullPath(args[1]),24);return 0;
  }
  string dir=Path.GetFullPath(args[0]),output=Path.GetFullPath(args[2]);Directory.CreateDirectory(output);
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(dir,new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};
  var assembly=Assembly.LoadFrom(Path.Combine(dir,"PangmenToolbox.AddIn.dll"));var type=assembly.GetType("PangmenToolbox.Shapes.PowerPointBridge",true);
  app=Activator.CreateInstance(Type.GetTypeFromProgID("PowerPoint.Application"));try{previous=app.ActiveWindow;}catch{}
  doc=app.Presentations.Open(Path.GetFullPath(args[1]),0,0,-1);dynamic slide=doc.Slides[1];
  var bridge=Activator.CreateInstance(type,new object[]{app,output});int count=(int)slide.Shapes.Count;
  for(int i=1;i<=count;i++){
   dynamic shape=slide.Shapes[i];string name=(string)shape.Name;shape.Select(-1);
   string nodeError=null;
   if((int)shape.Type==5)try{for(int n=1;n<=(int)shape.Nodes.Count;n++){dynamic node=shape.Nodes[n];int e=(int)node.EditingType,t=(int)node.SegmentType;Array points=(Array)node.Points;}}catch(Exception e){nodeError=e.Message;}
   var watch=Stopwatch.StartNew();int saved=(int)doc.Saved;
   var observed=(Dictionary<string,object>)Call(bridge,"ObserveSelection");Check((bool)observed["supported"],name+" selection supported: "+observed["reason"]);
   var capture=Request(bridge,"captureSelection");Check((int)doc.Saved==saved,name+" capture leaves saved flag unchanged");
   string mask=(string)capture["maskPng"];File.WriteAllBytes(Path.Combine(output,name+"-mask.png"),Convert.FromBase64String(mask.Substring(mask.IndexOf(',')+1)));
   if(name=="import-hole")using(var bitmap=new Bitmap(Path.Combine(output,name+"-mask.png"))){
    Check(bitmap.GetPixel(bitmap.Width/2,bitmap.Height/2).A==0,"imported hole remains transparent");
    Check(bitmap.GetPixel(bitmap.Width/6,bitmap.Height/2).A>200,"imported outer path remains filled");
    Check(nodeError!=null,"fixture reproduces COM node failure");
   }
   string signature=(string)((Dictionary<string,object>)Call(bridge,"ObserveSelection"))["signature"];
   var poll=Stopwatch.StartNew();for(int n=0;n<5;n++)Check((string)((Dictionary<string,object>)Call(bridge,"ObserveSelection"))["signature"]==signature,name+" stable observation");poll.Stop();
   int before=(int)slide.Shapes.Count;
   var data=new Dictionary<string,object>{{"token",capture["token"]},{"png",Png()},{"settings",new Dictionary<string,object>{{"effect","glass"}}}};
   Request(bridge,"applyMaterial",data);int after=(int)slide.Shapes.Count;
   Request(bridge,"applyMaterial",data);Check((int)slide.Shapes.Count==after,name+" repeat apply does not add backups");
   Request(bridge,"restoreMaterial",new Dictionary<string,object>{{"token",capture["token"]}});Check((int)slide.Shapes.Count==before,name+" restore removes backup");
   capture=Request(bridge,"captureSelection");
   // Keep the bounding box fixed while changing a freeform vertex.
   if((int)shape.Type==5 && name=="import-hole"){
    float l=(float)shape.Left,t=(float)shape.Top,w=(float)shape.Width,h=(float)shape.Height;
    Array point=(Array)shape.Nodes[2].Points;float x=Convert.ToSingle(point.GetValue(point.GetLowerBound(0),point.GetLowerBound(1))),y=Convert.ToSingle(point.GetValue(point.GetLowerBound(0),point.GetLowerBound(1)+1));
    shape.Nodes.SetPosition(2,x-10,y+5);shape.Left=l;shape.Top=t;shape.Width=w;shape.Height=h;
    data["token"]=capture["token"];string error="";try{Request(bridge,"applyMaterial",data);}catch(Exception e){error=e.Message;}
    Check(error.StartsWith("STALE_TARGET"),name+" same-bounds path edit rejects stale application");
   }
   report.Add(new{name,type=(int)shape.Type,nodeError,fallback=signature.Contains("xml:"),elapsedMs=watch.ElapsedMilliseconds,fivePollsMs=poll.ElapsedMilliseconds});
  }
  doc.SaveAs(Path.Combine(output,"validated-freeforms.pptx"),24);File.WriteAllText(Path.Combine(output,"report.json"),new JavaScriptSerializer().Serialize(report));return 0;
 }catch(Exception e){Console.Error.WriteLine(e);return 1;}finally{if(doc!=null){doc.Saved=-1;doc.Close();}if(previous!=null)try{previous.Activate();}catch{}}}
}
