# 展示案例

[查看图片与 GIF](../README.md#先看效果) · [返回首页](../README.md)

| 案例 | 内容 | 制作方式 |
| --- | --- | --- |
| 1 | 轰然坠落 | 插件原生动画时序与尘雾，进入后单次播放 |
| 2 | 数字滚动 | 128,640 示例数据，逐位滚动停稳 |
| 3 | 弥散渐变 | 16 个内置预设，包含色光、光球、轮廓与金属质感 |
| 4 | 液态玻璃 | 12 个内置预设，统一使用预设库内置图片背景 |

动图由真实 PowerPoint 导出视频后转换，形状缩略图由插件实际材质渲染器生成。它们不是桌面界面截图。数值、文字均为展示内容，不代表业务数据。

案例通过 README 中的图片和 GIF 展示，不提供示例 PPT 下载。以下脚本供开发者自行复现，生成的文稿只作为本地制作素材。要调节材质，请新建受支持的形状并使用插件，不应把展示图像当作带有原始参数的插件对象。

## 重新生成

### 全量三列画廊

当前画廊覆盖 v1.0.11 的 51 款正式动画与 28 个内置形状预设。动画由 PowerPoint 原生执行后导出，使用已安装的「思源黑体 CN Bold」；预设名称按插件界面显示，玻璃背景与内置预设库一致。GitHub 正文仍使用平台字体。

安装思源黑体 CN、Python 的 `Pillow` 与 `imageio-ffmpeg`，并准备 PowerPoint、Edge 和仓库 npm 依赖后运行：

```powershell
node examples/prepare-gallery.cjs
powershell -NoProfile -ExecutionPolicy RemoteSigned -File examples/export-gallery.ps1
python examples/encode-gallery.py examples/output/gallery docs/media/gallery
python examples/build-gallery-thumbnails.py docs/media/gallery
python examples/build-gallery-docs.py examples/output/gallery/inventory.json .
```

`prepare-gallery.cjs` 按正式开放目录生成清单，排除待实现与已移除动画。`export-gallery.ps1` 只操作新建的自有文稿，使用原生参数和执行模块；多对象动画使用六张卡片，其他效果使用文字或单张卡片。循环 GIF 截取一个周期，其他 GIF 在播放前展示静止封面。中间 PPT、MP4 仅留在本地，不随画廊上传。

`-Resume` / `--resume` 仅用于继续同一次、参数未变且已有文件确认完整的生成任务。改变字体、参数或源码后请使用新输出目录。生成后需检查 GIF 动态帧、首尾状态、文字完整性以及实际 GitHub 排版，不能只检查文件数量。

画廊每行三张，顶部四个精选案例等宽。独立生成 200 × 138 的画廊缩略图及 160 × 110 的精选缩略图，点击仍可查看原图。GitHub 的 GIF 播放控件会覆盖 HTML 图片宽度，不能只修改 `width` 属性；检查时需同时测量表格自身的横向溢出、四格宽度和 GIF 播放控件下的布局。

### 较大案例的本地复现

需要安装桌面 PowerPoint、Microsoft Edge，并先完成仓库的 npm 依赖安装。

```powershell
node examples/render-materials.cjs
powershell -NoProfile -ExecutionPolicy RemoteSigned -File examples/build-showcase.ps1
```

脚本只新建自己的文稿，不读取、修改或关闭已有用户文稿，也不会退出共享 PowerPoint。输出到 `examples/output/`，其中 MP4 为 PowerPoint 的直接导出。

Office 可能暂时忙碌，脚本包含有限 COM 等待重试。若持续失败，先结束自己正在进行的交互操作，再重新运行。自行分享生成的文稿前应检查并移除个人元数据。

`-MaterialsOnly` 参数可只重建形状页和合并示例，前提是输出目录里已有两个动画 PPT。
