using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

internal static class ActivationProbe
{
    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length != 4) { Console.Error.WriteLine("Expected: direct|com|pane DLL-path assembly-version report-path"); return 2; }
        string mode = args[0], dll = Path.GetFullPath(args[1]), reportPath = Path.GetFullPath(args[3]);
        string expectedIdentity = "PangmenToolbox.AddIn, Version=" + args[2];
        var events = new List<object>();
        object eventLock = new object();
        Action<object> add = item => { lock (eventLock) { if (events.Count < 160) events.Add(item); } };
        var report = new Dictionary<string, object> {
            { "mode", mode }, { "expectedFile", dll }, { "expectedIdentity", expectedIdentity }, { "passed", false },
            { "environment", DiagnosticData.EnvironmentInfo() }, { "registryBeforeActivation", DiagnosticData.RegistryInfo() },
            { "startedAt", DateTime.Now.ToString("O") }, { "step", "starting" }
        };
        // Observe unresolved binding requests without resolving or preloading anything.
        AppDomain.CurrentDomain.AssemblyResolve += (sender, request) => {
            add(new { kind = "unresolvedAssembly", name = request.Name, requestingAssembly = request.RequestingAssembly == null ? null : request.RequestingAssembly.FullName });
            return null;
        };
        AppDomain.CurrentDomain.AssemblyLoad += (sender, loaded) => {
            add(new { kind = "assemblyLoaded", identity = loaded.LoadedAssembly.FullName, location = SafeLocation(loaded.LoadedAssembly) });
        };
        AppDomain.CurrentDomain.FirstChanceException += (sender, raised) => {
            if (raised.Exception is FileNotFoundException || raised.Exception is FileLoadException || raised.Exception is BadImageFormatException)
                add(new { kind = "bindingException", type = raised.Exception.GetType().FullName, message = raised.Exception.Message, hresult = "0x" + raised.Exception.HResult.ToString("X8") });
        };
        object instance = null;
        Action<string> step = value => { report["step"] = value; DiagnosticData.Write(reportPath, report); };
        try
        {
            DiagnosticData.Write(reportPath, report);
            if (mode == "direct")
            {
                step("Assembly.LoadFrom");
                var assembly = Assembly.LoadFrom(dll);
                CheckAssembly(assembly, dll, expectedIdentity);
                step("Connect constructor");
                instance = Activator.CreateInstance(assembly.GetType("PangmenToolbox.AddIn.Connect", true));
                step("Managed dependencies and types");
                report["typeCount"] = assembly.GetTypes().Length;
                foreach (string name in new[] { "Microsoft.Web.WebView2.Core", "Microsoft.Web.WebView2.WinForms" })
                {
                    string path = Path.Combine(Path.GetDirectoryName(dll), name + ".dll");
                    var dependency = Assembly.LoadFrom(path);
                    dependency.GetTypes();
                    if (!String.Equals(Path.GetFullPath(dependency.Location), path, StringComparison.OrdinalIgnoreCase))
                        throw new FileLoadException("Dependency loaded from an unexpected directory.", dependency.Location);
                }
                step("WebView2Loader native load");
                string loader = Path.Combine(Path.GetDirectoryName(dll), "WebView2Loader.dll");
                IntPtr handle = LoadLibraryEx(loader, IntPtr.Zero, 0x00000100 | 0x00001000);
                if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot load native dependency: " + loader);
                FreeLibrary(handle);
            }
            else if (mode == "com" || mode == "pane")
            {
                step("COM activation");
                // This runs in a fresh process, outside the directory containing the add-in DLL.
                var type = Type.GetTypeFromCLSID(new Guid(mode == "pane" ? DiagnosticData.PaneClsid : DiagnosticData.AddInClsid), true);
                instance = Activator.CreateInstance(type);
                if (instance == null) throw new InvalidOperationException("COM returned no object.");
                step("Activated assembly identity and path");
                var loaded = AppDomain.CurrentDomain.GetAssemblies().SingleOrDefault(a => a.GetName().Name == "PangmenToolbox.AddIn");
                if (loaded == null) throw new InvalidOperationException("COM activation did not load the expected managed add-in.");
                CheckAssembly(loaded, dll, expectedIdentity);
                report["actualAssembly"] = new { identity = loaded.FullName, location = loaded.Location };
            }
            else throw new ArgumentException("Unknown probe mode: " + mode);
            report["passed"] = true;
            report["step"] = "complete";
            Console.WriteLine(mode + " passed.");
            return 0;
        }
        catch (Exception error)
        {
            report["error"] = DiagnosticData.Error(error);
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
        finally
        {
            try
            {
                var disposable = instance as IDisposable;
                if (disposable != null) disposable.Dispose();
                if (instance != null && Marshal.IsComObject(instance)) Marshal.FinalReleaseComObject(instance);
            }
            catch (Exception ex) { report["cleanupError"] = DiagnosticData.Error(ex); }
            lock (eventLock) report["bindingEvents"] = events.ToArray();
            report["loadedAssemblies"] = AppDomain.CurrentDomain.GetAssemblies().Select(a => new { identity = a.FullName, location = SafeLocation(a) }).ToArray();
            report["finishedAt"] = DateTime.Now.ToString("O");
            DiagnosticData.Write(reportPath, report);
        }
    }

    private static string SafeLocation(Assembly assembly) { try { return assembly.Location; } catch { return null; } }
    private static void CheckAssembly(Assembly assembly, string file, string identity)
    {
        if (!assembly.FullName.StartsWith(identity + ",", StringComparison.Ordinal) || assembly.GetName().GetPublicKeyToken().Length == 0 || !String.Equals(Path.GetFullPath(assembly.Location), file, StringComparison.OrdinalIgnoreCase))
            throw new FileLoadException("Expected " + identity + " at " + file + "; loaded " + assembly.FullName + " at " + assembly.Location, file);
    }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll")]
    private static extern bool FreeLibrary(IntPtr module);
}
