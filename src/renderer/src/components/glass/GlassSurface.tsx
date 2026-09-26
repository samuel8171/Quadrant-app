import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import LiquidGlass from 'liquid-glass-react'
import { effectiveBlurPx, useGlassStore } from '../../lib/glassSettings'
import './glass.css'

/*
 * ============================================================ 玻璃浮层
 *
 * 对 liquid-glass-react 的一层薄封装。三处硬约束、一处架构性修正：
 *
 * ── 修正 · 材质必须由我们挂（2026-09-24 实测定位）
 *
 * 库把材质放在 `span.glass__warp` 上，而它是**库根节点（带 transform）的后代**；
 * 而带 transform 的元素在 Chromium 里是一个 backdrop root —— 后代的
 * backdrop-filter 只能采到"这个根节点自己画过的东西"，而库根节点
 * 背景全透明，于是材质采到一片空白、输出为零：所有弹窗全透明。
 *
 * 这不是版本限制，是结构问题。同一份材质、同一页面，单变量实测：
 *   挂在 .gs-anchor（无 transform）        → Δ74.87（活，能采到身后页面）
 *   挂在 .gs-panel 的后代                  → Δ4.53（只采到父级自己画的那点内容）
 *   挂在 .gs-panel 自己身上                → Δ0.00（死）
 *   顶掉 transform / 关掉 warp 的 filter / 藏 svg / 藏 mix-blend 元素
 *                                          → 仍全为 0.00（不是某个开关能救的）
 * 见 docs/probes/liquid-glass.md 与 tmp/glass-cause.mjs。
 *
 * 所以这里加一层 `.gs-plate`：位于锚点这一层（祖先链上没有任何 transform），
 * 尺寸取玻璃可见面的实测值，用负边距居中，**自己承载材质**，
 * 而库继续负责位移滤镜图、几何、内容层与镜面边。
 * 它是面板的**兄弟而不是祖先** —— 带 `backdrop-filter` 的元素同时是后代的
 * 包含块（与 `filter` 同规则），套在面板外面会把面板的定位基准整个改掉，
 * 还会形成"材质板尺寸 ← 可见面 ← 包含块宽度"的回路（两者都实测踩过）。
 *
 * **折射（位移滤镜）能生效，但写在 `backdrop-filter` 的 `url()` 里，不写在 `filter:` 上**
 * （2026-09-24 二次实测；上一轮记的"url() 被 Chromium 静默忽略"已作废）：
 *   · 写进 `backdrop-filter: url(#fid)` —— 实测**是渲染的**。判据带正对照：
 *     同一处 `!important` 覆盖只留 url() 与不覆盖 Δ0.000（覆盖无副作用），
 *     去掉 url() 则 Δmean 2.9/Δmax 11；直接把库里 `feDisplacementMap@scale`
 *     在 0 与 200 之间改（声明一字不动），模糊 16.8px 时 Δmax 10~16，
 *     **模糊 4px 时 Δmax 108、73.4% 像素变化** ⇒ 位移确实进了材质。
 *   · 挂成材质板自己的 `filter: url(#fid)` 则按规范让该元素成为 backdrop root，
 *     它的 `backdrop-filter` 随即采不到东西 ⇒ **材质整个消失**（分区逐位等于"无材质"）。
 *   即"位移只能走 backdrop-filter 的 url()，走 filter 会把材质掐死"。
 *   **折射可见度的真正杠杆是模糊量**：默认 blurAmount 0.4 = 16.8px，位移的对象
 *   已经是一片糊，效果只剩约 1/12；想看得见就把它降到 0.2 以下（设置面板已提示）。
 *   见 glass.css 的 `.gs-plate.gs-refract` 注释与 `tmp/settings-truth.mjs`。
 *
 * 位移滤镜 id 只能从库里"捞"：`GlassFilter` 未导出，但它是库根节点的子节点，
 * `svg > defs > filter` 就是它。捞不到就退化成纯磨砂（不会让弹窗再次透明）。
 *
 * ── 原有约束
 *
 * ① top/left 是**中心点**而不是左上角。
 *    库的 transform 硬编码 translate(-50%,-50%) 且不可覆盖。
 *    本组件不试图对抗它，而是把几何交给一个 0×0 的锚点（见 glass.css §一）。
 *
 * ② 内容层被内联了 `font: 500 20px/1 system-ui`。
 *    那套字体是给它自己的 demo 卡片用的，继承下来会把弹窗正文顶成 20px。
 *    统一由 `.gs-content` 重置。
 *
 * ③ 根节点尺寸必须等于玻璃体尺寸。
 *    根节点是绝对定位的 shrink-to-fit，尺寸由内容宽度决定，因此内容层
 *    必须有确定宽度（`contentWidth`）。宽度一漂，按根节点尺寸绘制的
 *    边框层就会与玻璃体错开。
 *    同一条尺寸也是材质板的尺寸来源 —— 没有它，材质板无从知道自己该多大。
 *
 * ④ **没有布局盒的宿主不挂载库**（2026-09-24「桌面端整窗空白」事故的修法）。
 *    库挂载时用 `getBoundingClientRect()` 量自己写进 `glassSize`；`display:none`
 *    下量到全零，而 `mode='shader'` 那一档会拿这个零去 `createImageData(0, ·)`
 *    抛 `IndexSizeError`。异常在 effect 里抛出、全应用没有错误边界 ⇒ React
 *    卸载整棵树 ⇒ 窗口一片空白。桌面端被 CSS 隐藏的底部 dock
 *    （`.gs-layer--dock { display: none }`，手机档才 display:block）正是那个
 *    零尺寸宿主，于是「把折射模式切成 Shader」会让桌面端从此打不开
 *    （设置还是持久化的，下次启动照旧）。闸门见 `laid`。
 *    这条同时也是常识性的：`display:none` 的宿主不该在后台跑一整套 SVG 滤镜链。
 *
 * 引擎分流：Chromium 走库（折射 + 库的镜面边），其余走纯 CSS 镜面边；
 * 两档的材质与染色现在**都由材质板统一提供**。
 */

/** 关掉指针跟随时喂给库的固定值。用模块常量：每次渲染都新建对象会让内部 effect 反复重挂 */
const NEUTRAL: { x: number; y: number } = { x: 0, y: 0 }

export interface GlassSurfaceProps {
  /**
   * 面板内容。可以不给——纯装饰性玻璃（如底部 dock 的材质层）只借它的外观，
   * 内容由浮在上面的既有元素自己排。
   */
  children?: ReactNode
  /**
   * 玻璃体**中心点**的视口坐标，CSS 长度值（如 `'50%'`、`'calc(100% - 45px)'`）。
   * 锚点因此可以取任意视口相对位置，不需要知道元件尺寸。
   */
  center: { top: string; left: string }
  /** 内容层宽度。必须是确定的长度，理由见文件头 ③ */
  contentWidth?: string
  /** 玻璃体内边距，默认 `16px` */
  padding?: string
  /** 定位层的类名，用来挂 z-index */
  layerClassName?: string
  /** 玻璃根节点的类名（`.modal h3` 这类后代选择器靠它生效） */
  panelClassName?: string
  /** 内容层的类名 */
  contentClassName?: string
  /**
   * 插在**定位层内部、锚点之前**的节点。
   *
   * 唯一用途：弹窗的遮罩。遮罩必须画在材质板**之前**（这样它才压暗材质采到的页面），
   * 但**绝不能是材质板的祖先** —— 遮罩为了压过事件卡必须带 `z-index`，那会形成一张
   * 合成面，把材质板的背景采样截在遮罩内部。实测（同一组条纹、同一块材质板）：
   *
   *   遮罩是祖先（层在遮罩里）  保留率 0.30  板内亮 24.9  ← 只糊到一点，且很暗
   *   遮罩是兄弟（放这一层里）  保留率 0.02  板内亮 45.1  ← 完全糊平
   *
   * 放在这一层里还顺带解决了嵌套弹窗：同一 `--gs-z` 时后挂载的层整棵压在先挂载的之上，
   * 内层遮罩才能把外层弹窗一起压暗（若把遮罩做成外层兄弟节点就做不到）。
   */
  layerPrefix?: ReactNode
  /**
   * 内容层的 ARIA role。
   *
   * 参数化而不是写死：库在内容层外面还套了自己的包装节点，role 必须落在
   * 真正承载子项的那一层上，`role="menuitem"` 才有合格的 `menu` 父节点。
   * 三处菜单都传 `menu`。
   */
  contentRole?: string
  /** 入场/退场动画。动画加在材质板上，见 glass.css §三 */
  anim?: 'in' | 'out' | 'none'
  /**
   * 是否启用指针跟随（弹性位移 + 高光追光）。
   *
   * **当前所有调用点都保持关闭**，且不该打开：材质已经搬到材质板上，
   * 而弹性位移动的是库自己的根节点——打开会让玻璃体跟着指针走、材质留在原地。
   * 要恢复这个效果，得把位移同时写到材质板自己的 transform 上（自己的
   * transform 不影响自己的 backdrop-filter，可行，但暂无需求）。
   */
  interactive?: boolean
}

export default function GlassSurface({
  children,
  center,
  contentWidth,
  padding = '16px',
  layerClassName = '',
  panelClassName = '',
  contentClassName = '',
  contentRole,
  anim = 'none',
  interactive = false,
  layerPrefix
}: GlassSurfaceProps): JSX.Element {
  const engine = useGlassStore((s) => s.engine)
  const mode = useGlassStore((s) => s.mode)
  const displacementScale = useGlassStore((s) => s.displacementScale)
  const blurAmount = useGlassStore((s) => s.blurAmount)
  const saturation = useGlassStore((s) => s.saturation)
  const aberrationIntensity = useGlassStore((s) => s.aberrationIntensity)
  const elasticity = useGlassStore((s) => s.elasticity)
  const cornerRadius = useGlassStore((s) => s.cornerRadius)

  const layerRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [filterId, setFilterId] = useState<string | null>(null)
  /**
   * 这一层当前有没有**布局盒**（也就是没被 `display:none` 掉）。
   *
   * 为什么必须问这一句：库在挂载时会 `getBoundingClientRect()` 量自己，
   * 把结果写进 `glassSize`。`display:none` 的子树上量到的是全零，
   * 而 `mode='shader'` 那一档会拿这个零去 `createImageData(0, ·)`
   * —— 直接抛 `IndexSizeError`。异常发生在 effect 里且全应用没有错误边界，
   * React 会卸载整棵树：窗口一片空白。桌面端被 CSS 隐藏的底部 dock
   * 正是这样一个零尺寸宿主（`.gs-layer--dock { display: none }`，
   * 手机档才 display:block），所以「把折射模式切成 Shader → 桌面端再也打不开」。
   *
   * 判据取 `getClientRects().length`，而不是量尺寸是否为零：
   *   · `display:none` → 没有盒子，返回 0 个矩形 → 不挂载；
   *   · 有盒子但恰好零尺寸（如 `.gs-layer--preview` 在某些包含块下）→ 返回 1 个
   *     零尺寸矩形 → 仍然挂载，因为库量到的是**真实布局值**而不是 0，
   *     只是数值小，不会触发上面那条异常。
   * 换句话说这里要的是「有没有布局」，不是「有多大」。
   */
  const [laid, setLaid] = useState(false)

  const animClass = anim === 'in' ? ' gs-pop-in' : anim === 'out' ? ' gs-pop-out' : ''

  /*
   * 断点不写成常量：显隐由 CSS 媒体查询决定（`.gs-layer--menu` / `--dock` 各写一次），
   * 在 TS 里再写一遍 767 就是同一个数字的第二处定义。这里只问 DOM
   * "这一层现在有没有布局盒"，CSS 依旧是唯一来源。比 `useEffect` 早一帧，
   * 因此不会出现"先挂载、再撤下"的一帧闪动。
   */
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const read = (): void => setLaid(layer.getClientRects().length > 0)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  /*
   * 量出玻璃「可见面」的尺寸喂给材质板。
   *
   * 量的目标是可见面而不是库根节点：根节点是块盒、内部装着一个 inline-flex，
   * 行盒的 half-leading 会让两者差几个像素；而材质板的圆角与染色必须与可见面
   * 严格对齐，错开就会露出"面板外面多一圈底"。
   * 库在 Chromium 档才渲染 `.glass`，降级档没有它，故退回根节点。
   *
   * **只能用 ResizeObserver 的 borderBoxSize，不能用 getBoundingClientRect()**：
   * 后者把祖先的 transform 算进去，而入场动画正跑在 `.gs-anim` 上 ——
   * 动画期间量到的是 scale(0.94) 之后的盒子（实测正好小 6.25%），
   * 动画一结束尺寸就不再更新，材质板会永久比玻璃小一圈。
   * ResizeObserver 报的是**布局**尺寸，与 transform 无关，没有这个问题。
   *
   * 量到 0 就不更新：display:none 的层（桌面端的 dock）会被报到 0×0，
   * 若照单全收，材质板会被钉死成零尺寸。
   */
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const face =
      host.querySelector<HTMLElement>('.glass') ??
      host.querySelector<HTMLElement>('.gs-panel, .gs-fallback')
    if (!face) return

    const ro = new ResizeObserver((entries) => {
      const bb = entries[0]?.borderBoxSize
      const first = Array.isArray(bb) ? bb[0] : bb
      // borderBoxSize 缺失时退回 offsetWidth/Height（同样是布局尺寸）
      const w = Math.round(first ? first.inlineSize : face.offsetWidth)
      const h = Math.round(first ? first.blockSize : face.offsetHeight)
      if (!w || !h) return
      setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    })
    // observe() 本身就会投递一次初始尺寸，不需要再手工量一遍
    ro.observe(face)
    return () => ro.disconnect()
  }, [engine, laid])

  /*
   * 捞库内部生成的位移滤镜 id。
   *
   * `GlassFilter` 未导出，但它是库根节点的子节点，`svg > defs > filter` 就是它。
   * id 由 `useId()` 生成，形如 `:r2:`；带冒号，所以引用时加了引号。
   * 拿不到就退回纯磨砂 —— 降级总好过让弹窗再次变成全透明。
   *
   * 依赖里必须有 `laid`：面板现在晚一帧才挂载（见上面的闸门），
   * 少了这一项，首帧那次运行会扑空（DOM 里还没有 svg），而 deps 没变、
   * 之后永不重跑 —— 结果是**折射静默失效，只剩纯磨砂**。
   * 本探针 `scripts/desktop-glass-cdp.mjs` 就是靠断言
   * "材质板的 backdrop-filter 含 url(" 抓出这条的。
   */
  useLayoutEffect(() => {
    if (engine !== 'chromium' || !laid) {
      setFilterId(null)
      return
    }
    setFilterId(hostRef.current?.querySelector('svg filter')?.id ?? null)
  }, [engine, laid, mode, displacementScale, aberrationIntensity])

  /*
   * 让库重新量一次自己的尺寸 —— 修「稳定后描边比玻璃体小一圈」（2026-09-24）。
   *
   * 库只在两个时刻 `getBoundingClientRect()` 量自己、写进内部的 `glassSize`：
   * ① 挂载；② window resize。而挂载那一刻，入场动画正跑在 `.gs-anim` 上，
   * 它带着 `scale(0.94)`；`getBoundingClientRect()` 是**把祖先 transform 算进去**的，
   * 于是 glassSize 被永久乘上 0.94。实测（`scripts/desktop-glass-cdp.mjs`）：
   * 弹窗玻璃体宽 468px，库内部记成 439.92px，比值精确等于 **0.9400**。
   *
   * 库那 6 层装饰（2 层底色 + 4 层镜面边）全部按 glassSize 定尺寸，所以稳定后
   * **镜面边缩在玻璃体里侧约 14px**；而入场动画期间材质板也停在 0.94，
   * 两者恰好重合 —— 这就是「折射/描边只在播放动画时看着对，一稳定就不对」的来源。
   *
   * 修法：动画一结束就替它触发一次 resize。`window` 上的 resize 监听是库自己
   * 注册的重测入口（公开契约，不是私有 API），我们只负责提供那个事件。
   *
   * 这里**故意不加"别的实例正在动画就先别发"的守卫**。那个守卫看起来更小心，
   * 实际更脆：模型是"谁结束谁发"，而每个带 in 动画的实例都会在自己结束时发一次。
   * 于是即便某次发的时机不巧、把另一个正在动画的实例量成了 0.94 倍，
   * 那个实例结束时会再发一次、把自己纠正回来 —— 结果自愈。
   * 加了守卫反而要判断"这个 running 的是不是我自己"，一旦判错就是静默失效。
   *
   * 顺序上也有个前提：库的重测 effect 在子组件里，React 先跑子再跑父，
   * 所以上面 `laid` 那条闸门与这里互不干扰。
   */
  useLayoutEffect(() => {
    if (anim !== 'in' || !laid) return
    // 显式取 HTMLElement：`Element` 的事件表里没有 `animationend`
    const el = hostRef.current?.querySelector<HTMLElement>('.gs-anim')
    if (!el) return

    const onAnimationEnd = (e: AnimationEvent): void => {
      if (e.animationName !== 'pop-in') return
      window.dispatchEvent(new Event('resize'))
    }

    el.addEventListener('animationend', onAnimationEnd)
    return () => el.removeEventListener('animationend', onAnimationEnd)
  }, [anim, laid])

  /*
   * 玻璃几何（尺寸 + 中心）定义在**定位层**上，不是材质板自己身上。
   *
   * 理由：同一层里还有别的浮层要读它 —— 弹窗遮罩要用这组数在自身上挖一个
   * "面板形状的洞"（虚化与染色只留在四周，见 theme.css 的 `.modal-mask`）。
   * 定义在层上，两处从同一个数出发；定义在板上，遮罩就只能再算一遍，迟早算歪。
   * 自定义属性会继承，材质板读到的值逐字不变。
   *
   * 中心用 `center` 原样写进来（`--gs-cx/--gs-cy`）：洞的位置必须跟着锚点走，
   * 这样将来出现非居中的浮层（贴底抽屉之类）也不用改遮罩的样式。
   */
  const layerVars = {
    '--gs-panel-w': box ? `${box.w}px` : '0px',
    '--gs-panel-h': box ? `${box.h}px` : '0px',
    '--gs-cx': center.left,
    '--gs-cy': center.top
  } as CSSProperties

  const plateStyle = {
    ...(filterId ? { '--gs-fid': `url("#${filterId}")` } : {}),
    // 首次量到尺寸前不显示：此时材质板是 0×0，露出来只会在错误的形状上闪一下
    ...(box ? null : { visibility: 'hidden' })
  } as CSSProperties

  const content = (
    <div
      className={`gs-content ${contentClassName}`.trim()}
      role={contentRole}
      style={{ '--gs-content-w': contentWidth } as CSSProperties}
    >
      {children}
    </div>
  )

  /*
   * 没有布局盒就整块面板都不渲染（连降级档一起）：
   * 库的零尺寸异常只是最严重的那条后果，隐藏宿主上跑一套完整的 SVG 位移滤镜链
   * 本身就是白花钱 —— 桌面端那条 `display:none` 的 dock 此前一直在跑。
   * 留在这里的只有这层空壳与材质板，两者都是零成本。
   */
  const panel = !laid ? null : engine === 'chromium' ? (
      <LiquidGlass
        className={`gs-panel ${panelClassName}`.trim()}
        // 取 0/0：几何由锚点承担，库只负责把自身中心对到锚点原点
        style={{ position: 'absolute', top: 0, left: 0 }}
        padding={padding}
        mode={mode}
        displacementScale={displacementScale}
        blurAmount={blurAmount}
        saturation={saturation}
        aberrationIntensity={aberrationIntensity}
        elasticity={interactive ? elasticity : 0}
        cornerRadius={cornerRadius}
        /*
         * 显式传外部鼠标位置会让库**跳过**它自己的 mousemove 监听。
         * 静态面板借此避开「每帧 setState → 整块滤镜重合成」这条开销链，
         * 而不是靠把 elasticity 设成 0 来掩耳盗铃（那样监听依然挂着）。
         */
        {...(interactive ? {} : { globalMousePos: NEUTRAL, mouseOffset: NEUTRAL })}
      >
        {content}
      </LiquidGlass>
    ) : (
      /*
       * 降级档的可见面。纯 CSS 镜面边 + 投影，**材质与染色不在这里**（在材质板上）：
       * 材质只有一处定义，两档不会因为各写一遍而慢慢走样。
       * displacementScale / aberrationIntensity / elasticity / mode 在此无效，
       * 设置面板会据引擎把这几项置灰并说明原因。
       */
      <div
        className={`gs-fallback ${panelClassName}`.trim()}
        style={
          {
            padding,
            '--gs-radius': `${cornerRadius}px`,
            '--gs-blur': `${effectiveBlurPx(blurAmount)}px`,
            '--gs-sat': `${saturation}%`
          } as CSSProperties
        }
        data-glass-engine="fallback"
      >
        {content}
      </div>
    )

  return (
    <div
      ref={layerRef}
      className={`gs-layer ${layerClassName}`.trim()}
      data-glass-engine={engine}
      style={layerVars}
    >
      {/*
       * 遮罩之类的"背景漆"：**必须在这一层之内、锚点之前**。
       * 它是材质板的**兄弟**（树序靠前 ⇒ 只会更靠下），不是祖先 —— 见 `layerPrefix` 注释。
       */}
      {layerPrefix}
      <div ref={hostRef} className="gs-anchor" style={{ top: center.top, left: center.left }}>
        {/*
         * 材质板：材质 + 染色 + 圆角，自己带入场/退场动画。
         *
         * 它是**面板的兄弟，不是祖先**，这一点是硬要求：
         * 带 backdrop-filter 的元素同时也是后代的包含块（与 filter 同规则），
         * 一旦把面板套在里面，面板的 top:0/left:0 就从"锚点原点"变成"材质板左上角"，
         * 整块面板会朝左上偏半格（实测 face 中心落在 plate 左上角）；
         * 而且会形成尺寸回路 —— 材质板尺寸取自可见面，可见面宽度又取决于包含块宽度。
         *
         * 定位只用 left/top + 负边距，**不用 transform 居中**（虽然元素自己的
         * transform 不影响自己的 backdrop-filter，但没必要引入这条依赖）。
         */}
        <div
          className={`gs-plate${filterId ? ' gs-refract' : ''}${animClass}`}
          style={plateStyle}
        />
        {/*
         * 动画包装层：0×0 的静态盒，正好落在锚点原点上。
         *
         * 为什么动画不能挂在锚点上：动画期间锚点带 transform，而它是材质板唯一的
         * 祖先 —— 材质板的 backdrop 会被抽干，弹窗会"先没有玻璃 200ms，再突然补上"。
         * 挂在这一层就只影响面板与库的装饰元素，动不到材质。
         * 它必须是静态盒：库的面板靠绝对定位 + 自身 translate(-50%,-50%) 居中，
         * 包含块一旦从锚点换成它，就必须保证自己也是 0×0 且无偏移（它确实是），
         * 这样动画前后原点不变，面板不会跳。
         */}
        <div className={`gs-anim${animClass}`}>{panel}</div>
      </div>
    </div>
  )
}
