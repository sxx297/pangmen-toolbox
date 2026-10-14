# 展示案例

[下载四页示例 PPT](https://github.com/sxx297/pangmen-toolbox/releases/download/v1.0.11/pangmen-toolbox-examples.pptx) · [返回首页](../README.md)

| 页 | 内容 | 展示方式 |
| --- | --- | --- |
| 1 | 轰然坠落 | 插件原生动画时序与尘雾，进入后单次播放 |
| 2 | 数字滚动 | 128,640 示例数据，逐位滚动停稳 |
| 3 | 弥散渐变 | 三种材质卡片，独立可编辑文字 |
| 4 | 液态玻璃 | 三种玻璃材质，独立可编辑文字 |

动图由真实 PowerPoint 导出视频后转换，形状图由插件材质渲染器生成并经 PowerPoint 排版导出。它们不是桌面界面截图。数值、文字均为展示内容，不代表业务数据。

前两页包含原生动画及必要辅助对象，可直接放映。后两页的材质已保存为图像；要重新调节材质，请新建受支持的形状并使用插件，不应把示例图像当作带有原始参数的插件对象。

## 重新生成

需要安装桌面 PowerPoint、Microsoft Edge，并先完成仓库的 npm 依赖安装。

```powershell
node examples/render-materials.cjs
powershell -NoProfile -ExecutionPolicy RemoteSigned -File examples/build-showcase.ps1
```

脚本只新建自己的文稿，不读取、修改或关闭已有用户文稿，也不会退出共享 PowerPoint。输出到 `examples/output/`，其中 MP4 为 PowerPoint 的直接导出。

Office 可能暂时忙碌，脚本包含有限 COM 等待重试。若持续失败，先结束自己正在进行的交互操作，再重新运行。公开分享 PPT 前应检查并移除个人元数据；仓库 Release 中的示例已做此处理。

`-MaterialsOnly` 参数可只重建形状页和合并示例，前提是输出目录里已有两个动画 PPT。
