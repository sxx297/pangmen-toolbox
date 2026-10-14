# 第三方与运行环境声明

本项目原创代码按 GPL-3.0-only 发布。下列第三方部分保留原许可证，主项目许可证不替代其许可。

| 组件 | 用途 | 许可与来源 |
| --- | --- | --- |
| @liquid-dom/core 0.1.1 的光学算法改编 | 液态玻璃渲染 | MIT；原声明在 `features/shapes/prototype/licenses/liquid-dom-core-MIT.txt`，版权人为 Andras Prifer |
| Microsoft.Web.WebView2 1.0.3650.58 | Windows WebView2 宿主 | Microsoft NuGet 包自带 LICENSE/NOTICE；构建时复制到载荷 `licenses/` |
| .NET Framework 4.8 / Windows PowerShell / PowerPoint | 本机运行环境 | Microsoft 组件，需自行合法安装；不作为项目原创代码重新许可 |
| Roslyn / .NET Framework reference assemblies | 构建 | NuGet 固定版本；使用下载包随附许可 |
| Obfuscar 2.2.38 | 构建混淆 | MIT，构建工具不随运行时载荷发布 |
| Terser 5.44.0 | JavaScript 构建 | BSD-2-Clause，依赖许可见 npm 包 |
| javascript-obfuscator 4.1.1 | JavaScript 构建 | BSD-2-Clause，依赖许可见 npm 包 |
| Playwright 1.55.0 | UI 测试 | Apache-2.0，测试依赖不随安装包发布 |

运行素材包括品牌图形、形状面板插画，以及动画用的云雾帧/循环时序 PPTX。发布快照去除了 PPTX 的个人作者属性。系统字体仅通过字体名称调用，不随仓库分发字体文件。项目品牌图形不代表对衍生版本的官方背书。
