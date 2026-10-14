using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyVersion("1.0.11.0")]
[assembly: AssemblyFileVersion("1.0.11.0")]

internal static class Setup
{
    private const string Product = "PangmenToolbox";
    private const string Version = "1.0.11";
    private const string ProgId = "PangmenToolbox.AddIn";
    private const string PaneProgId = "PangmenToolbox.TaskPane";
    private const string PaneClsid = "{483F84C1-E902-4971-856F-A11A44EBEF97}";
    private const string Clsid = "{84237C4B-02BA-43B6-9B35-E364A9EC6ACB}";
    private static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product);
    private static readonly string Marker = Path.Combine(Root, "installation.json");
    // Elevated COM clients cannot rely on HKCU classes. Keep their code in an
    // administrator-writable location; preferences and Office discovery stay per-user.
    private static readonly string MachineRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), "Pangmen", Product, DiagnosticData.UserSid());
    private static bool MachineCom;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    private static bool Quiet;
    private static string CompletionDetail = "";
    private static DiagnosticSession Diagnostics;

    private enum OfficeArchitecture { X86, X64 }

    private sealed class OfficeInstallation
    {
        internal string Path;
        internal OfficeArchitecture Architecture;
        internal string FileVersion;
        internal string Source;
        internal RegistryView RegistryView { get { return Architecture == OfficeArchitecture.X86 ? RegistryView.Registry32 : RegistryView.Registry64; } }
        internal string Label { get { return Architecture == OfficeArchitecture.X86 ? "32 位" : "64 位"; } }
        internal string Key { get { return Architecture == OfficeArchitecture.X86 ? "x86" : "x64"; } }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Quiet = Array.Exists(args, a => a.Equals("/quiet", StringComparison.OrdinalIgnoreCase));
        bool uninstall = Array.Exists(args, a => a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase));
        bool repair = Array.Exists(args, a => a.Equals("/repair", StringComparison.OrdinalIgnoreCase));
        bool verify = Array.Exists(args, a => a.Equals("/verify", StringComparison.OrdinalIgnoreCase));
        bool diagnose = Array.Exists(args, a => a.Equals("/diagnose", StringComparison.OrdinalIgnoreCase));
        Application.EnableVisualStyles();
        try
        {
            if (diagnose || verify)
            {
                Diagnostics = new DiagnosticSession(Root, Version, diagnose ? "diagnose" : "verify");
                if (diagnose) Diagnose(); else { Verify(null); Diagnostics.Capture("verified"); Diagnostics.Export(); }
                return 0;
            }
            if (!Quiet)
            {
                string question = uninstall
                    ? "卸载旁门工具箱？个人预设和诊断记录将保留。"
                    : repair ? "修复旁门工具箱的启动注册？\n\n安装程序会重新检测 PowerPoint 位数并验证 COM 组件。请先保存并关闭所有 PowerPoint 窗口。"
                    : "安装旁门工具箱 " + Version + "？\n\n安装程序会自动识别 32/64 位 PowerPoint 并安装匹配组件。" +
                      (DiagnosticData.IsElevated() ? "当前为管理员环境，将在系统目录安装并注册本插件的 COM 组件；PowerPoint 入口和个人预设仍仅属于当前用户。" : "为当前 Windows 用户安装，不需要管理员权限。") + "\n\n" + Root;
                if (MessageBox.Show(question, "旁门工具箱", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return 2;
            }
            Diagnostics = new DiagnosticSession(Root, Version, uninstall ? "uninstall" : repair ? "repair" : "install");
            Diagnostics.Capture("before-operation");
            if (uninstall) Uninstall(); else if (repair) Repair(); else Install();
            Diagnostics.Capture("completed");
            Diagnostics.Export();
            if (!Quiet)
            {
                string message = uninstall ? "旁门工具箱已卸载。" :
                    (repair ? "已恢复启动注册并通过组件验证。" : "安装完成并通过组件验证。") +
                    "\n\n" + CompletionDetail + "\n请重新打开 PowerPoint，在“旁门工具箱”选项卡打开面板。";
                MessageBox.Show(message, "旁门工具箱", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return 0;
        }
        catch (Exception error)
        {
            string diagnosticPath = Path.Combine(Root, "setup-error.log");
            try
            {
                Directory.CreateDirectory(Root);
                File.WriteAllText(diagnosticPath, DateTime.Now.ToString("O") + Environment.NewLine + error, Encoding.UTF8);
                if (Diagnostics != null)
                {
                    CaptureFailure("operation-failed", error);
                    File.Copy(diagnosticPath, Path.Combine(Diagnostics.DirectoryPath, "setup-error.log"), true);
                    Diagnostics.Export();
                    diagnosticPath = Diagnostics.ArchivePath;
                    File.AppendAllText(Path.Combine(Root, "setup-error.log"), "\nDiagnostic archive: " + diagnosticPath, Encoding.UTF8);
                }
            }
            catch (Exception loggingError) { diagnosticPath += "\n诊断导出未完成：" + loggingError.Message; }
            if (!Quiet) MessageBox.Show(error.Message + "\n\n请将以下诊断文件发给开发者：\n" + diagnosticPath, "安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static OfficeInstallation Prerequisites()
    {
        RegistryView frameworkView = Environment.Is64BitOperatingSystem ? RegistryView.Registry64 : RegistryView.Registry32;
        using (var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, frameworkView))
        using (var framework = machine.OpenSubKey(@"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full"))
            if (framework == null || Convert.ToInt32(framework.GetValue("Release", 0)) < 528040)
                throw new InvalidOperationException("请先安装 Microsoft .NET Framework 4.8 或更新版本。");

        OfficeInstallation office = FindPowerPoint();
        if (!HasWebView2()) throw new InvalidOperationException("未检测到 Microsoft Edge WebView2 Runtime。请从微软官网下载并安装 Evergreen Runtime 后重试。");
        return office;
    }

    private static bool HasWebView2()
    {
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            foreach (RegistryView view in AvailableViews())
                using (var key = RegistryKey.OpenBaseKey(hive, view))
                using (var clients = key.OpenSubKey(@"SOFTWARE\Microsoft\EdgeUpdate\Clients"))
                    if (clients != null)
                        foreach (string child in clients.GetSubKeyNames())
                            using (var client = clients.OpenSubKey(child))
                                if (Convert.ToString(client.GetValue("name", "")).IndexOf("WebView2", StringComparison.OrdinalIgnoreCase) >= 0 &&
                                    !String.IsNullOrWhiteSpace(Convert.ToString(client.GetValue("pv", "")))) return true;
        return false;
    }

    private static OfficeInstallation FindPowerPoint()
    {
        var candidates = new List<Tuple<string, string>>();
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            foreach (RegistryView view in AvailableViews())
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view))
                {
                    AddRegistryCandidate(candidates, root, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\POWERPNT.EXE", "", "App Paths " + hive + " " + view, false);
                    foreach (string officeVersion in new[] { "16.0", "15.0", "14.0" })
                        AddRegistryCandidate(candidates, root, @"SOFTWARE\Microsoft\Office\" + officeVersion + @"\PowerPoint\InstallRoot", "Path", "Office InstallRoot " + officeVersion + " " + view, true);
                    using (var click = root.OpenSubKey(@"SOFTWARE\Microsoft\Office\ClickToRun\Configuration"))
                    {
                        string path = click == null ? "" : Convert.ToString(click.GetValue("InstallationPath", ""));
                        if (!String.IsNullOrWhiteSpace(path)) AddCandidate(candidates, Path.Combine(path, "root", "Office16", "POWERPNT.EXE"), "ClickToRun " + view);
                    }
                }
            }

        foreach (string baseDirectory in new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }.Where(p => !String.IsNullOrWhiteSpace(p)).Distinct(StringComparer.OrdinalIgnoreCase))
            foreach (string relative in new[] { @"Microsoft Office\root\Office16\POWERPNT.EXE", @"Microsoft Office\Office16\POWERPNT.EXE", @"Microsoft Office\Office15\POWERPNT.EXE", @"Microsoft Office\Office14\POWERPNT.EXE" })
                AddCandidate(candidates, Path.Combine(baseDirectory, relative), "standard path");

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in candidates)
        {
            string path;
            try { path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(candidate.Item1.Trim('"'))); }
            catch { continue; }
            if (!seen.Add(path) || !File.Exists(path)) continue;
            ushort machine = ReadPeMachine(path);
            if (machine == 0xAA64) throw new InvalidOperationException("检测到 ARM64 PowerPoint，当前版本尚未提供 ARM64 插件。请勿继续安装 x86/x64 组件。");
            if (machine != 0x014c && machine != 0x8664) continue;
            return new OfficeInstallation {
                Path = path,
                Architecture = machine == 0x014c ? OfficeArchitecture.X86 : OfficeArchitecture.X64,
                FileVersion = FileVersionInfo.GetVersionInfo(path).FileVersion ?? "unknown",
                Source = candidate.Item2
            };
        }
        throw new InvalidOperationException("未能定位桌面版 POWERPNT.EXE，无法安全判断 Office 位数。请确认已安装桌面版 PowerPoint；Microsoft Store 或企业定制安装请将诊断文件交给开发者。");
    }

    private static void AddRegistryCandidate(List<Tuple<string, string>> candidates, RegistryKey root, string keyPath, string valueName, string source, bool directory)
    {
        using (var key = root.OpenSubKey(keyPath))
        {
            string value = key == null ? "" : Convert.ToString(key.GetValue(valueName, ""));
            if (!String.IsNullOrWhiteSpace(value)) AddCandidate(candidates, directory ? Path.Combine(value, "POWERPNT.EXE") : value, source);
        }
    }

    private static void AddCandidate(List<Tuple<string, string>> candidates, string path, string source)
    {
        if (!String.IsNullOrWhiteSpace(path)) candidates.Add(Tuple.Create(path, source));
    }

    private static ushort ReadPeMachine(string path)
    {
        using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var reader = new BinaryReader(input))
        {
            if (reader.ReadUInt16() != 0x5A4D) throw new InvalidOperationException("PowerPoint 程序格式无效：" + path);
            input.Position = 0x3C;
            int peOffset = reader.ReadInt32();
            if (peOffset < 0x40 || peOffset > input.Length - 6) throw new InvalidOperationException("PowerPoint PE 信息无效：" + path);
            input.Position = peOffset;
            if (reader.ReadUInt32() != 0x00004550) throw new InvalidOperationException("PowerPoint PE 签名无效：" + path);
            return reader.ReadUInt16();
        }
    }

    private static IEnumerable<RegistryView> AvailableViews()
    {
        yield return RegistryView.Registry32;
        if (Environment.Is64BitOperatingSystem) yield return RegistryView.Registry64;
    }

    private static void Install()
    {
        RequirePowerPointClosed();
        OfficeInstallation office = Prerequisites();
        MachineCom = DiagnosticData.IsElevated();
        if (File.Exists(Marker) && RecordUsesMachineCom(ReadMarker()) && !MachineCom)
            throw new InvalidOperationException("此插件已使用管理员兼容安装。请右键本安装包，选择“以管理员身份运行”完成升级。");
        if (MachineCom) ValidateMachineOwnership();
        byte[] payload = ReadPayload("payload." + office.Key + ".zip");
        string build = ShortHash(payload);
        string directory = Path.Combine(MachineCom ? MachineRoot : Root, "addin", Version + "-" + office.Key + "-" + build);
        Diagnostics.PayloadDirectory = directory;
        DiagnosticData.Write(Path.Combine(Diagnostics.DirectoryPath, "office.json"), new { path = office.Path, version = office.FileVersion, architecture = office.Key, source = office.Source });
        ExtractPayload(payload, directory);
        ValidatePayload(directory);
        RequirePowerPointClosed();
        var originalRegistration = new RegistrationBackup();
        if(MachineCom) originalRegistration.IncludeMachineClasses();
        string source = Assembly.GetExecutingAssembly().Location;
        string setup = MaintenancePath(source, Root);
        string shortcuts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "旁门工具箱");
        var originalFiles = new InstallFileBackup(Marker, setup, Path.Combine(Root, "setup-verification.json"),
            Path.Combine(shortcuts, "修复启用.cmd"), Path.Combine(shortcuts, "导出安装诊断.cmd"));
        using(var migration = new LegacyMigration(Root))
        try {
        CopyMaintenance(source, setup);
        migration.BackupAndCopyData();
        RegisterAndVerify(directory, office);

        File.WriteAllText(Marker, Json.Serialize(new {
            product = Product, version = Version, build = build, architecture = office.Key, machineCom = MachineCom,
            officePath = office.Path, officeVersion = office.FileVersion, directory = directory, maintenanceSetup = setup, installedAt = DateTime.Now.ToString("O")
        }), Encoding.UTF8);
        WriteUninstallEntry(directory, setup, office.RegistryView, Version);
        WriteRepairShortcut(setup);
        WriteVerification(directory, office);
        migration.DisableLegacyEntries();
        migration.Commit();
        CompletionDetail = "已匹配 " + office.Label + " PowerPoint（" + office.FileVersion + "）。" + (MachineCom ? "\n已启用管理员 COM 兼容安装。" : "");
        } catch(Exception error) {
            CaptureFailure("toolbox-install-before-rollback",error);
            var rollbackErrors = new List<Exception>();
            try { originalRegistration.Restore(); } catch(Exception rollback) { rollbackErrors.Add(rollback); }
            try { originalFiles.Restore(); } catch(Exception rollback) { rollbackErrors.Add(rollback); }
            if(rollbackErrors.Count > 0) { rollbackErrors.Insert(0,error);throw new AggregateException("安装失败，原版本恢复未全部完成。请保留诊断包。",rollbackErrors); }
            throw;
        }
    }

    private static string FileHash(string path)
    {
        using(var file = File.OpenRead(path)) using(var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
    }

    private static string MaintenancePath(string source, string root)
    {
        // Old maintenance executables may be read-only or running. Never overwrite
        // them during upgrade; each exact installer gets an immutable destination.
        return Path.Combine(root, "maintenance", Version + "-" + FileHash(source), "PangmenToolbox-Setup.exe");
    }

    private static void CopyMaintenance(string source, string destination)
    {
        string expected = FileHash(source);
        if (File.Exists(destination))
        {
            if (FileHash(destination) == expected) return;
            throw new InvalidOperationException("维护程序校验失败，请保留诊断包并重新获取安装包：" + destination);
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destination));
        string temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.Copy(source, temporary, false);
            if (FileHash(temporary) != expected) throw new InvalidOperationException("维护程序复制校验失败，请重新运行安装包。");
            try { File.Move(temporary, destination); }
            catch (IOException) { if (!File.Exists(destination) || FileHash(destination) != expected) throw; }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static byte[] ReadPayload(string resourceName)
    {
        using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
        {
            if (input == null) throw new InvalidOperationException("安装包缺少 " + resourceName + "，请重新获取完整安装包。");
            using (var memory = new MemoryStream()) { input.CopyTo(memory); return memory.ToArray(); }
        }
    }

    private static string ShortHash(byte[] data)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(data)).Replace("-", "").Substring(0, 12).ToLowerInvariant();
    }

    private static void ExtractPayload(byte[] payload, string directory)
    {
        Directory.CreateDirectory(directory);
        using (var memory = new MemoryStream(payload))
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Read))
            foreach (var entry in zip.Entries)
            {
                string output = Path.GetFullPath(Path.Combine(directory, entry.FullName));
                RequireInside(output, directory);
                if (String.IsNullOrEmpty(entry.Name)) { Directory.CreateDirectory(output); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                if (File.Exists(output))
                {
                    using (var stream = entry.Open()) using (var hash = SHA256.Create())
                    using (var old = File.OpenRead(output)) using (var oldHash = SHA256.Create())
                        if (Convert.ToBase64String(hash.ComputeHash(stream)) == Convert.ToBase64String(oldHash.ComputeHash(old))) continue;
                    throw new InvalidOperationException("已有同版本文件被修改。请先卸载，再重新安装：" + output);
                }
                using (var source = entry.Open()) using (var target = new FileStream(output, FileMode.CreateNew, FileAccess.Write)) source.CopyTo(target);
            }
    }

    private static void ValidatePayload(string directory)
    {
        foreach (string file in new[] { "PangmenToolbox.AddIn.dll", "ActivationProbe.exe", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "web/shapes/index.html", "web/animations/index.html", "PangmenToolbox.Motion.dll", "build-manifest.json" })
            if (!File.Exists(Path.Combine(directory, file))) throw new InvalidOperationException("安装内容缺失：" + file);
        var manifest = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(directory, "build-manifest.json")));
        if (Convert.ToString(manifest["version"]) != Version) throw new InvalidOperationException("安装清单版本不匹配。");
        foreach (var item in (System.Collections.IEnumerable)manifest["files"])
        {
            var entry = (Dictionary<string, object>)item;
            string path = Path.GetFullPath(Path.Combine(directory, Convert.ToString(entry["path"])));
            RequireInside(path, directory);
            if (!File.Exists(path) || !String.Equals(DiagnosticData.Hash(path), Convert.ToString(entry["sha256"]), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("安装文件缺失或校验失败：" + path);
        }
    }

    private static void RequirePowerPointClosed()
    {
        if (Process.GetProcessesByName("POWERPNT").Length > 0)
            throw new InvalidOperationException("请先保存并完全退出所有 PowerPoint 窗口，再安装或修复。PPT 运行时更新可能覆盖新的加载状态。");
    }

    private static void RegisterAddin(string dll, RegistryView view, string assemblyVersion, bool machineCom = false)
    {
        var identity = AssemblyName.GetAssemblyName(dll);
        if (identity.Name != "PangmenToolbox.AddIn" || identity.Version.ToString() != assemblyVersion + ".0")
            throw new InvalidOperationException("插件文件版本与安装器不一致：" + identity.FullName);
        string assemblyName = identity.FullName;
        using (var user = RegistryKey.OpenBaseKey(machineCom ? RegistryHive.LocalMachine : RegistryHive.CurrentUser, view))
            WriteRegistration(user,dll,assemblyVersion,assemblyName,machineCom);
    }
    private static void WriteRegistration(RegistryKey user,string dll,string assemblyVersion,string assemblyName,bool machineCom)
    {
        string codeBase = RegistrationCodeBase(dll);
        {
            string cls = @"Software\Classes\CLSID\" + Clsid;
            Set(user, cls, "", "旁门工具箱");
            using (user.CreateSubKey(cls + @"\Implemented Categories\{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}")) { }
            Set(user, cls + @"\ProgId", "", ProgId);
            Set(user, @"Software\Classes\" + ProgId, "", "旁门工具箱");
            Set(user, @"Software\Classes\" + ProgId + @"\CLSID", "", Clsid);
            string server = cls + @"\InprocServer32";
            Set(user, server, "", "mscoree.dll"); Set(user, server, "ThreadingModel", "Both");
            foreach (string key in new[] { server, server + "\\" + assemblyVersion + ".0" })
            {
                Set(user, key, "Class", "PangmenToolbox.AddIn.Connect"); Set(user, key, "Assembly", assemblyName);
                Set(user, key, "RuntimeVersion", "v4.0.30319"); Set(user, key, "CodeBase", codeBase);
            }

            string paneClass = @"Software\Classes\CLSID\" + PaneClsid;
            Set(user, paneClass, "", "旁门工具箱参数面板");
            Set(user, paneClass + @"\ProgId", "", PaneProgId);
            Set(user, @"Software\Classes\" + PaneProgId, "", "旁门工具箱参数面板");
            Set(user, @"Software\Classes\" + PaneProgId + @"\CLSID", "", PaneClsid);
            using (user.CreateSubKey(paneClass + @"\Control")) { }
            using (user.CreateSubKey(paneClass + @"\Implemented Categories\{40FC6ED4-2438-11CF-A3DB-080036F12502}")) { }
            using (user.CreateSubKey(paneClass + @"\Implemented Categories\{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}")) { }
            Set(user, paneClass + @"\MiscStatus\1", "", "131457");
            string paneServer = paneClass + @"\InprocServer32";
            Set(user, paneServer, "", "mscoree.dll"); Set(user, paneServer, "ThreadingModel", "Both");
            foreach (string key in new[] { paneServer, paneServer + "\\" + assemblyVersion + ".0" })
            {
                Set(user, key, "Class", "PangmenToolbox.AddIn.TaskPaneControl"); Set(user, key, "Assembly", assemblyName);
                Set(user, key, "RuntimeVersion", "v4.0.30319"); Set(user, key, "CodeBase", codeBase);
            }

            if(machineCom)
            {
                foreach(string path in DiagnosticData.ComPaths) Set(user,path,"PangmenToolboxOwnerSid",DiagnosticData.UserSid());
            }
            else
            {
                string addin = @"Software\Microsoft\Office\PowerPoint\Addins\" + ProgId;
                Set(user, addin, "FriendlyName", "旁门工具箱");
                Set(user, addin, "Description", "形状效果、动画库与 PDF 导出");
                Set(user, addin, "LoadBehavior", 3); Set(user, addin, "CommandLineSafe", 0);
            }
        }
    }

    private static string RegistrationCodeBase(string dll)
    {
        // Match RegAsm's CLR CodeBase, not a browser URL. AbsoluteUri percent-encodes
        // spaces/Unicode; Fusion COM activation can treat those as literal file names.
        return AssemblyName.GetAssemblyName(Path.GetFullPath(dll)).CodeBase;
    }

    private static void Repair()
    {
        RequirePowerPointClosed();
        OfficeInstallation office = Prerequisites();
        if (!File.Exists(Marker)) throw new InvalidOperationException("尚未安装插件，请先运行安装程序。");
        var record = ReadMarker();
        MachineCom = RecordUsesMachineCom(record);
        RequireScopePermission();
        if (Convert.ToString(record["version"]) != Version) throw new InvalidOperationException("已安装记录不是 " + Version + "，请直接运行新版安装包完成升级。");
        // Repair started elevated must also migrate user-only components to the
        // protected machine location, not merely re-create the same ignored HKCU keys.
        if(!MachineCom&&DiagnosticData.IsElevated()){Install();return;}
        string architecture = Convert.ToString(record["architecture"]);
        if (!String.Equals(architecture, office.Key, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("PowerPoint 位数已经变化。请直接运行新版安装包，安装程序会重新选择匹配组件。");
        string directory = PayloadDirectory(record);
        Diagnostics.PayloadDirectory = directory;
        ValidatePayload(directory);
        string setup = MaintenancePath(Assembly.GetExecutingAssembly().Location, Root);
        CopyMaintenance(Assembly.GetExecutingAssembly().Location, setup);
        RegisterAndVerify(directory, office);
        WriteUninstallEntry(directory, setup, office.RegistryView, Version);
        WriteRepairShortcut(setup);
        WriteVerification(directory, office);
        CompletionDetail = "已重新匹配 " + office.Label + " PowerPoint。";
    }

    private static void Verify(OfficeInstallation expected)
    {
        if (expected == null) expected = Prerequisites();
        if (!File.Exists(Marker)) throw new InvalidOperationException("尚未安装旁门工具箱。");
        var record = ReadMarker();
        MachineCom = RecordUsesMachineCom(record);
        if (Convert.ToString(record["product"]) != Product) throw new InvalidOperationException("安装记录无效。");
        if (Convert.ToString(record["version"]) != Version) throw new InvalidOperationException("安装记录版本与校验程序不一致。");
        string architecture = Convert.ToString(record["architecture"]);
        OfficeArchitecture arch;
        if (architecture == "x86") arch = OfficeArchitecture.X86;
        else if (architecture == "x64") arch = OfficeArchitecture.X64;
        else throw new InvalidOperationException("安装记录缺少有效的 Office 位数。");
        if (expected != null && expected.Architecture != arch) throw new InvalidOperationException("安装组件与当前 PowerPoint 位数不一致。");
        string directory = PayloadDirectory(record);
        Diagnostics.PayloadDirectory = directory;
        ValidatePayload(directory);
        RegistryView view = arch == OfficeArchitecture.X86 ? RegistryView.Registry32 : RegistryView.Registry64;
        string dll = Path.Combine(directory, "PangmenToolbox.AddIn.dll");
        using (var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
        using (var key = user.OpenSubKey(@"Software\Classes\CLSID\" + Clsid + @"\InprocServer32"))
            if (key == null || Convert.ToString(key.GetValue("CodeBase")) != RegistrationCodeBase(dll))
                throw new InvalidOperationException("COM 注册未指向当前安装版本或注册表位数不匹配。");
        if(MachineCom) using(var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,view))
            foreach(string clsid in new[]{Clsid,PaneClsid})using(var key=machine.OpenSubKey(@"Software\Classes\CLSID\"+clsid+@"\InprocServer32"))
                if(key==null||Convert.ToString(key.GetValue("CodeBase"))!=RegistrationCodeBase(dll))throw new InvalidOperationException("系统 COM 注册未指向当前安装版本，请以管理员身份修复。");
        var office = expected ?? new OfficeInstallation { Architecture = arch, Path = Convert.ToString(record["officePath"]), FileVersion = Convert.ToString(record["officeVersion"]), Source = "installation record" };
        RunActivationProbe(directory, office);
        WriteVerification(directory, office);
    }

    private static void WriteVerification(string directory, OfficeInstallation office)
    {
        File.WriteAllText(Path.Combine(Root, "setup-verification.json"), Json.Serialize(new {
            verified = true, activation = true, version = Version, architecture = office.Key, machineCom = MachineCom,
            directLoad = true, comAddIn = true, comPane = true, powerPointStartupTested = false,
            officePath = office.Path, officeVersion = office.FileVersion, directory = directory, checkedAt = DateTime.Now.ToString("O")
        }), Encoding.UTF8);
    }

    private static Dictionary<string, object> ReadMarker()
    {
        return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Marker));
    }
    private static bool RecordUsesMachineCom(Dictionary<string,object> record)
    {
        return record.ContainsKey("machineCom") && Convert.ToBoolean(record["machineCom"]);
    }
    private static string PayloadDirectory(Dictionary<string,object> record)
    {
        string directory=Convert.ToString(record["directory"]);
        RequireInside(directory,Path.Combine(RecordUsesMachineCom(record)?MachineRoot:Root,"addin"));
        return directory;
    }
    private static void RequireScopePermission()
    {
        if(MachineCom&&!DiagnosticData.IsElevated())throw new InvalidOperationException("此插件使用管理员 COM 兼容安装，请以管理员身份运行修复或卸载程序。");
    }
    private static void ValidateMachineOwnership()
    {
        RequireScopePermission();
        foreach(var view in AvailableViews())using(var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,view))
            ValidateMachineOwnershipAt(machine,DiagnosticData.UserSid());
    }
    private static void ValidateMachineOwnershipAt(RegistryKey machine,string owner)
    {
        foreach(string path in DiagnosticData.ComPaths)using(var key=machine.OpenSubKey(path))
            if(key!=null&&Convert.ToString(key.GetValue("PangmenToolboxOwnerSid"))!=owner)
                throw new InvalidOperationException("检测到由其他账户或旧安装器管理的形状插件系统组件。请先由原安装账户升级或卸载该组件，以免覆盖其他账户的注册。");
    }
    private static void ClearOwnedMachineRegistrations()
    {
        foreach(var view in AvailableViews())using(var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,view))
            ClearOwnedMachineRegistrationsAt(machine,DiagnosticData.UserSid());
    }
    private static void ClearOwnedMachineRegistrationsAt(RegistryKey machine,string owner)
    {
        foreach(string path in DiagnosticData.ComPaths)
        {
            bool owned;
            using(var key=machine.OpenSubKey(path))owned=key!=null&&Convert.ToString(key.GetValue("PangmenToolboxOwnerSid"))==owner;
            if(owned)machine.DeleteSubKeyTree(path,false);
        }
    }

    private static void RunActivationProbe(string directory, OfficeInstallation office)
    {
        string reports = Path.Combine(Diagnostics.DirectoryPath, "probes");
        // An elevated validation executable must not run from a user-writable
        // diagnostics directory. Reports are data; the isolated runner is protected.
        bool protectedRunner=DiagnosticData.IsElevated();
        string isolated=protectedRunner?Path.Combine(MachineRoot,"probes",Guid.NewGuid().ToString("N")):reports;
        Directory.CreateDirectory(reports);
        Directory.CreateDirectory(isolated);
        string probe = Path.Combine(isolated, "ActivationProbe.exe");
        File.Copy(Path.Combine(directory, "ActivationProbe.exe"), probe, true);
        var failed = new List<string>();
        try
        {
        foreach (string mode in new[] { "direct", "com", "pane" })
        {
            string report = Path.Combine(reports, mode + ".json");
            var watch = Stopwatch.StartNew();
            try
            {
                var start = new ProcessStartInfo(probe) {
                    Arguments = mode + " \"" + Path.Combine(directory, "PangmenToolbox.AddIn.dll") + "\" " + Version + ".0 \"" + report + "\"",
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = isolated
                };
                using (var process = Process.Start(start))
                {
                    if (process == null) throw new InvalidOperationException("无法启动验证程序。");
                    // Drain both pipes while the child runs, including large loader exception traces.
                    var output = process.StandardOutput.ReadToEndAsync();
                    var error = process.StandardError.ReadToEndAsync();
                    bool exited = process.WaitForExit(15000);
                    if (!exited) { try { process.Kill(); process.WaitForExit(2000); } catch { } }
                    string stdout = output.Wait(2000) ? output.Result : "Output did not close.";
                    string stderr = error.Wait(2000) ? error.Result : "Error output did not close.";
                    File.WriteAllText(Path.Combine(reports, mode + ".log"), "STDOUT\n" + stdout + "\nSTDERR\n" + stderr, Encoding.UTF8);
                    DiagnosticData.Write(Path.Combine(reports, mode + "-process.json"), new {
                        mode = mode, exited = exited, exitCode = exited ? (int?)process.ExitCode : null, elapsedMs = watch.ElapsedMilliseconds
                    });
                    if (!exited) throw new TimeoutException("验证进程超时。");
                    if (process.ExitCode != 0) throw new InvalidOperationException("验证进程退出码：" + process.ExitCode);
                    if (!File.Exists(report) || !Convert.ToBoolean(Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(report))["passed"]))
                        throw new InvalidOperationException("验证报告缺失或未通过。");
                }
            }
            catch (Exception ex)
            {
                failed.Add(mode == "direct" ? "DLL 与依赖加载" : mode == "com" ? "COM 插件入口" : "COM 参数面板入口");
                DiagnosticData.Write(Path.Combine(reports, mode + "-failure.json"), DiagnosticData.Error(ex));
            }
        }
        if (failed.Count != 0) throw new InvalidOperationException("组件加载验证未通过（" + office.Label + " PowerPoint）：\n" + String.Join("、", failed) + "。\n详细路径和加载记录已保存在诊断包中。");
        }
        finally
        {
            if(protectedRunner)try{RequireInside(isolated,Path.Combine(MachineRoot,"probes"));Directory.Delete(isolated,true);}catch(Exception cleanup){DiagnosticData.Write(Path.Combine(reports,"runner-cleanup.json"),DiagnosticData.Error(cleanup));}
        }
    }

    private static void RegisterAndVerify(string directory, OfficeInstallation office)
    {
        var backup = new RegistrationBackup();
        if(MachineCom){ValidateMachineOwnership();backup.IncludeMachineClasses();}
        Diagnostics.Capture("before-registration");
        try
        {
            ClearAllRegistrations();
            RegisterAddin(Path.Combine(directory, "PangmenToolbox.AddIn.dll"), office.RegistryView, Version);
            if(MachineCom)
            {
                ClearOwnedMachineRegistrations();
                RegisterAddin(Path.Combine(directory,"PangmenToolbox.AddIn.dll"),office.RegistryView,Version,true);
            }
            Diagnostics.Capture("registered-before-activation");
            RunActivationProbe(directory, office);
        }
        catch (Exception error)
        {
            // Capture the failed state before restoring it. A logging failure must not prevent rollback.
            CaptureFailure("failure-before-rollback", error);
            try { backup.Restore(); }
            catch (Exception rollbackError) { throw new AggregateException("组件验证失败，原注册恢复也未完成。请保留诊断包。", error, rollbackError); }
            CaptureFailure("after-rollback", error);
            throw;
        }
    }

    private static void CaptureFailure(string stage, Exception error)
    {
        try { if (Diagnostics != null) Diagnostics.Capture(stage, error); }
        catch (Exception captureError) { error.Data["DiagnosticCaptureError"] = captureError.ToString(); }
    }

    private static void WriteUninstallEntry(string directory, string setup, RegistryView view, string displayVersion)
    {
        using (var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
        {
            string uninstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + ProgId;
            Set(user, uninstall, "DisplayName", "旁门工具箱"); Set(user, uninstall, "DisplayVersion", displayVersion);
            Set(user, uninstall, "Publisher", "旁门"); Set(user, uninstall, "InstallLocation", directory);
            Set(user, uninstall, "UninstallString", "\"" + setup + "\" /uninstall");
            Set(user, uninstall, "NoModify", 1); Set(user, uninstall, "NoRepair", 1);
        }
    }

    private static string MaintenanceCommand(string setup, string operation)
    {
        RequireInside(setup, Root);
        string relative = setup.Substring(Root.TrimEnd(Path.DirectorySeparatorChar).Length + 1);
        return "@echo off\r\n\"%LOCALAPPDATA%\\PangmenToolbox\\" + relative + "\" /" + operation + "\r\n";
    }

    private static void WriteRepairShortcut(string setup)
    {
        try
        {
            string shortcuts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "旁门工具箱");
            Directory.CreateDirectory(shortcuts);
            File.WriteAllText(Path.Combine(shortcuts, "修复启用.cmd"), MaintenanceCommand(setup, "repair"), Encoding.ASCII);
            File.WriteAllText(Path.Combine(shortcuts, "导出安装诊断.cmd"), MaintenanceCommand(setup, "diagnose"), Encoding.ASCII);
        }
        catch { }
    }

    private static void Diagnose()
    {
        Directory.CreateDirectory(Root);
        OfficeInstallation office = null;
        string error = null;
        try { office = Prerequisites(); } catch (Exception ex) { error = ex.GetBaseException().Message; }
        string path = Path.Combine(Root, "setup-diagnostics.json");
        File.WriteAllText(path, Json.Serialize(new {
            generatedAt = DateTime.Now.ToString("O"), windows64Bit = Environment.Is64BitOperatingSystem,
            process64Bit = Environment.Is64BitProcess, officePath = office == null ? null : office.Path,
            officeVersion = office == null ? null : office.FileVersion, officeArchitecture = office == null ? null : office.Key,
            officeSource = office == null ? null : office.Source, webView2 = HasWebView2(), installed = File.Exists(Marker), error = error
        }), Encoding.UTF8);
        if (File.Exists(Marker))
        {
            try
            {
                var record = ReadMarker();
                string directory = PayloadDirectory(record);
                Diagnostics.PayloadDirectory = directory;
            }
            catch (Exception ex) { CaptureFailure("invalid-installation-record", ex); }
        }
        File.Copy(path, Path.Combine(Diagnostics.DirectoryPath, "setup-diagnostics.json"), true);
        Diagnostics.Capture("read-only-diagnosis");
        Diagnostics.Export();
        if (!Quiet) MessageBox.Show("当前环境诊断已保存。\n\n" + Diagnostics.ArchivePath + "\n\n安装失败时的现场在 diagnostics 文件夹中对应时间的诊断包里保留。", "旁门工具箱", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private static void Uninstall()
    {
        RequirePowerPointClosed();
        MachineCom=File.Exists(Marker)&&RecordUsesMachineCom(ReadMarker());
        RequireScopePermission();
        if(MachineCom){ValidateMachineOwnership();ClearOwnedMachineRegistrations();}
        ClearAllRegistrations();
        LegacyMigration.RestoreOnUninstall(Root);
        if(MachineCom)
        {
            string machineBinaries=Path.Combine(MachineRoot,"addin");RequireInside(machineBinaries,MachineRoot);
            if(Directory.Exists(machineBinaries))Directory.Delete(machineBinaries,true);
        }
        string binaryRoot = Path.Combine(Root, "addin"); RequireInside(binaryRoot, Root);
        if (Directory.Exists(binaryRoot)) Directory.Delete(binaryRoot, true);
        if (File.Exists(Marker)) File.Delete(Marker);
        string shortcuts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "旁门工具箱");
        if (Directory.Exists(shortcuts))
        {
            foreach (string file in new[] { "修复启用.cmd", "导出安装诊断.cmd" }) { string path = Path.Combine(shortcuts, file); if (File.Exists(path)) File.Delete(path); }
            if (!Directory.EnumerateFileSystemEntries(shortcuts).Any()) Directory.Delete(shortcuts);
        }
    }

    private static void ClearAllRegistrations()
    {
        foreach (RegistryView view in AvailableViews())
            using (var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
            {
                user.DeleteSubKeyTree(@"Software\Microsoft\Office\PowerPoint\Addins\" + ProgId, false);
                user.DeleteSubKeyTree(@"Software\Classes\CLSID\" + Clsid, false);
                user.DeleteSubKeyTree(@"Software\Classes\" + ProgId, false);
                user.DeleteSubKeyTree(@"Software\Classes\CLSID\" + PaneClsid, false);
                user.DeleteSubKeyTree(@"Software\Classes\" + PaneProgId, false);
                user.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + ProgId, false);
            }
    }

    private static void RequireInside(string target, string parent)
    {
        string prefix = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!Path.GetFullPath(target).StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("文件路径超出本项目安装目录。");
    }

    private static void Set(RegistryKey root, string path, string name, object value)
    {
        using (var key = root.CreateSubKey(path)) key.SetValue(name, value, value is int ? RegistryValueKind.DWord : RegistryValueKind.String);
    }
}
