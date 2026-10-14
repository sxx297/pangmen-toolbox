/* The published library is restricted to recipes with a native selection adapter. */
(function () {
  const deferred = {
    'line-draw-in': '任意曲线描绘需要提取路径并拆分，不能通用于选中对象。',
    'line-draw-out': '原生方向擦除不能等同于沿任意曲线擦除。',
    'flow-dots': '依赖专用分支连线场景，需要路径识别。',
    'shine': '任意对象表面裁切高光需要额外蒙版。',
    'color-sweep': '任意图片、组合的扫色需要专用覆盖层和轮廓处理。',
    'ripple': '任意对象轮廓扩散需要提取形状轮廓。',
    'text-drop': '逐字随机旋转需独立对象，保留后续研究。',
    'text-gather': '每个字符不同路径需拆字。',
    'text-keyword': '需要明确词语选区与局部缩放，不能将整框动画冒充关键词动画。',
    'text-underline': '多行文字下划线描绘需要额外线条与布局适配。',
    'text-read': '逐词高亮与复原需要词组范围时序。',
    'text-cycle': '固定前缀与轮换词的专用场景不适用于任意现有文本。',
    'text-wave': '独立字符相位循环需要拆字。',
    'text-shine': '字形内高光需要字形蒙版。',
    'text-type-loop': '回删顺序与循环需要独立文本时序。',
    'text-delete': '原生段落反序不能等同于字符反向回删。',
    'text-flip-out': '逐字符透视退出需要拆字。',
    'text-fall-apart': '每字随机旋转与坠落需拆字。',
    'text-collapse': '字间聚拢依赖拆字与重排。'
  };
  const catalog = MotionCatalog;
  const retired = {
    'arc-in': '按产品精简要求移除。',
    'arc-out': '按产品精简要求移除。',
    'wipe-in': '原生擦除的柔边与预览硬边裁切不一致。',
    'wipe-out': '原生擦除的柔边与预览硬边裁切不一致。',
    'text-lines-in': '原生逐段擦除无法还原预览的硬边揭示。',
    'text-lines-out': '原生逐段擦除无法还原预览的硬边收起。'
  };
  const descriptions = {
    'wipe-in': ['方向揭示', '沿指定方向显露选中对象，使用 PowerPoint 原生擦除。'],
    'wipe-out': ['方向擦除', '沿指定方向收起选中对象，使用 PowerPoint 原生擦除。'],
    'text-lines-in': ['逐段揭示', '文本按回车分段，依次擦除进入；保留原文本框。'],
    'text-lines-out': ['逐段收起', '文本按回车分段，依次擦除退出；保留原文本框。'],
    'typewriter': ['逐字出现', '文字依次出现，保留原文本框和文字格式。'],
    'flip-in': ['翻转入场', '通过横向或纵向收放模拟翻转，原对象保持可编辑。'],
    'fold-in': ['折叠展开', '沿一个轴展开对象，形成平面折叠效果。'],
    'fold-out': ['折叠退场', '沿一个轴收起对象，形成平面折叠效果。'],
    'flip-once': ['翻转一次', '通过轴向收放模拟一周翻转，显示原对象同一面。'],
    'grid-in': ['错峰进入', '多个选中元素按从中心向外的顺序依次进入。'],
    'grid-out': ['错峰退出', '多个选中元素按从中心向外的顺序依次退出。'],
    'pendulum': ['往返摇动', '围绕中心往返摇动，循环播放。'],
    'text-wave-once': ['逐字强调波', '字符依次缩放并恢复，保留原文本框。']
  };
  catalog.audit = catalog.effects.map(e => ({ ...e, status: retired[e.id] ? 'retired' : deferred[e.id] ? 'deferred' : 'native', reason: retired[e.id] || deferred[e.id] || '选区适配器与原生动画时序。' }));
  catalog.effects = catalog.effects.filter(e => !deferred[e.id] && !retired[e.id]).map(e => ({...e,
    name: descriptions[e.id]?.[0] || e.name, description: descriptions[e.id]?.[1] || e.description,
    native: { target: (e.id.startsWith('grid-') || e.id==='alternate-in') ? 'multiple' : e.mode === 'text' ? 'text' : 'element',
      kind: e.id === 'anvil' ? 'cloud' : ['number-roll','number-count'].includes(e.id) ? 'number' : 'native' }
  }));
})();
