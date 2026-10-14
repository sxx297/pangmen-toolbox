using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using PangmenToolbox.Shapes;
using PangmenToolbox.Animations;
using PangmenToolbox.Export;
using Log = PangmenToolbox.Shapes.HostDiagnostics;

namespace PangmenToolbox.AddIn
{
    [ComVisible(true), Guid("84237C4B-02BA-43B6-9B35-E364A9EC6ACB")]
    [ProgId("PangmenToolbox.AddIn"), ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(IToolboxCallbacks))]
    public sealed class Connect : IDTExtensibility2, IRibbonExtensibility, IToolboxCallbacks, ICustomTaskPaneConsumer
    {
        private object application, addin;
        private Control dispatcher;
        private ICTPFactory factory;
        private NumericPreloader preloader;
        private readonly Timer lifecycle = new Timer { Interval=1500 };
        private readonly Dictionary<string,Session> sessions = new Dictionary<string,Session>();
        private readonly Dictionary<string,string> preferences = new Dictionary<string,string>();
        private bool connected;
        private string lastError;
        private sealed class Session
        {
            internal string Module, Mode;
            internal long Id;
            internal object Window;
            internal Form Editor;
            internal IOfficeTaskPane Pane;
            internal TaskPaneControl Container;
            internal Action<Control> Attach;
            internal Action<IWin32Window> Float;
            internal Func<bool> Ready, Visible;
            internal Func<string> Status;
            internal Rectangle FloatingBounds;
            internal int PaneWidth=480;
        }
        static Connect() { PangmenToolbox.Shapes.DependencyResolver.Initialize(); }
        public void OnConnection(object application, ExtConnectMode mode, object addInInstance, ref Array custom)
        {
            try
            {
                ToolboxRuntime.VerifyAssets();
                this.application=application; addin=addInInstance;
                dispatcher = new Control(); var handle=dispatcher.Handle;
                connected=true;
                foreach(string module in new[]{"shapes","animations"})
                {
                    string preference="docked";
                    try { if(module=="shapes" && File.ReadAllText(Path.Combine(ToolboxRuntime.DataDirectory,module,"panel-mode.txt")).Trim()=="floating") preference="floating"; } catch { }
                    preferences[module]=preference;
                }
                lifecycle.Tick += (s,e)=>RetireClosedWindows();
                preloader=new NumericPreloader(application);
                dispatcher.BeginInvoke(new Action(()=> { if(connected && preloader!=null && !ToolboxRuntime.Busy) preloader.WarmOpenPresentations(); }));
                if(addin!=null) ((dynamic)addin).Object=this;
                Log.Log("Toolbox.Connected",ToolboxRuntime.Version);
            }
            catch(Exception ex) { lastError=ex.GetBaseException().Message; Log.Log("Toolbox.Connect.Error",ex.ToString()); throw; }
        }
        public void CTPFactoryAvailable(ICTPFactory value) { factory=value; }
        public string GetCustomUI(string ribbonId)
        {
            return @"<customUI xmlns=""http://schemas.microsoft.com/office/2009/07/customui""><ribbon><tabs><tab id=""PangmenToolboxTab"" label=""旁门工具箱""><group id=""PangmenToolboxHelp"" label=""帮助""><button id=""PangmenToolboxAbout"" label=""关于"" size=""large"" getImage=""GetBrandImage"" onAction=""OnAbout""/></group><group id=""PangmenToolboxExport"" label=""导出""><button id=""PangmenToolboxPdf"" label=""导出 PDF"" size=""large"" imageMso=""FileSaveAsPdfOrXps"" onAction=""OnExportPdf""/></group><group id=""PangmenToolboxShapes"" label=""形状""><button id=""PangmenToolboxParameters"" label=""形状效果"" size=""large"" imageMso=""ShapesInsertGallery"" onAction=""OnOpenPanel""/></group><group id=""PangmenToolboxAnimations"" label=""动画""><button id=""PangmenToolboxAnimationLibrary"" label=""动画库"" size=""large"" imageMso=""AnimationCustom"" onAction=""OnOpenAnimation""/></group></tab></tabs></ribbon></customUI>";
        }
        private void Run(Action action)
        {
            if(dispatcher!=null && !dispatcher.IsDisposed && dispatcher.InvokeRequired) dispatcher.Invoke(action);
            else action();
        }
        public void OpenPanel() { OpenModule("shapes", ""); }
        public void OnOpenPanel(object control) { OpenPanel(); }
        public void OnOpenAnimation(object control) { OpenModule("animations", ""); }
        public void OnOpenFloating(object control) { OpenModule("shapes", "floating"); }
        public void OnOpenDocked(object control) { OpenModule("shapes", "docked"); }
        public void OpenModule(string module, string mode)
        {
            Run(()=>
            {
                try
                {
                    if(!connected || application==null) throw new InvalidOperationException("工具箱尚未连接 PowerPoint。");
                    if(module!="shapes" && module!="animations") throw new ArgumentException("模块无效。");
                    if(mode=="sidebar") mode="docked";
                    if(mode!="" && mode!="floating" && mode!="docked") throw new ArgumentException("窗口形式无效。");
                    object window=((dynamic)application).ActiveWindow;
                    if(window==null) throw new InvalidOperationException("请先打开一份文稿。");
                    long id=OfficeWindowIdentity.Get(window);
                    string key=id+":"+module;
                    Session session;
                    if(!sessions.TryGetValue(key,out session))
                    {
                        session=CreateSession(module,id,window);
                        sessions.Add(key,session); lifecycle.Start();
                    }
                    if(mode=="") mode=session.Mode ?? preferences[module];
                    if(session.Mode=="floating" && session.Editor.Visible) session.FloatingBounds=session.Editor.Bounds;
                    if(session.Pane!=null) { try { session.PaneWidth=session.Pane.Width; } catch { } }
                    if(mode=="docked")
                    {
                        if(factory==null) throw new InvalidOperationException("PowerPoint 尚未提供参数面板接口，请重启 PowerPoint 后重试。");
                        if(session.Pane==null)
                        {
                            IOfficeTaskPane pane=null;
                            try
                            {
                                pane=factory.CreateCTP("PangmenToolbox.TaskPane", module=="shapes" ? "形状效果" : "动画库", window);
                                var container=pane.ContentControl as TaskPaneControl;
                                if(container==null) throw new InvalidOperationException("参数面板容器无法载入。");
                                pane.DockPosition=2; pane.DockPositionRestrict=2; pane.Width=session.PaneWidth;
                                session.Pane=pane; session.Container=container;
                            }
                            catch { if(pane!=null) { try{pane.Delete();}catch{} Release(pane); } throw; }
                        }
                        session.Pane.Visible=true; session.Attach(session.Container);
                    }
                    else
                    {
                        var owner=OfficeWindowIdentity.FloatingOwner(application,window);
                        session.Float(owner==IntPtr.Zero ? null : new OfficeWindow(owner));
                        var peer=sessions.Values.FirstOrDefault(p=>p.Id==id && p!=session && !p.FloatingBounds.IsEmpty);
                        if(peer!=null) session.FloatingBounds=new Rectangle(session.Editor.Location,peer.FloatingBounds.Size);
                        if(!session.FloatingBounds.IsEmpty) session.Editor.Bounds=Fit(session.FloatingBounds,Screen.FromHandle(session.Editor.Handle).WorkingArea);
                        session.FloatingBounds=session.Editor.Bounds;
                        if(session.Pane!=null) session.Pane.Visible=false;
                    }
                    session.Mode=mode; preferences[module]=mode;
                    try { string path=Path.Combine(ToolboxRuntime.DataDirectory,module,"panel-mode.txt"); Directory.CreateDirectory(Path.GetDirectoryName(path)); File.WriteAllText(path,mode); } catch { }
                    lastError=null;
                }
                catch(Exception ex) { lastError=ex.GetBaseException().Message; Log.Log("Toolbox.Panel.Error",ex.ToString()); throw; }
            });
        }
        private Session CreateSession(string module,long id,object window)
        {
            var session=new Session { Module=module,Id=id,Window=window };
            Action<string> change=mode=> { if(connected && OfficeWindowIdentity.Active(application)==id) OpenModule(module,mode); };
            Func<bool> paneVisible=()=> { try{return session.Pane!=null && session.Pane.Visible;}catch{return false;} };
            if(module=="shapes")
            {
                var editor=new MaterialWindow(application,id);
                session.Editor=editor; session.Attach=editor.AttachToPane; session.Float=editor.ShowFloating;
                session.Ready=()=>editor.IsWebViewReady; session.Visible=()=>editor.IsPanelVisible; session.Status=()=>editor.Status;
                editor.PaneVisible=paneVisible; editor.ModeRequested+=change;
            }
            else
            {
                var editor=new AnimationWindow(application,id);
                session.Editor=editor; session.Attach=editor.AttachToPane; session.Float=editor.ShowFloating;
                session.Ready=()=>editor.IsWebViewReady; session.Visible=()=>editor.IsPanelVisible; session.Status=()=>editor.Status;
                editor.PaneVisible=paneVisible; editor.ModeRequested+=change;
            }
            session.Editor.ResizeEnd += (s,e)=> {
                if(session.Mode!="floating" || !session.Editor.Visible) return;
                session.FloatingBounds=session.Editor.Bounds;
                foreach(var peer in sessions.Values.Where(p=>p.Id==id && p!=session)) {
                    peer.Editor.Size=session.Editor.Size;
                    peer.FloatingBounds=new Rectangle(peer.Editor.Location,session.Editor.Size);
                }
            };
            return session;
        }
        private static Rectangle Fit(Rectangle bounds,Rectangle screen)
        {
            int width=Math.Min(bounds.Width,screen.Width),height=Math.Min(bounds.Height,screen.Height);
            return new Rectangle(Math.Max(screen.Left,Math.Min(bounds.Left,screen.Right-width)),Math.Max(screen.Top,Math.Min(bounds.Top,screen.Bottom-height)),width,height);
        }
        public void OnExportPdf(object control)
        {
            Run(()=> { if(ToolboxRuntime.Busy) throw new InvalidOperationException("其他工具正在处理文稿，请稍候。");
                using(var dialog=new PdfExportWindow(application)) {
                    var owner=OfficeWindowIdentity.FloatingOwner(application,((dynamic)application).ActiveWindow);
                    if(owner==IntPtr.Zero)dialog.ShowDialog();else dialog.ShowDialog(new OfficeWindow(owner));
                }
            });
        }
        public object GetBrandImage(object control) { return RibbonBrandImage.Picture; }
        public void OnAbout(object control)
        {
            Run(()=> {
                using(var dialog=new AboutWindow()) {
                    IntPtr owner=IntPtr.Zero;
                    try { owner=OfficeWindowIdentity.FloatingOwner(application,((dynamic)application).ActiveWindow); } catch { }
                    if(owner==IntPtr.Zero)dialog.ShowDialog();else dialog.ShowDialog(new OfficeWindow(owner));
                }
            });
        }
        public string GetStatus()
        {
            string result=null;
            Run(()=>result=new JavaScriptSerializer().Serialize(new { product="旁门工具箱",version=ToolboxRuntime.Version,connected,
                taskPaneAvailable=factory!=null,windowCount=sessions.Values.Select(s=>s.Id).Distinct().Count(),busy=ToolboxRuntime.Busy,license=LicenseGate.State,lastError,
                panels=sessions.Values.Select(s=>new { module=s.Module,window=s.Id,mode=s.Mode,panelOpen=s.Visible(),webViewReady=s.Ready(),status=s.Status(),width=s.Editor.Width,height=s.Editor.Height }).ToArray() }));
            return result;
        }
        public void ClosePanel() { CloseModule("shapes"); }
        public void CloseModule(string module)
        {
            Run(()=> { long id=OfficeWindowIdentity.Active(application); Session s; if(sessions.TryGetValue(id+":"+module,out s)) { s.Editor.Hide(); if(s.Pane!=null)s.Pane.Visible=false; } });
        }
        private void RetireClosedWindows()
        {
            if(!connected || ToolboxRuntime.Busy) return;
            try {
                var open=new HashSet<long>(); dynamic windows=((dynamic)application).Windows;
                for(int i=1;i<=windows.Count;i++) open.Add(OfficeWindowIdentity.Get((object)windows.Item(i)));
                foreach(var pair in sessions.ToArray()) if(!open.Contains(pair.Value.Id)) { DisposeSession(pair.Value); sessions.Remove(pair.Key); }
                if(sessions.Count==0)lifecycle.Stop();
            } catch { }
        }
        private static void DisposeSession(Session s)
        {
            s.Editor.Dispose();
            if(s.Pane!=null) {try{s.Pane.Delete();}catch{} Release(s.Pane);}
            if(s.Container!=null && !s.Container.IsDisposed)s.Container.Dispose();
            s.Window=null;
        }
        private static void Release(object o) { if(o!=null && Marshal.IsComObject(o)) {try{Marshal.ReleaseComObject(o);}catch{}} }
        private void Shutdown()
        {
            connected=false; lifecycle.Stop();
            if(preloader!=null){preloader.Dispose();preloader=null;}
            foreach(var s in sessions.Values){try{DisposeSession(s);}catch{}}sessions.Clear();
        }
        public void OnDisconnection(ExtDisconnectMode mode,ref Array custom)
        {
            Shutdown(); try{if(addin!=null)((dynamic)addin).Object=null;}catch{}
            addin=null;application=null;Release(factory);factory=null;
            if(dispatcher!=null){dispatcher.Dispose();dispatcher=null;}
        }
        public void OnBeginShutdown(ref Array custom){Shutdown();}
        public void OnStartupComplete(ref Array custom){}
        public void OnAddInsUpdate(ref Array custom){}
        private sealed class OfficeWindow:IWin32Window { public OfficeWindow(IntPtr h){Handle=h;} public IntPtr Handle{get;private set;} }
    }
}
