using PangmenToolbox.AddIn;
using System;
using System.IO;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PangmenToolbox.Animations {
    internal sealed class AnimationWindow : Form {
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
        readonly object application;
        readonly long windowId;
        readonly Panel content = new Panel { Dock = DockStyle.Fill };
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        readonly string token = Guid.NewGuid().ToString("N");
        WebView2 browser;
        readonly PanelLoadingView loading = new PanelLoadingView();
        Runspace runspace;
        bool initializing, docked, ready, disposing, openingSized, pinned = true;
        string status = "created";
        public event Action<string> ModeRequested;
        public Func<bool> PaneVisible;
        public bool IsDocked { get { return docked; } }
        public bool IsWebViewReady { get { return ready; } }
        public bool IsPanelVisible { get { return docked ? PaneVisible != null && PaneVisible() : Visible; } }
        public string Status { get { return status; } }
        internal AnimationWindow(object app, long id) {
            application = app; windowId = id;
            Text = "旁门工具箱 · 动画库"; ClientSize = new System.Drawing.Size(1080, 820); MinimumSize = new System.Drawing.Size(760, 560);
            AutoScaleMode = AutoScaleMode.None;
            StartPosition = FormStartPosition.Manual; ShowInTaskbar = false;
            using (var stream = typeof(AnimationWindow).Assembly.GetManifestResourceStream("PangmenAnimation.Pang.ico")) if(stream != null) Icon = new System.Drawing.Icon(stream);
            BackColor = ToolboxTheme.Paper; content.BackColor = BackColor;
            Controls.Add(content); content.Controls.Add(loading);
            FormClosing += (sender, args) => { if(!disposing && args.CloseReason == CloseReason.UserClosing) { args.Cancel = true; Hide(); } };
        }
        internal void ShowFloating(IWin32Window owner) {
            docked = false; content.Parent = this; content.Dock = DockStyle.Fill;
            TopMost = pinned;
            if (!Visible) {
                if (!openingSized) {
                FloatingPanelLayout.Apply(this, owner == null ? IntPtr.Zero : owner.Handle);
                openingSized = true; }
                if(owner == null) Show(); else Show(owner);
            } else Activate();
            Initialize(); SetMode();
        }
        internal void AttachToPane(Control container) {
            Hide(); docked = true; TopMost = false; content.Parent = container; content.Dock = DockStyle.Fill;
            Initialize(); SetMode();
        }
        internal void HidePanel() { Hide(); }
        internal void SetPinned(bool enabled) { pinned = enabled; TopMost = pinned && !docked; }
        async void SetMode() {
            if(!ready || browser == null) return;
            try { await browser.ExecuteScriptAsync("globalThis.PangSurface?.set('" + (docked ? "sidebar" : "floating") + "')"); }
            catch(Exception ex) { HostDiagnostics.Log("Surface.Error", ex.Message); }
        }
        async void Initialize() {
            if(initializing || browser != null) return;
            initializing = true; status = "loading";
            try {
                DependencyResolver.EnsureNativeLoader();
                browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = ToolboxTheme.Paper }; content.Controls.Add(browser); loading.BringToFront();
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(HostDiagnostics.DataDirectory, "webview"));
                if(disposing) return;
                await browser.EnsureCoreWebView2Async(environment);
                EnsureRunspace();
                browser.CoreWebView2.SetVirtualHostNameToFolderMapping("pangmen.animation.local", Path.Combine(HostDiagnostics.InstallDirectory,"web","animations"), CoreWebView2HostResourceAccessKind.DenyCors);
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                browser.CoreWebView2.FrameNavigationStarting += (s,e) => e.Cancel = true;
                browser.CoreWebView2.PermissionRequested += (s,e) => { e.State = CoreWebView2PermissionState.Deny; e.Handled = true; };
                browser.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                browser.CoreWebView2.WebResourceRequested += (s,e) => {
                    var uri = e.Request.Uri;
                    if (!Trusted(uri) && !uri.StartsWith("data:") && !uri.StartsWith("blob:https://pangmen.animation.local/"))
                        e.Response = environment.CreateWebResourceResponse(null,403,"Blocked","Content-Type: text/plain");
                };
                browser.CoreWebView2.NewWindowRequested += (s,e) => e.Handled = true;
                browser.CoreWebView2.NavigationStarting += (s,e) => { if(!Trusted(e.Uri)) e.Cancel = true; };
                browser.CoreWebView2.WebMessageReceived += Message;
                browser.CoreWebView2.NavigationCompleted += async (s,e) => {
                    if(!e.IsSuccess){status="navigation-failed";loading.Text="加载失败，请重新打开面板。";return;}
                    try { await browser.ExecuteScriptAsync("globalThis.PangSurface?.set('"+(docked?"sidebar":"floating")+"');"+PanelLoadingView.ReadyScript); }
                    catch(Exception ex){loading.Text="加载失败，请重新打开面板。";HostDiagnostics.Log("Ready.Error",ex.Message);}
                };
                browser.Source = new Uri("https://pangmen.animation.local/index.html?embedded=1&surface=" + (docked ? "sidebar" : "floating") + "&v=" + ToolboxRuntime.Version);
            } catch(Exception ex) {
                status = "error"; HostDiagnostics.Log("WebView.Error", ex.ToString());
                loading.Text="动画库未能载入：\n"+ex.GetBaseException().Message;loading.Visible=true;loading.BringToFront();
            } finally { initializing = false; }
        }
        static bool Trusted(string source) {
            Uri uri; return Uri.TryCreate(source,UriKind.Absolute,out uri) && uri.Scheme == "https" && uri.Host == "pangmen.animation.local" && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo);
        }
        void EnsureRunspace() {
            if(runspace != null) return;
            // Validate the shipped scripts before allowing local script execution.
            ToolboxRuntime.VerifyAssets();
            try {
                var initial = InitialSessionState.CreateDefault();
                // PowerShell applies this to the current process, not HKCU/HKLM.
                // Group Policy still takes precedence; downloaded unsigned scripts
                // remain blocked. Do not disable the authorization manager.
                initial.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.RemoteSigned;
                runspace = RunspaceFactory.CreateRunspace(initial); runspace.ApartmentState = ApartmentState.STA;
                runspace.ThreadOptions = PSThreadOptions.UseCurrentThread; runspace.Open();
                runspace.SessionStateProxy.SetVariable("PangApplication", application);
                using(var ps = PowerShell.Create()) {
                    ps.Runspace = runspace;
                    ps.AddScript("param($path) . $path").AddArgument(Path.Combine(HostDiagnostics.InstallDirectory,"modules","animations","host","embedded-bridge.ps1"));
                    ps.Invoke();
                    if(ps.HadErrors) {
                        var error = ps.Streams.Error[0];
                        HostDiagnostics.Log("Animation.Startup",error.ToString());
                        if(error.CategoryInfo.Category == ErrorCategory.SecurityError)
                            throw new InvalidOperationException("当前安全策略阻止动画组件运行。若设备由单位管理，请联系管理员检查脚本策略；否则请使用官方安装包重新安装。");
                        throw new InvalidOperationException(error.ToString());
                    }
                }
            } catch { if(runspace != null)runspace.Dispose(); runspace = null; throw; }
        }
        void Message(object sender, CoreWebView2WebMessageReceivedEventArgs args) {
            if(!Trusted(args.Source) || disposing || args.WebMessageAsJson.Length > 2 * 1024 * 1024) return;
            if(PanelLoadingView.IsReadyMessage(args.WebMessageAsJson)){ready=true;status="ready";loading.Visible=false;browser.BringToFront();SetMode();return;}
            string id = "";
            try {
                var request = json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(args.WebMessageAsJson);
                id = Convert.ToString(request["id"]);
                var route = Convert.ToString(request["route"]);
                if(route == "bootstrap") { Reply(id,new { ok=true,session=token,version=ToolboxRuntime.Version,embedded=true,topmost=pinned }); return; }
                if(route == "topmost") {
                    if(Convert.ToString(request["session"]) != token) throw new InvalidOperationException("会话已变化，请重开动画库。");
                    var data = request.ContainsKey("data") ? request["data"] as System.Collections.Generic.Dictionary<string,object> : null;
                    bool enabled = data != null && data.ContainsKey("enabled") && Convert.ToBoolean(data["enabled"]);
                    SetPinned(enabled);
                    Reply(id,new { ok=true,topmost=pinned });
                    return;
                }
                if(route == "mode") {
                    if(Convert.ToString(request["session"]) != token) throw new InvalidOperationException("会话已变化，请重开动画库。");
                    var data = request.ContainsKey("data") ? request["data"] as System.Collections.Generic.Dictionary<string,object> : null;
                    string mode = data == null || !data.ContainsKey("mode") ? "" : Convert.ToString(data["mode"]);
                    if(mode != "floating" && mode != "sidebar") throw new InvalidOperationException("窗口形式无效。");
                    // The floating Form has no handle when first opened docked.
                    // Dispatch through the visible WebView and acknowledge after dispatch.
                    browser.BeginInvoke(new Action(() => {
                        if(disposing) return;
                        try {
                            if(OfficeWindowIdentity.Active(application) != windowId) throw new InvalidOperationException("请先切回此面板对应的 PPT 窗口。");
                            if(ModeRequested == null) throw new InvalidOperationException("面板暂时无法切换，请重开动画库。");
                            ModeRequested(mode);
                            Reply(id,new { ok=true,mode });
                        } catch(Exception ex) { HostDiagnostics.Log("Surface.Error",ex.ToString()); Reply(id,new { ok=false,error=ex.GetBaseException().Message }); }
                    }));
                    return;
                }
                if(route != "selection" && route != "apply" && route != "preview") throw new InvalidOperationException("请求不支持。");
                if(((dynamic)application).SlideShowWindows.Count > 0) { if(route!="selection")throw new InvalidOperationException("请退出放映后再操作动画。"); Reply(id,new { ok=true,count=0,signature="",previewing=true }); return; }
                if(OfficeWindowIdentity.Active(application) != windowId) {
                    if(route == "selection") { Reply(id,new { ok=true,count=0,signature="" }); return; }
                    throw new InvalidOperationException("请先切回此面板对应的 PPT 窗口。");
                }
                if((route == "apply" || route == "preview") && Convert.ToString(request["session"]) != token) throw new InvalidOperationException("会话已变化，请重开动画库。");
                EnsureRunspace();
                using(ToolboxRuntime.Enter(route))
                using(var ps = PowerShell.Create()) {
                    ps.Runspace = runspace; ps.AddCommand("Invoke-PangEmbedded").AddParameter("Route",route)
                        .AddParameter("Json",request.ContainsKey("data") && request["data"] != null ? json.Serialize(request["data"]) : "{}");
                    var result = ps.Invoke();
                    if(ps.HadErrors) throw new InvalidOperationException(ps.Streams.Error[0].ToString());
                    if(result.Count != 1) throw new InvalidOperationException("动画应用返回异常。");
                    Reply(id,json.DeserializeObject(Convert.ToString(result[0].BaseObject)));
                }
            } catch(Exception ex) { HostDiagnostics.Log("Bridge.Error",ex.ToString()); Reply(id,new { ok=false,error=ex.GetBaseException().Message }); }
        }
        void Reply(string id, object value) {
            if(!disposing && browser != null && browser.CoreWebView2 != null) browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { id, value }));
        }
        protected override void Dispose(bool value) {
            if(value) { disposing=true; if(browser!=null) browser.Dispose(); if(runspace!=null) runspace.Dispose(); content.Dispose(); }
            base.Dispose(value);
        }
    }
}
