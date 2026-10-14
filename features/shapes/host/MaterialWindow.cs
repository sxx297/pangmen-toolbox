using PangmenToolbox.AddIn;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PangmenToolbox.Shapes
{
    internal sealed class MaterialWindow : Form
    {
        private const string LocalHost = "shape-effects.local";
        private const string StartUrl = "https://shape-effects.local/index.html?host=powerpoint";
        private const int MaxMessageLength = 32 * 1024 * 1024;
        private readonly WebView2 webView;
        private readonly Panel editorSurface;
        private readonly object application;
        private readonly long ownerIdentity;
        private bool initialized;
        private bool openingSized;
        private bool resourcesDisposed;
        public bool IsDocked { get; private set; }
        public Func<bool> PaneVisible;
        public bool IsPanelVisible { get { return !IsDisposed && (IsDocked ? PaneVisible != null && PaneVisible() : Visible); } }
        public event Action<string> ModeRequested;
        private readonly PanelLoadingView loading;
        private Icon brandIcon;
        private readonly PowerPointBridge bridge;
        private readonly Timer watch = new Timer { Interval = 400 };
        private readonly uint processId = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
        private bool pinned = true;
        private bool bridgeBusy;
        private string observedSelection;
        private string sentSelection;
        private string sentIdentity;
        private string sentMaterialState;
        private DateTime resumeWatch;
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MaxMessageLength, RecursionLimit = 64 };
        private readonly HashSet<string> messageTypes = new HashSet<string>(StringComparer.Ordinal)
            { "setPanelMode", "ping", "hostStatus", "status", "log", "setPinned", "selectionInfo", "captureSelection", "applyMaterial", "restoreMaterial" };

        public bool IsWebViewReady { get; private set; }
        public string Status { get; private set; } = "loading";

        internal MaterialWindow(object application, long ownerIdentity)
        {
            DependencyResolver.EnsureNativeLoader();
            this.application = application; this.ownerIdentity = ownerIdentity;
            Text = "旁门工具箱 · 形状效果";
            brandIcon = BrandAssets.LoadIcon();
            if (brandIcon != null) Icon = brandIcon;
            AutoScaleMode = AutoScaleMode.None;
            StartPosition = FormStartPosition.Manual;
            var workingArea = Screen.FromPoint(Cursor.Position).WorkingArea;
            Size = new Size(Math.Min(1080, workingArea.Width - 60), Math.Min(820, workingArea.Height - 60));
            MinimumSize = new Size(760, 560);
            Location = new Point(workingArea.Left + 16, workingArea.Top + 16);
            ShowInTaskbar = false;
            BackColor = ToolboxTheme.Paper;
            Font = new Font("Microsoft YaHei UI", 10f);
            bridge = new PowerPointBridge(application, Path.Combine(HostDiagnostics.DataDirectory, "cache"));
            webView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor, Visible = true };
            loading = new PanelLoadingView();
            editorSurface = new Panel { Dock = DockStyle.Fill, BackColor = BackColor };
            editorSurface.Controls.Add(webView);
            editorSurface.Controls.Add(loading);
            loading.BringToFront();
            editorSurface.SizeChanged += (sender, args) => FitEditorZoom();
            Controls.Add(editorSurface);
            Shown += (sender, args) => { if (!openingSized) { FitOpeningBounds(); openingSized = true; } StartEditor(); };
            ResizeEnd += (sender, args) => FitEditorZoom();
            SizeChanged += (sender, args) => FitEditorZoom();
            watch.Tick += (sender, args) => WatchPowerPoint();
            // Closing the floating shell hides it; the live editor survives mode changes.
            FormClosing += (sender, args) => { if (args.CloseReason == CloseReason.UserClosing) { args.Cancel = true; Hide(); } };
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !resourcesDisposed)
            {
                resourcesDisposed = true;
                watch.Stop(); watch.Dispose();
                bridge.ClearCache();
                IsWebViewReady = false; Status = "closed";
                if (editorSurface != null) editorSurface.Dispose();
                if (brandIcon != null) brandIcon.Dispose();
            }
            base.Dispose(disposing);
        }

        private async void StartEditor()
        {
            watch.Start(); UpdatePin();
            if (!initialized) { initialized = true; await InitializeWebViewAsync(); }
        }

        internal void AttachToPane(Control container)
        {
            Hide(); TopMost = false; IsDocked = true;
            container.Controls.Add(editorSurface);
            editorSurface.Show();
            StartEditor(); PublishMode();
        }

        internal void ShowFloating(IWin32Window owner)
        {
            IsDocked = false;
            Controls.Add(editorSurface);
            editorSurface.Show();
            if (!Visible) { if (owner != null) Show(owner); else Show(); }
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            StartEditor(); PublishMode(); Activate();
        }

        internal void HidePanel() { if (!IsDocked) Hide(); }

        private void PublishMode()
        {
            FitEditorZoom();
            PostMessage(new { type = "panel.mode", data = HostStatus() });
        }

        private bool IsOwnerActive()
        {
            try { return OfficeWindowIdentity.Active(application) == ownerIdentity; }
            catch { return false; }
        }

        private double DpiScale()
        {
            try { return Math.Max(1.0, GetDpiForWindow(Handle) / 96.0); }
            catch { return 1.0; }
        }

        private void FitOpeningBounds()
        {
            FloatingPanelLayout.Apply(this, Owner == null ? IntPtr.Zero : Owner.Handle);
            FitEditorZoom();
        }

        private void FitEditorZoom()
        {
            if (webView == null || webView.CoreWebView2 == null || editorSurface.ClientSize.Height <= 0) return;
            double availableHeight = editorSurface.ClientSize.Height / DpiScale();
            // Keep text legible, while giving a high-DPI laptop enough logical workspace.
            double zoom = IsDocked ? 1.0 : Math.Max(0.8, Math.Min(1.0, availableHeight / 850.0));
            if (Math.Abs(webView.ZoomFactor - zoom) > 0.005) webView.ZoomFactor = zoom;
        }

        private void UpdatePin()
        {
            uint foregroundProcess;
            GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcess);
            // Float above PowerPoint while it is active, without covering unrelated apps.
            bool value = !IsDocked && Visible && IsOwnerActive() && pinned && foregroundProcess == processId;
            if (TopMost != value) TopMost = value;
        }

        private void WatchPowerPoint()
        {
            if (IsDisposed) return;
            UpdatePin();
            if (!IsPanelVisible || !IsOwnerActive() || !IsWebViewReady || bridgeBusy || ToolboxRuntime.Busy || DateTime.UtcNow < resumeWatch) return;
            try
            {
                var selection = bridge.ObserveSelection();
                string signature = Convert.ToString(selection["signature"]);
                if (signature != observedSelection) { observedSelection = signature; return; }
                if (signature == sentSelection) return;
                string identity = selection.ContainsKey("identity") ? Convert.ToString(selection["identity"]) : null;
                string state = selection.ContainsKey("materialState") ? Convert.ToString(selection["materialState"]) : null;
                selection["materialChanged"] = identity != null && identity == sentIdentity && state != sentMaterialState;
                sentSelection = signature; sentIdentity = identity; sentMaterialState = state;
                PostMessage(new { type = "selection.changed", data = selection });
            }
            catch { /* Office may be temporarily busy or shutting down. Try on the next tick. */ }
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                var webDirectory = Path.Combine(HostDiagnostics.InstallDirectory, "web", "shapes");
                if (!File.Exists(Path.Combine(webDirectory, "index.html"))) throw new FileNotFoundException("安装文件不完整，未找到本地编辑器。请重新安装形状效果。", Path.Combine(webDirectory, "index.html"));
                string runtimeVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
                HostDiagnostics.Log("WebView2.Initialize", "Runtime=" + runtimeVersion);
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(HostDiagnostics.DataDirectory, "WebView2"));
                if (IsDisposed) return;
                await webView.EnsureCoreWebView2Async(environment);
                if (IsDisposed) return;
                var core = webView.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping(LocalHost, webDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsWebMessageEnabled = true;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsBuiltInErrorPageEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.NavigationStarting += (sender, args) =>
                {
                    if (!IsTrustedOrigin(args.Uri)) { args.Cancel = true; HostDiagnostics.Log("Navigation.Blocked", "External origin"); }
                };
                core.FrameNavigationStarting += (sender, args) => { args.Cancel = true; };
                core.NewWindowRequested += (sender, args) => { args.Handled = true; HostDiagnostics.Log("NewWindow.Blocked"); };
                core.PermissionRequested += (sender, args) => { args.State = CoreWebView2PermissionState.Deny; args.Handled = true; };
                core.ProcessFailed += (sender, args) => { ShowError("编辑器进程意外停止，请关闭面板后重新打开。", args.ProcessFailedKind.ToString()); };
                core.WebMessageReceived += OnWebMessageReceived;
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += (sender, args) =>
                {
                    var uri = args.Request.Uri;
                    if (IsTrustedOrigin(uri) || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("blob:https://" + LocalHost + "/", StringComparison.OrdinalIgnoreCase)) return;
                    args.Response = environment.CreateWebResourceResponse(null, 403, "External resources disabled", "Content-Type: text/plain");
                    HostDiagnostics.Log("Resource.Blocked", "External origin");
                };
                core.NavigationCompleted += async (sender, args) =>
                {
                    if (!args.IsSuccess) { ShowError("本地编辑器未能加载，请关闭面板后重试。", args.WebErrorStatus.ToString()); return; }
                    if (!IsTrustedOrigin(core.Source)) return;
                    IsWebViewReady = true;
                    Status = "ready";
                    loading.BringToFront();
                    HostDiagnostics.Log("WebView2.Ready", "Local editor loaded");
                    PostMessage(new { type = "host.ready", data = HostStatus() });
                    try { await webView.ExecuteScriptAsync(PanelLoadingView.ReadyScript); }
                    catch(Exception ex) { ShowError("加载失败，请重新打开面板。",ex.Message); }
                };
                FitEditorZoom();
                core.Navigate(StartUrl);
            }
            catch (WebView2RuntimeNotFoundException ex)
            {
                ShowError("未找到 Microsoft Edge WebView2 Runtime。请安装 WebView2 Evergreen Runtime 后重新打开 PowerPoint。", HostDiagnostics.Describe(ex));
            }
            catch (Exception ex) { ShowError("无法启动编辑器：" + ex.GetBaseException().Message, HostDiagnostics.Describe(ex)); }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (!IsTrustedOrigin(args.Source)) { HostDiagnostics.Log("Message.Blocked", "Untrusted origin"); return; }
            if(PanelLoadingView.IsReadyMessage(args.WebMessageAsJson)){loading.Visible=false;webView.BringToFront();return;}
            string id = null;
            try
            {
                string raw = args.WebMessageAsJson;
                if (raw == null || raw.Length > MaxMessageLength) throw new InvalidOperationException("消息过大，请降低导出分辨率后重试。");
                var message = json.DeserializeObject(raw) as IDictionary<string, object>;
                if (message == null) throw new InvalidOperationException("无效的插件消息格式。");
                object value;
                if (!message.TryGetValue("id", out value) || !(value is string) || ((string)value).Length == 0 || ((string)value).Length > 128) throw new InvalidOperationException("插件消息缺少有效的请求编号。");
                id = (string)value;
                if (!message.TryGetValue("type", out value) || !(value is string) || !messageTypes.Contains((string)value)) throw new InvalidOperationException("不支持此插件操作。");
                string type = (string)value;
                IDictionary<string, object> payload = new Dictionary<string, object>();
                if (message.TryGetValue("payload", out value) && value != null)
                {
                    payload = value as IDictionary<string, object>;
                    if (payload == null) throw new InvalidOperationException("插件请求参数必须是对象。");
                }
                object data;
                if (type == "hostStatus" || type == "ping") data = HostStatus();
                else if (type == "setPanelMode")
                {
                    string mode = payload.TryGetValue("mode", out value) ? value as string : null;
                    if (mode != "docked" && mode != "floating") throw new InvalidOperationException("面板模式无效。");
                    if (!IsOwnerActive()) throw new InvalidOperationException("请先返回此面板对应的 PowerPoint 窗口。");
                    // Leave this callback before Office reparents the live WebView.
                    BeginInvoke(new Action(() => ModeRequested?.Invoke(mode)));
                    data = new { requested = mode };
                }
                else if (type == "setPinned")
                {
                    if (!payload.TryGetValue("enabled", out value) || !(value is bool)) throw new InvalidOperationException("置顶参数无效。");
                    pinned = (bool)value; UpdatePin(); data = new { pinned };
                }
                else if (type == "log")
                {
                    string text = payload.TryGetValue("message", out value) && value is string ? (string)value : "Editor log";
                    HostDiagnostics.Log("Editor", text.Length > 2000 ? text.Substring(0, 2000) : text);
                    data = new { logged = true };
                }
                else
                {
                    HostDiagnostics.Log("Bridge." + type + ".Begin");
                    bridgeBusy = true;
                    try
                    {
                        if (!IsOwnerActive()) throw new InvalidOperationException("WINDOW_CHANGED: 请返回此面板对应的 PowerPoint 窗口再操作。");
                        using (ToolboxRuntime.Enter(type)) { data = bridge.Handle(type, payload); }
                        var selection = bridge.ObserveSelection();
                        sentSelection = observedSelection = Convert.ToString(selection["signature"]);
                        sentIdentity = selection.ContainsKey("identity") ? Convert.ToString(selection["identity"]) : null;
                        sentMaterialState = selection.ContainsKey("materialState") ? Convert.ToString(selection["materialState"]) : null;
                    }
                    finally { bridgeBusy = false; resumeWatch = DateTime.UtcNow.AddMilliseconds(500); }
                    HostDiagnostics.Log("Bridge." + type + ".Complete");
                }
                PostMessage(new { id, type = "response", ok = true, data });
            }
            catch (Exception ex)
            {
                var error = ex.GetBaseException();
                HostDiagnostics.Log("Bridge.Error", HostDiagnostics.Describe(error));
                string code = error.Data.Contains("code") ? Convert.ToString(error.Data["code"]) : "HOST_ERROR";
                // Bridge validation errors include a short uppercase error prefix.
                int colon = error.Message.IndexOf(':');
                if (colon > 0 && colon < 40)
                {
                    string prefix = error.Message.Substring(0, colon);
                    bool valid = true;
                    foreach (char character in prefix) if (!(character >= 'A' && character <= 'Z') && character != '_') valid = false;
                    if (valid) code = prefix;
                }
                PostMessage(new { id, type = "response", ok = false, error = new { code, message = error.Message } });
            }
        }

        private object HostStatus() { return new { version = HostDiagnostics.Version, platform = "PowerPoint Windows", ready = true, protocol = 1, connected = true, autoSelection = true, quickSelection = true, reusableCapture = true, pinned, panelMode = IsDocked ? "docked" : "floating", canSwitchPanel = true, selection = bridge.ObserveSelection() }; }

        private static bool IsTrustedOrigin(string url)
        {
            Uri uri;
            return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps && string.Equals(uri.Host, LocalHost, StringComparison.OrdinalIgnoreCase) && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo);
        }

        private void PostMessage(object message)
        {
            if (IsDisposed || webView.CoreWebView2 == null) return;
            try { webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(message)); }
            catch (Exception ex) { HostDiagnostics.Log("Message.SendError", HostDiagnostics.Describe(ex)); }
        }

        private void ShowError(string message, string diagnostic)
        {
            if (IsDisposed) return;
            IsWebViewReady = false;
            Status = "error";
            HostDiagnostics.Log("WebView2.Error", diagnostic);
            loading.Text = message + "\n\n诊断日志：" + Path.Combine(HostDiagnostics.DataDirectory, "logs");
            loading.Visible = true;
            loading.BringToFront();
            webView.Visible = false;
        }
    }
}
