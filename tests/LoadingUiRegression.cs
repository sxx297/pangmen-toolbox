using System;using System.IO;using System.Linq;using System.Reflection;using System.Drawing;using System.Windows.Forms;using System.Threading.Tasks;using System.Diagnostics;
public class EmptyOfficeApplication {public object ActiveWindow{get{return null;}} public object ActivePresentation{get{return null;}}}
class LoadingUiRegression {
 static BindingFlags F=BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance;
 static void Wait(Func<bool> done){var clock=Stopwatch.StartNew();while(!done()){Application.DoEvents();System.Threading.Thread.Sleep(20);if(clock.Elapsed.TotalSeconds>45)throw new Exception("Editor cover did not release");}}
 static object Call(object o,string name,params object[] args){var method=o.GetType().GetMethod(name,F);if(method==null&&name=="AttachToPane")method=o.GetType().GetMethods(F).Single(m=>m.GetParameters().Length==1&&m.GetParameters()[0].ParameterType==typeof(Control)&&m.DeclaringType==o.GetType());return method.Invoke(o,args);}
 static string JS(object b,string code){var t=(Task<string>)Call(b,"ExecuteScriptAsync",code);Wait(()=>t.IsCompleted);return t.GetAwaiter().GetResult();}
 [STAThread]static int Main(string[] args){try{
  Application.EnableVisualStyles();string dir=Path.GetFullPath(args[0]);Directory.CreateDirectory(args[1]);
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(dir,new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};
  var assembly=Assembly.LoadFrom(Path.Combine(dir,"PangmenToolbox.AddIn.dll"));
  foreach(string browserField in new[]{"browser","webView"}){
   Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER",Path.GetFullPath(Path.Combine(args[1],browserField+"-profile")));
   var type=assembly.GetTypes().Single(t=>t.IsSubclassOf(typeof(Form))&&t.GetField(browserField,F)!=null&&t.GetField("loading",F)!=null);
   using(var shell=new Form()){shell.ClientSize=new Size(320,900);var panel=new Panel{Dock=DockStyle.Fill};shell.Controls.Add(panel);shell.Show();
    using(var editor=(Form)Activator.CreateInstance(type,F,null,new object[]{new EmptyOfficeApplication(),0L},null)){
     Call(editor,"AttachToPane",panel);var cover=(Control)type.GetField("loading",F).GetValue(editor);
     if(!cover.Visible||cover.Parent.Controls.GetChildIndex(cover)!=0||cover.Text!="正在加载…")throw new Exception("Missing common initial cover");
     using(var bitmap=new Bitmap(320,900)){cover.DrawToBitmap(bitmap,new Rectangle(0,0,320,900));bitmap.Save(Path.Combine(args[1],browserField+"-loading.png"));}
     var browser=type.GetField(browserField,F).GetValue(editor);
     try { Wait(()=>!cover.Visible||cover.Text!="正在加载…");if(cover.Visible)throw new Exception(cover.Text); } catch { Console.WriteLine("COVER: "+cover.Text); Console.WriteLine(JS(browser,"({state:document.readyState,visibility:document.visibilityState,ready:!!globalThis.PangPanelReady,fonts:document.fonts.status,html:document.body.innerText.slice(0,100)})")); throw; }
     if((Color)browser.GetType().GetProperty("DefaultBackgroundColor").GetValue(browser)!=cover.BackColor)throw new Exception("Background mismatch");
     if(browserField=="webView"&&JS(browser,"document.querySelector('#ml-status').textContent")!="\"\"")throw new Exception("Unexpected startup notice");
     File.WriteAllText(Path.Combine(args[1],browserField+"-ready.json"),JS(browser,"({ready:!!globalThis.PangPanelReady,fonts:document.fonts.status,surface:document.body.dataset.surface||document.querySelector('#ppt-material-lab').dataset.panelMode})"));
     if(browserField=="browser") {
      shell.Activate();((Control)browser).Focus();
      JS(browser,"window.focusLosses=0;window.addEventListener('blur',()=>focusLosses++);PangSurface.set('floating');MotionPreview.selectEffect('zoom-in');MotionPreview.updateParameters({duration:2},true);");
      Wait(()=>JS(browser,"MotionPreview.getState().time>.05")=="true");
      using(var target=new TextBox { Dock=DockStyle.Bottom }) {
       shell.Controls.Add(target);target.BringToFront();target.Focus();
       Wait(()=>JS(browser,"window.focusLosses>0")=="true");
       Wait(()=>JS(browser,"document.querySelector('#stage-state').textContent==='播放完成'")=="true");
       File.WriteAllText(Path.Combine(args[1],"native-focus.json"),JS(browser,"({focusLosses,playing:MotionPreview.getState().playing,time:MotionPreview.getState().time,status:document.querySelector('#stage-state').textContent})"));
       Console.WriteLine("PASS actual WebView2 focus transfer completes visible sample");
      }
     }
     Console.WriteLine("PASS "+browserField+" common cover, matching background, ready handshake, empty-selection startup");
    }shell.Close();
   }
  }return 0;
 }catch(Exception e){Console.Error.WriteLine(e);return 1;}}
}
