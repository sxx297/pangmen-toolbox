# Windows 构建与验证

## 环境

- Python 3.10+、Node.js 20+ 与 npm，加入 PATH。
- Windows PowerShell 5.1、.NET Framework 4.8；构建引用 Windows 自带的 System.Management.Automation。
- 需要网络访问 NuGet 和 npm。`bootstrap-build.py` 固定 Roslyn 4.8.0、net48 参考程序集 1.0.3、WebView2 SDK 1.0.3650.58。构建另获取 Obfuscar 2.2.38。
- JavaScript 依赖按 `package-lock.json` 通过 `npm ci` 安装。

```powershell
npm ci
python tools/bootstrap-build.py
python tools/build-toolbox.py
```

构建脚本会生成前端页面，编译 x86/x64 组件，并制作架构自动检测安装器。结果在 `dist/`，中间文件在 `build/`，SDK 在 `.tools/`。

生成密钥的本地脚本只为该 PowerShell 子进程设置 RemoteSigned，不修改用户或机器的永久策略；组织组策略仍优先。

首次构建会在 `security/private/` 创建开发强名称密钥。它不证明发布者身份，也不是官方私钥；不要提交或分享私钥。不要把自行构建的安装包标记为官方发布。代码混淆是现有打包过程的一部分，完整可修改源码仍在本仓库。

## 验证

```powershell
python tests/verify-package.py
powershell -NoProfile -ExecutionPolicy RemoteSigned -File tests/verify-runtime-version.ps1
npm run check:ui
```

UI 测试需要本机 Microsoft Edge。载荷测试会启动独立组件检查进程，不会安装产品。测试输出在 `tests/results/`。

安装器回归程序使用已下载编译器编译：

```powershell
& .tools/packages/microsoft.net.compilers.toolset.4.8.0/tasks/net472/csc.exe /nologo /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /out:build/InstallerAdversarialTest.exe tests/InstallerAdversarialTest.cs
$testOutput = Join-Path $env:TEMP ('pm-oss-' + [guid]::NewGuid().ToString('N').Substring(0,8))
& build/InstallerAdversarialTest.exe dist/PangmenToolbox-Setup-1.0.11.exe $testOutput
```

安装器测试使用较短的临时目录，避免 .NET Framework 的 260 字符路径限制；它只创建测试文件，不执行产品安装。

其他 Office COM 回归需在安装 PowerPoint 的测试环境执行。只操作自建文稿，不退出共享 PowerPoint、不关闭用户文稿。编译验证不能替代真实 Office 验证。

## 发布

源码标签必须对应发布的实际构建输入。上传安装包、SHA256 和更新说明到 GitHub Releases，不把生成文件提交到源码仓库。发布前检查 GPL 与第三方许可文件随安装载荷分发。现有 1.0.11 安装包的验证不自动覆盖修改后的新构建。
