using PangmenToolbox.AddIn;
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace PangmenToolbox.Shapes
{
    internal static class HostDiagnostics
    {
        internal const string Version = PangmenToolbox.AddIn.ToolboxRuntime.Version;
        internal static readonly string DataDirectory = Path.Combine(ToolboxRuntime.DataDirectory, "shapes");
        internal static readonly string InstallDirectory = Path.GetDirectoryName(typeof(HostDiagnostics).Assembly.Location);
        private static readonly object Gate = new object();
        internal static IDisposable Measure(string operation) { return new Timing(operation); }
        private sealed class Timing : IDisposable
        {
            private readonly string operation;
            private readonly System.Diagnostics.Stopwatch watch = System.Diagnostics.Stopwatch.StartNew();
            internal Timing(string operation) { this.operation = operation; }
            public void Dispose() { watch.Stop(); Log(operation, "elapsed_ms=" + watch.ElapsedMilliseconds); }
        }

        internal static void Log(string operation, string detail = null)
        {
            try
            {
                var directory = Path.Combine(DataDirectory, "logs");
                Directory.CreateDirectory(directory);
                var path = Path.Combine(directory, "addin-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
                var line = DateTime.Now.ToString("O") + " [" + System.Diagnostics.Process.GetCurrentProcess().Id + ":" + System.Threading.Thread.CurrentThread.ManagedThreadId + "] " + operation;
                if (!string.IsNullOrWhiteSpace(detail)) line += " | " + detail.Replace('\r', ' ').Replace('\n', ' ');
                lock (Gate) File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8);
            }
            catch { /* Logging must never prevent PowerPoint from loading or exiting. */ }
        }

        internal static string Describe(Exception exception)
        {
            var error = exception.GetBaseException();
            return error.GetType().Name + " (0x" + error.HResult.ToString("X8") + "): " + error.Message;
        }
    }

    internal static class DependencyResolver
    {
        private static bool registered;
        private static IntPtr loader;

        internal static void Initialize()
        {
            if (registered) return;
            registered = true;
            AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        }

        internal static void EnsureNativeLoader()
        {
            Initialize();
            if (loader != IntPtr.Zero) return;
            // Preload from the add-in's private directory without changing
            // PowerPoint's process-wide DLL search path.
            var loaderPath = Path.Combine(HostDiagnostics.InstallDirectory, "WebView2Loader.dll");
            if (File.Exists(loaderPath))
            {
                loader = LoadLibraryEx(loaderPath, IntPtr.Zero, 0x00000100 | 0x00001000);
                HostDiagnostics.Log("WebView2Loader", loader == IntPtr.Zero ? "Load failed: " + Marshal.GetLastWin32Error() : "Private loader loaded");
            }
        }

        private static Assembly Resolve(object sender, ResolveEventArgs args)
        {
            var name = new AssemblyName(args.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
            var path = Path.Combine(HostDiagnostics.InstallDirectory, name + ".dll");
            if (!File.Exists(path)) return null;
            HostDiagnostics.Log("AssemblyResolve", name);
            return Assembly.LoadFrom(path);
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr LoadLibraryEx(string fileName, IntPtr file, uint flags);
    }
}
