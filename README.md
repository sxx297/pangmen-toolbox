# 旁门工具箱 · Pangmen Toolbox

面向 Windows 桌面版 Microsoft PowerPoint 的插件，提供形状材质、动画库和图片型 PDF 导出。

![形状效果](preview/shots/shape-glass.png)

## 功能

- **形状效果**：弥散渐变、液态玻璃、图层编辑、预设保存与原始形状恢复。
- **动画库**：元素与文本动画、参数调节、浏览器示例预览和 PowerPoint 原生应用。
- **PDF 导出**：选择页面与输出质量，导出图片型 PDF。
- **面板布局**：侧栏与悬浮窗，共用控件和提示样式。

![动画库](preview/shots/animation-floating.png)

## 下载与安装

当前先发布源码，安装包尚未上传至 GitHub Releases。可按下方说明自行构建；后续发布包及 SHA256 将集中放在 [Releases](https://github.com/sxx297/pangmen-toolbox/releases)。

1. 保存文稿并关闭 PowerPoint。
2. 运行安装包，按提示完成安装。
3. 重新打开 PowerPoint，在“旁门工具箱”选项卡启动功能。

需要 Windows 桌面版 PowerPoint、.NET Framework 4.8 和 Microsoft Edge WebView2 Runtime。安装器检测 PowerPoint 位数并选择 x86/x64 组件。当前实测以 x64 Office 为主；不支持 macOS、网页版 PowerPoint，也不宣称兼容所有 Office 历史版本。不要为安装擅自关闭系统防护或修改组织策略。

修复入口位于开始菜单“旁门工具箱”。卸载使用 Windows 已安装应用列表；个人预设与诊断记录会保留。安装失败时可导出诊断，但公开 Issue 前应删除用户名、文件路径等个人信息。

## 从源码构建

完整步骤见 [构建说明](docs/BUILDING.md)。在 Windows PowerShell 中执行：

```powershell
npm ci
python tools/bootstrap-build.py
python tools/build-toolbox.py
```

需要 Python 3.10+、Node.js 20+、Windows PowerShell 5.1。输出在 `dist/`。正式签名私钥不随源码发布；首次构建会生成仅用于本地开发的强名称密钥。开发构建不是官方签名发布，不应覆盖正在使用的正式安装，建议在测试账户或虚拟机验证。

## 浏览器预览

```powershell
python tools/build-theme.py
python features/shapes/prototype/build-preview.py
python features/animations/build-preview.py
python tools/preview.py
```

打开 <http://127.0.0.1:8780>。此模式使用示例内容，不读写 PowerPoint 文稿。

## 目录

| 路径 | 内容 |
| --- | --- |
| `host/` | COM 加载项、Ribbon、任务面板与窗口管理 |
| `features/shapes/` | 形状效果渲染与 PowerPoint 桥接 |
| `features/animations/` | 动画预览、目录及原生执行 |
| `features/export/` | PDF 导出 |
| `shared/ui/` | 公共主题与组件 |
| `installer/` | 安装、修复、卸载与诊断 |
| `tools/`、`tests/` | 构建脚本与选定回归入口 |

## 已知限制

- 形状材质保留原有旋转、翻转、组合等对象限制；部分导入图片须先转为可编辑的单个 PowerPoint 形状。
- PDF 为图片型，文字不可搜索。
- 浏览器动画示例与 PowerPoint 原生实现存在平台差异。
- x86 构建通过不代表全部功能已在真实 32 位 Office 验证。
- 安装包当前没有发布者 Authenticode 签名。

问题反馈请使用 [Issues](https://github.com/sxx297/pangmen-toolbox/issues)，注明插件版本、Windows/Office 位数和重现步骤。请用不含客户内容的最小示例文件。

## 许可与贡献

本项目原创代码按 **GPL-3.0-only** 发布，参见 [LICENSE](LICENSE)。允许使用、修改和商用；分发受该许可证覆盖的修改版时须遵守相应源码提供义务。第三方部分保留各自许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。

欢迎通过 Issue 和 Pull Request 参与。提交前阅读 [贡献指南](CONTRIBUTING.md) 与 [安全说明](SECURITY.md)。
