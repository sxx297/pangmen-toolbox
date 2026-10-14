"""Generate README gallery blocks from the same inventory used for rendering."""
from pathlib import Path
import argparse,json
parser=argparse.ArgumentParser()
parser.add_argument('inventory',type=Path)
parser.add_argument('public_root',type=Path)
args=parser.parse_args()
data=json.loads(args.inventory.read_text(encoding='utf-8'))
root=args.public_root
def table(items,kind):
    lines=['<table>']
    for start in range(0,len(items),3):
        lines.append('<tr>')
        for item in items[start:start+3]:
            file=('material-'+item['id']+'.png') if kind=='material' else item['id']+'.gif'
            src='docs/media/gallery/'+file
            thumb='docs/media/gallery/thumbs/'+file
            lines.append(f'<td width="33%" align="center"><a href="{src}"><img src="{thumb}" width="200" alt="{item["name"]}"></a><br><strong>{item["name"]}</strong></td>')
        for _ in range(3-len(items[start:start+3])):lines.append('<td width="33%"></td>')
        lines.append('</tr>')
    lines.append('</table>')
    return '\n'.join(lines)
labels={'entrance':'进入','emphasis':'强调','loop':'循环','exit':'退出'}
parts=['## 动画画廊','', '**51 款正式动画 · 38 款元素动画 + 13 款文本动画**','',
       '展开分类查看全部动图，点击缩略图可放大。所有动画均由插件原生逻辑在真实 PowerPoint 中执行、导出，案例字体为思源黑体。','',
       'GIF 循环仅用于展示；进入、强调和退出效果保留短暂停顿，循环效果展示一个周期。实际效果仍由 PPT 中的播放设置控制。','']
for mode,title in [('element','元素动画'),('text','文本动画')]:
    parts+=['### '+title,'']
    for category,label in labels.items():
        items=[e for e in data['animations'] if e['mode']==mode and e['category']==category]
        if not items:continue
        parts+=['<details>',f'<summary><strong>{label} · {len(items)} 款</strong></summary>','',table(items,'animation'),'','</details>','']
parts+=['## 形状画廊','','**28 个内置预设 · 16 个弥散渐变 + 12 个液态玻璃**','',
        '以下图片使用插件实际材质渲染器生成。玻璃统一使用预设库内置的绸缎背景，便于比较折射、模糊与边缘高光。光球、透镜保留圆形轮廓，其他预设使用圆角矩形。','']
for effect,label in [('gradient','弥散渐变'),('glass','液态玻璃')]:
    items=[e for e in data['materials'] if e['effect']==effect]
    parts+=['### '+label,'',table(items,'material'),'']
gallery='\n'.join(parts)
readme=root/'README.md'
old=readme.read_text(encoding='utf-8')
if '## 动画画廊' in old:
    old=old[:old.index('## 动画画廊')]+old[old.index('## 安装与上手'):]
start=old.index('## 先看效果')
end=old.index('## 能做什么')
feature='''## 先看效果

<table>
<tr>
<td width="25%" align="center"><a href="docs/media/gallery/anvil.gif"><img src="docs/media/gallery/featured/anvil.gif" width="160" alt="轰然坠落"></a><br><strong>轰然坠落</strong><br><sub>急速坠落<br>落点尘雾扩散</sub></td>
<td width="25%" align="center"><a href="docs/media/gallery/number-roll.gif"><img src="docs/media/gallery/featured/number-roll.gif" width="160" alt="数值滚动"></a><br><strong>数值滚动</strong><br><sub>逐位滚动<br>停在原数值</sub></td>
<td width="25%" align="center"><a href="docs/media/gallery/material-spectrumFrame.png"><img src="docs/media/gallery/featured/material-spectrumFrame.png" width="160" alt="幻彩霓虹"></a><br><strong>弥散渐变</strong><br><sub>多层色光<br>丰富卡片层次</sub></td>
<td width="25%" align="center"><a href="docs/media/gallery/material-glass.png"><img src="docs/media/gallery/featured/material-glass.png" width="160" alt="通透玻璃"></a><br><strong>液态玻璃</strong><br><sub>背景折射<br>柔和边缘高光</sub></td>
</tr>
</table>

**如何制作：** 选中 PPT 对象，在动画库选择效果；或在形状效果中选择预设，调整参数后应用。[完整使用步骤 →](docs/USER_GUIDE.md)

'''
new=old[:start]+feature+old[end:]
new=new.replace('<a href="#先看效果">效果展示</a> ·','<a href="#动画画廊">动画画廊</a> ·\n<a href="#形状画廊">形状画廊</a> ·')
new=new.replace('## 安装与上手',gallery+'\n## 安装与上手')
readme.write_text(new,encoding='utf-8')
(root/'docs/GALLERY.md').write_text('# 效果画廊\n\n[返回首页](../README.md)\n\n'+gallery.replace('docs/media/','media/'),encoding='utf-8')
print(f'Generated three-column galleries: {len(data["animations"])} animations, {len(data["materials"])} materials')
