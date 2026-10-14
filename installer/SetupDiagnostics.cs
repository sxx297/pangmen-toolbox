using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

// Shared framework-only diagnostics. Never preload the add-in here.
internal static class DiagnosticData
{
    internal const string AddInClsid = "{84237C4B-02BA-43B6-9B35-E364A9EC6ACB}";
    internal const string PaneClsid = "{483F84C1-E902-4971-856F-A11A44EBEF97}";
    internal static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024, RecursionLimit = 100 }; }
    internal static void Write(string path, object value)
    {
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, Serializer().Serialize(value), new UTF8Encoding(false));
        if (File.Exists(path)) File.Delete(path);
        File.Move(temporary, path);
    }
    internal static object Error(Exception error)
    {
        var missing = error as FileNotFoundException;
        var load = error as FileLoadException;
        var types = error as ReflectionTypeLoadException;
        var native = error as System.ComponentModel.Win32Exception;
        string fusion = null;
        try { fusion = missing != null ? missing.FusionLog : load != null ? load.FusionLog : null; } catch { }
        return new {
            type = error.GetType().FullName, hresult = "0x" + error.HResult.ToString("X8"), message = error.Message,
            fileName = missing != null ? missing.FileName : load != null ? load.FileName : null,
            fusionLog = fusion, nativeErrorCode = native == null ? (int?)null : native.NativeErrorCode, fullException = error.ToString(),
            inner = error.InnerException == null ? null : Error(error.InnerException),
            loaderExceptions = types == null ? null : types.LoaderExceptions.Where(e => e != null).Select(Error).ToArray()
        };
    }
    internal static object EnvironmentInfo()
    {
        var result = new Dictionary<string, object> {
            { "windowsVersion", Environment.OSVersion.VersionString }, { "windows64Bit", Environment.Is64BitOperatingSystem },
            { "process64Bit", Environment.Is64BitProcess }, { "processId", Process.GetCurrentProcess().Id },
            { "clrVersion", Environment.Version.ToString() }, { "appBase", AppDomain.CurrentDomain.BaseDirectory },
            { "workingDirectory", Environment.CurrentDirectory }
        };
        try
        {
            using (var identity = WindowsIdentity.GetCurrent())
            {
                result["user"] = identity.Name;
                result["userSid"] = identity.User == null ? null : identity.User.Value;
                result["administratorToken"] = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                int elevated, returned;
                result["elevated"] = GetTokenInformation(identity.Token, 20, out elevated, sizeof(int), out returned) ? (object)(elevated != 0) : null;
            }
        }
        catch (Exception ex) { result["identityError"] = Error(ex); }
        try
        {
            using (var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, Environment.Is64BitOperatingSystem ? RegistryView.Registry64 : RegistryView.Registry32))
            {
                using (var policies = machine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"))
                {
                    result["enableLUA"] = policies == null ? null : policies.GetValue("EnableLUA");
                    result["filterAdministratorToken"] = policies == null ? null : policies.GetValue("FilterAdministratorToken");
                }
                using (var framework = machine.OpenSubKey(@"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full"))
                    result["frameworkRelease"] = framework == null ? null : framework.GetValue("Release");
            }
        }
        catch (Exception ex) { result["registryError"] = Error(ex); }
        var runtimes = new List<object>();
        foreach (RegistryView view in Views()) foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        {
            try
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view))
                using (var clients = root.OpenSubKey(@"SOFTWARE\Microsoft\EdgeUpdate\Clients"))
                    if (clients != null) foreach (string id in clients.GetSubKeyNames()) using (var client = clients.OpenSubKey(id))
                        if (Convert.ToString(client.GetValue("name", "")).IndexOf("WebView2", StringComparison.OrdinalIgnoreCase) >= 0)
                            runtimes.Add(new { hive = hive.ToString(), view = view.ToString(), version = client.GetValue("pv") });
            }
            catch (Exception ex) { runtimes.Add(new { hive = hive.ToString(), view = view.ToString(), error = Error(ex) }); }
        }
        result["webView2Runtimes"] = runtimes;
        return result;
    }
    internal static IEnumerable<RegistryView> Views()
    {
        yield return RegistryView.Registry32;
        if (Environment.Is64BitOperatingSystem) yield return RegistryView.Registry64;
    }
    internal static bool IsElevated()
    {
        using (var identity = WindowsIdentity.GetCurrent())
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }
    internal static string UserSid()
    {
        using (var identity = WindowsIdentity.GetCurrent()) return identity.User.Value;
    }
    internal static IEnumerable<string> ComPaths { get { return OwnedPaths.Where(p => p.StartsWith(@"Software\Classes\", StringComparison.Ordinal)); } }
    internal static readonly string[] OwnedPaths = {
        @"Software\Classes\CLSID\" + AddInClsid, @"Software\Classes\CLSID\" + PaneClsid,
        @"Software\Classes\PangmenToolbox.AddIn", @"Software\Classes\PangmenToolbox.TaskPane",
        @"Software\Microsoft\Office\PowerPoint\Addins\PangmenToolbox.AddIn",
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PangmenToolbox.AddIn"
    };
    internal static object RegistryInfo()
    {
        var records = new List<object>();
        foreach (RegistryView view in Views())
            foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine, RegistryHive.ClassesRoot })
                foreach (string owned in OwnedPaths)
                {
                    if (hive == RegistryHive.ClassesRoot && !owned.StartsWith(@"Software\Classes\", StringComparison.Ordinal)) continue;
                    string path = hive == RegistryHive.ClassesRoot ? owned.Substring(@"Software\Classes\".Length) : owned;
                    try
                    {
                        using (var root = RegistryKey.OpenBaseKey(hive, view))
                        using (var key = root.OpenSubKey(path))
                            records.Add(new { hive = hive.ToString(), view = view.ToString(), path = path, tree = RegistryTree.Read(key) });
                    }
                    catch (Exception ex) { records.Add(new { hive = hive.ToString(), view = view.ToString(), path = path, error = Error(ex) }); }
                }
        return records;
    }
    internal static string Hash(string path)
    {
        using (var stream = File.OpenRead(path)) using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    internal static object FileInfo(string path)
    {
        var result = new Dictionary<string, object> { { "path", path }, { "exists", File.Exists(path) } };
        if (!File.Exists(path)) return result;
        try
        {
            result["bytes"] = new System.IO.FileInfo(path).Length;
            result["sha256"] = Hash(path);
            if (path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                using (var stream = File.OpenRead(path)) using (var reader = new BinaryReader(stream))
                {
                    if (reader.ReadUInt16() != 0x5A4D) throw new BadImageFormatException("Missing MZ signature", path);
                    stream.Position = 0x3c;
                    int offset = reader.ReadInt32();
                    if (offset < 0x40 || offset > stream.Length - 6) throw new BadImageFormatException("Invalid PE offset", path);
                    stream.Position = offset;
                    if (reader.ReadUInt32() != 0x4550) throw new BadImageFormatException("Missing PE signature", path);
                    result["peMachine"] = "0x" + reader.ReadUInt16().ToString("X4");
                }
                // Metadata only; Assembly.LoadFrom belongs exclusively in the direct probe.
                try { result["assemblyIdentity"] = AssemblyName.GetAssemblyName(path).FullName; }
                catch (BadImageFormatException) { result["managed"] = false; }
            }
        }
        catch (Exception ex) { result["error"] = Error(ex); }
        return result;
    }
    internal static object Files(string directory)
    {
        if (String.IsNullOrEmpty(directory)) return null;
        return new[] { "PangmenToolbox.AddIn.dll", "ActivationProbe.exe", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "web/shapes/index.html", "web/animations/index.html", "PangmenToolbox.Motion.dll", "build-manifest.json" }
            .Select(name => FileInfo(Path.Combine(directory, name))).ToArray();
    }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int informationClass, out int information, int length, out int returned);
}

// Preserve value kinds, empty keys and both views; rollback is not re-registration.
internal sealed class RegistryTree
{
    public Dictionary<string, RegistryValue> Values = new Dictionary<string, RegistryValue>();
    public Dictionary<string, RegistryTree> Children = new Dictionary<string, RegistryTree>();
    public sealed class RegistryValue
    {
        public RegistryValueKind Kind;
        public object Data;
        public string CodeBaseLocalPath;
        public bool? CodeBaseFileExists;
        public string ExpectedComCodeBase;
        public bool? CodeBaseMatchesAssembly;
    }
    internal static RegistryTree Read(RegistryKey key)
    {
        if (key == null) return null;
        var tree = new RegistryTree();
        foreach (string name in key.GetValueNames())
        {
            var value = new RegistryValue { Kind = key.GetValueKind(name), Data = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) };
            Uri uri;
            if (name.Equals("CodeBase", StringComparison.OrdinalIgnoreCase) && Uri.TryCreate(Convert.ToString(value.Data), UriKind.Absolute, out uri) && uri.IsFile)
            {
                value.CodeBaseLocalPath = uri.LocalPath;
                value.CodeBaseFileExists = File.Exists(uri.LocalPath);
                // URI decoding alone can report "exists" for an escaped CodeBase
                // that the CLR COM binder does not resolve. Record RegAsm's format too.
                if (value.CodeBaseFileExists == true)
                    try {
                        value.ExpectedComCodeBase = AssemblyName.GetAssemblyName(uri.LocalPath).CodeBase;
                        value.CodeBaseMatchesAssembly = String.Equals(Convert.ToString(value.Data), value.ExpectedComCodeBase, StringComparison.OrdinalIgnoreCase);
                    } catch { /* Non-managed or unreadable paths remain diagnostic evidence. */ }
            }
            tree.Values[name] = value;
        }
        foreach (string name in key.GetSubKeyNames()) using (var child = key.OpenSubKey(name)) tree.Children[name] = Read(child);
        return tree;
    }
    internal void Restore(RegistryKey key)
    {
        foreach (var pair in Values) key.SetValue(pair.Key, pair.Value.Data, pair.Value.Kind);
        foreach (var pair in Children) using (var child = key.CreateSubKey(pair.Key)) pair.Value.Restore(child);
    }
}

internal sealed class RegistrationBackup
{
    private sealed class Entry { internal RegistryHive Hive; internal RegistryView View; internal string Path; internal RegistryTree Tree; }
    private readonly List<Entry> entries = new List<Entry>();
    internal RegistrationBackup(IEnumerable<string> paths = null)
    {
        foreach (var view in DiagnosticData.Views()) using (var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
            foreach (string path in paths ?? DiagnosticData.OwnedPaths) using (var key = user.OpenSubKey(path))
                entries.Add(new Entry { Hive = RegistryHive.CurrentUser, View = view, Path = path, Tree = RegistryTree.Read(key) });
    }
    internal void IncludeMachineClasses()
    {
        foreach (var view in DiagnosticData.Views()) using (var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
            foreach (string path in DiagnosticData.ComPaths) using (var key = machine.OpenSubKey(path))
                entries.Add(new Entry { Hive = RegistryHive.LocalMachine, View = view, Path = path, Tree = RegistryTree.Read(key) });
    }
    internal void Restore()
    {
        var errors = new List<Exception>();
        foreach (var entry in entries)
        {
            try
            {
                using (var user = RegistryKey.OpenBaseKey(entry.Hive, entry.View))
                {
                    user.DeleteSubKeyTree(entry.Path, false);
                    if (entry.Tree != null) using (var key = user.CreateSubKey(entry.Path)) entry.Tree.Restore(key);
                }
            }
            catch (Exception ex) { errors.Add(ex); }
        }
        if (errors.Count != 0) throw new AggregateException("One or more registry entries could not be restored.", errors);
    }
}

internal sealed class DiagnosticSession
{
    internal readonly string DirectoryPath;
    internal string PayloadDirectory = null;
    internal string ArchivePath;
    private int sequence;
    internal DiagnosticSession(string root, string version, string operation)
    {
        DirectoryPath = Path.Combine(root, "diagnostics", "PangmenToolbox-" + version + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(DirectoryPath);
        DiagnosticData.Write(Path.Combine(DirectoryPath, "session.json"), new {
            version = version, operation = operation, createdAt = DateTime.Now.ToString("O"), environment = DiagnosticData.EnvironmentInfo(),
            scope = "Installer files, plugin registration and component loading only. No presentation content."
        });
    }
    internal void Capture(string stage, Exception error = null)
    {
        DiagnosticData.Write(Path.Combine(DirectoryPath, (++sequence).ToString("D2") + "-" + stage + ".json"), new {
            stage = stage, at = DateTime.Now.ToString("O"), directory = PayloadDirectory,
            registry = DiagnosticData.RegistryInfo(), files = DiagnosticData.Files(PayloadDirectory), error = error == null ? null : DiagnosticData.Error(error)
        });
    }
    internal void Export()
    {
        ArchivePath = DirectoryPath + ".zip";
        using (var output = new FileStream(ArchivePath, FileMode.Create, FileAccess.Write))
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create))
            foreach (string path in Directory.GetFiles(DirectoryPath, "*", SearchOption.AllDirectories))
            {
                string extension = Path.GetExtension(path);
                if (extension != ".json" && extension != ".log" && extension != ".txt") continue;
                var entry = zip.CreateEntry(path.Substring(DirectoryPath.Length + 1).Replace('\\', '/'), CompressionLevel.Optimal);
                using (var source = File.OpenRead(path)) using (var target = entry.Open()) source.CopyTo(target);
            }
    }
}
