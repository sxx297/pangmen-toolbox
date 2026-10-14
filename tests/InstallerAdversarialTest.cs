using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Linq;

internal static class InstallerAdversarialTest
{
    static Assembly setup;
    static int checks;
    static object Call(string method, params object[] args) { return setup.GetType("Setup").GetMethod(method, BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,args); }
    static void Check(bool value,string label) { if(!value)throw new Exception(label);Console.WriteLine("PASS "+label);checks++; }
    static void Reject(Action action,string label) { bool rejected=false;try{action();}catch(TargetInvocationException ex){rejected=ex.InnerException is InvalidOperationException || ex.InnerException is IOException;}Check(rejected,label); }
    static byte[] Zip(string name) { using(var m=new MemoryStream()){using(var z=new ZipArchive(m,ZipArchiveMode.Create,true)){using(var w=new StreamWriter(z.CreateEntry(name).Open()))w.Write("bad");}return m.ToArray();} }
    static int Main(string[] args)
    {
        try {
            setup=Assembly.LoadFrom(Path.GetFullPath(args[0]));string root=Path.GetFullPath(args[1]);Directory.CreateDirectory(root);
            foreach(string arch in new[]{"x86","x64"}) {
                string dir=Path.Combine(root,arch);byte[] payload;
                using(var source=setup.GetManifestResourceStream("payload."+arch+".zip"))using(var m=new MemoryStream()){source.CopyTo(m);payload=m.ToArray();}
                Call("ExtractPayload",payload,dir);Call("ValidatePayload",dir);Check(true,arch+" embedded payload validates");
                Call("ExtractPayload",payload,dir);Check(true,arch+" repeated extraction is idempotent");
                string web=Path.Combine(dir,"web","animations","index.html");byte[] original=File.ReadAllBytes(web);File.AppendAllText(web,"corruption");
                Reject(()=>Call("ValidatePayload",dir),arch+" altered asset rejected");Reject(()=>Call("ExtractPayload",payload,dir),arch+" existing altered file is not overwritten");File.WriteAllBytes(web,original);
                string dll=Path.Combine(dir,"PangmenToolbox.Motion.dll");File.Move(dll,dll+".hold");Reject(()=>Call("ValidatePayload",dir),arch+" missing motion DLL rejected");File.Move(dll+".hold",dll);
            }
            string extract=Path.Combine(root,"traversal");Reject(()=>Call("ExtractPayload",Zip("../outside.txt"),extract),"parent traversal rejected");Check(!File.Exists(Path.Combine(root,"outside.txt")),"no file created outside extraction root");
            Reject(()=>Call("ExtractPayload",Zip(Path.Combine(root,"absolute.txt")),extract),"absolute archive path rejected");Check(!File.Exists(Path.Combine(root,"absolute.txt")),"absolute destination untouched");
            string files=Path.Combine(root,"rollback");Directory.CreateDirectory(files);
            string[] names={"installation.json","PangmenToolbox-Setup.exe","setup-verification.json","repair.cmd","diagnose.cmd"};
            var paths=names.Select(n=>Path.Combine(files,n)).ToArray();foreach(string p in paths.Take(3))File.WriteAllText(p,"previous-"+Path.GetFileName(p));
            var type=setup.GetType("InstallFileBackup",true);var backup=Activator.CreateInstance(type,BindingFlags.Instance|BindingFlags.NonPublic,null,new object[]{paths},null);
            foreach(string p in paths)File.WriteAllText(p,"new-version");
            type.GetMethod("Restore",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(backup,null);
            foreach(string p in paths.Take(3))Check(File.ReadAllText(p)=="previous-"+Path.GetFileName(p),"rollback restores "+Path.GetFileName(p));
            foreach(string p in paths.Skip(3))Check(!File.Exists(p),"failed install removes new "+Path.GetFileName(p));
            using(var running=new FileStream(paths[1],FileMode.Open,FileAccess.Read,FileShare.Read))type.GetMethod("Restore",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(backup,null);
            Check(true,"unchanged read-only running repair executable is not rewritten");
            foreach(string p in paths.Take(3))File.WriteAllText(p,"new-again");
            bool failed=false;using(var locked=new FileStream(paths[0],FileMode.Open,FileAccess.Read,FileShare.None))try{type.GetMethod("Restore",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(backup,null);}catch(TargetInvocationException ex){failed=ex.InnerException is AggregateException;}
            Check(failed,"rollback reports locked file");Check(File.ReadAllText(paths[1])=="previous-"+names[1],"rollback continues restoring repair program after other file fails");
            string maintenanceRoot=Path.Combine(root,"maintenance-upgrade"),installerSource=Path.GetFullPath(args[0]);Directory.CreateDirectory(maintenanceRoot);
            string oldSetup=Path.Combine(maintenanceRoot,"PangmenToolbox-Setup.exe");File.WriteAllText(oldSetup,"old-maintenance");File.SetAttributes(oldSetup,FileAttributes.ReadOnly);
            try {
                bool denied=false;try{File.Copy(installerSource,oldSetup,true);}catch(UnauthorizedAccessException){denied=true;}
                Check(denied,"legacy overwrite reproduces access denied on read-only maintenance program");
                string current=(string)Call("MaintenancePath",installerSource,maintenanceRoot);
                var transaction=Activator.CreateInstance(type,BindingFlags.Instance|BindingFlags.NonPublic,null,new object[]{new[]{current}},null);
                using(var oldLock=new FileStream(oldSetup,FileMode.Open,FileAccess.Read,FileShare.None))Call("CopyMaintenance",installerSource,current);
                Check(File.ReadAllBytes(current).SequenceEqual(File.ReadAllBytes(installerSource)),"new maintenance copy succeeds while legacy file is locked and read-only");
                Check(File.ReadAllText(oldSetup)=="old-maintenance"&&(File.GetAttributes(oldSetup)&FileAttributes.ReadOnly)!=0,"legacy executable bytes and attributes remain unchanged");
                File.SetAttributes(current,FileAttributes.ReadOnly);
                try { using(var currentLock=new FileStream(current,FileMode.Open,FileAccess.Read,FileShare.Read))Call("CopyMaintenance",installerSource,current); }
                finally { File.SetAttributes(current,FileAttributes.Normal); }
                Check(true,"same installer can be reused while its maintenance executable is locked and read-only");
                Call("CopyMaintenance",current,current);Check(true,"repair from maintenance executable does not copy over itself");
                File.AppendAllText(current,"tampered");Reject(()=>Call("CopyMaintenance",installerSource,current),"altered maintenance executable is rejected without overwrite");
                type.GetMethod("Restore",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(transaction,null);
                Check(!File.Exists(current)&&File.Exists(oldSetup),"failed upgrade removes newly created maintenance file and preserves legacy file");
                string alternate=Path.Combine(maintenanceRoot,"alternate.exe");File.WriteAllText(alternate,"different-installer");
                Check((string)Call("MaintenancePath",alternate,maintenanceRoot)!=current,"different installer bytes receive a distinct maintenance path");
                Call("CopyMaintenance",installerSource,current);
                Check(!Directory.GetFiles(Path.GetDirectoryName(current),"*.tmp").Any(),"successful maintenance copy leaves no staging files");
                string productRoot=(string)setup.GetType("Setup").GetField("Root",BindingFlags.NonPublic|BindingFlags.Static).GetValue(null);
                string installed=(string)Call("MaintenancePath",installerSource,productRoot);
                foreach(string operation in new[]{"repair","diagnose"}) {
                    string command=(string)Call("MaintenanceCommand",installed,operation);
                    Check(command.Contains("\\maintenance\\")&&command.Contains("\" /"+operation)&&command.All(c=>c<128),operation+" shortcut points to versioned maintenance path with ASCII-safe environment expansion");
                }
            } finally { File.SetAttributes(oldSetup,FileAttributes.Normal); }
            File.WriteAllText(Path.Combine(root,"summary.json"),"{\"passed\":true,\"checks\":"+checks+"}");return 0;
        } catch(Exception e){Console.Error.WriteLine(e);return 1;}
    }
}
