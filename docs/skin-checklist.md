# 新皮肤开工前必读

Vesper 这套皮肤（2026-10-23 起，f1cd353 → 1a1177d）踩过的坑。每条写了现象、原因、正确做法；同一处改过好几次的，把前几次为什么不对也写上了。
主屏幕 PWA 的问题在 Safari 标签页里**看不出来**，凡是和高度、键盘、状态栏有关的，都要装到主屏幕上真机看。

---

## 〇、皮肤共用的视口代码（src/shell/）

键盘、可见高度、文档钉死、状态栏底色这些和皮肤无关的逻辑，放在 `src/shell/`，新皮肤直接用，不要再抄一份：

- `viewport.js`
  - `useVisibleHeight(ref)`：外框高度跟着 visualViewport，写 `--s-vh` / `--s-vtop` / `--s-full` / `--s-kb`，并给 html 挂 `v-lock`。
  - `useKeyboardOpen(set)`：输入框得到或失去焦点时，告诉你键盘开没开。
  - `keepAboveKeyboard(card)`：把输入卡片滚到键盘上方。
  - `usePageChrome(color, scheme)`：状态栏、html 底色和 theme-color。
- `viewport.css`：`html.v-lock` 文档钉死。
- `preventScroll.js`：`usePreventPageScroll(ref)`，不让 iOS 滚页面。
- `kbDebug.js`：键盘调试读数。
- `TabShell.jsx`：外框 + 底部 tab 栏。
  - `useTabShell()`：在皮肤组件最上面、锁屏判断之前调用。里面已经接好 `useVisibleHeight`、`useKeyboardOpen`、聊天面板的 `cc-panel` 广播、kbDebug。
  - `<TabShell shell prefix className tabs tab onTab subPage panelTab frameProps>`：画外框（带 `data-shell-frame`、钉在顶上）和 tab 栏，算 `tab-hidden` / `kb-open`。tab 栏类名按 `prefix` 拼（`v-tabbar` / `v-tab` / `v-tab-pill`）。

- `chat/`：聊天页，Clawd 和 Vesper 共用一份（以前在 App.jsx 里）。
  - `CcChat.jsx`：`CCChatPage`（状态、收发、SSE、键盘和面板三选一），还有菜单、查找、回复方式。图片缓存 `ccImageCache` / `fetchCcImage` 也在这里。
  - `ChatHeader.jsx`：顶栏（返回、名字和连接状态、⋮）。
  - `Turn.jsx`：列表里的一行。`CcTurn` 是他的一轮，`CcUserMsg` 是她的一条，只管画，动作都从 props 传进来。
  - `Composer.jsx`：输入栏、加号面板、表情面板；`useVoiceRecorder` 管按住说话和语音 / 键盘模式。
  - `PendingRow.jsx`：输入框上面待发的图和文件那一排（长按拖动排序）。
  - `useStickToBottom.js`：消息列表贴底（第 8 条），返回 `stickBottom`。
  - `voice.jsx`：语音气泡和播放。`markdown.jsx`：markdown 和复制。
  - 接口、草稿从 `../data.js` 拿；图标 `I`、左滑返回还在 App.jsx，从那里 import。这是循环 import：只能在函数里用，模块顶层不要碰这些名字，不然加载时是 undefined。
  - 界面文字靠 `CcLang`：Vesper 外面包 `CcLang.Provider value="en"`，整套换英文。
- `ImageLightbox.jsx` + `lightbox.css`：点开的大图（第 18 条），两个皮肤共用。`<ImageLightbox items index onClose>`，取图走聊天的 `fetchCcImage`（又是循环 import，规矩同上）。样式黑底全屏，不分皮肤，所以 CSS 也放在 shell 里。
- `sheets.jsx`：底部面板，逻辑在这里，样式在皮肤 CSS 里，类名按 `prefix` 拼（默认 `v`）。
  - `<ActionSheet title actions onClose>`：iOS 那种操作菜单（`{prefix}-sheet` / `-sheet-card` / `-sheet-title` / `-sheet-cancel`），带 `data-back`，左滑能关。
  - `<BottomSheet title left right onClose>`：New Event 那种表单面板（`{prefix}-modal {prefix}-bsheet` 和 `-bsheet-*`）。跟着 visualViewport 贴在键盘上方、不让 iOS 滚页面、聚焦时只滚面板自己（第 9 条），新皮肤直接用，别再抄一份。
- `data.js`：皮肤共用的数据和工具（以前在 App.jsx 顶上）。
  - 接口：`API`、`getPasscode`、`lockApp`、`apiFetch`（统一带口令，401 回锁屏）、`apiJson`（非 2xx 抛错）、MCP（`getMcpUrl` / `setMcpUrlStorage` / `mcpRequest`）。
  - 本地缓存：草稿 `getDraft` / `setDraftStorage`、每日一句 `getWhisperCache` / `setWhisperCache`、重要日期（`ensureImportantMigrated`、`fetchUpcomingImportant`、`getUpcomingImportantCache`、`importantFromEvent`）。
  - 日期：一律按北京时间（`SH_TZ`）。`shDateOf` / `shTimeOf`、`addDaysStr` / `daysBetweenStr`、`eventFirstDay` / `eventLastDay`、`beijingDateStr`、`predictNextPeriod`、聊天时间 `fmtMsgTime`。
  - 只依赖 `chat/CcChat.jsx` 的 `CC_CACHE_KEY`（`lockApp` 里清聊天缓存），不碰 App.jsx。组件（`LockScreen`、`ChatPage`、`DrawGuessGame`）、图标 `I`、左滑返回还在 App.jsx。

新皮肤要做的：
- 接口、缓存、日期工具从 `shell/data.js` 拿，别自己再写一份 fetch 或时区换算；
- 外框用 `TabShell`（不用的话：外框 `ref` 交给 `useVisibleHeight`，外框元素加上 `data-shell-frame`）；
- 按自己的路由算 `subPage` 传给 `TabShell`；
- 自己的 CSS 里写外框 `height: var(--s-vh, 100%)`、`top: var(--s-vtop)`；
- 自己的 CSS 里给 `ActionSheet` / `BottomSheet` 的类名写样式（照 `vesper.css` 的 `.v-sheet*` / `.v-bsheet*`）；
- `[data-kb-anim]` 时的 height 过渡、面板开着时外框不跟键盘缩，也写在自己的 CSS 里（Vesper 的写法见 `vesper.css` 开头）。

变量分三种：
- `--s-*` 布局变量：shell 给的，皮肤只读不写。安全区 `--s-top` / `--s-bottom`、键盘节奏 `--s-kbDur` / `--s-kbEase`（`viewport.css` 里挂在 `[data-shell-frame]` 上），高度 `--s-vh` / `--s-vtop` / `--s-full` / `--s-kb` / `--s-doc`（`useVisibleHeight` 写）。
- `--s-*` 主题变量：反过来，皮肤写、共用组件读。皮肤挂在包聊天页的那层上（Vesper 是 `.v-chat`，夜间跟着 `--v-*` 变）。共用规则一律写成 `var(--s-xx, Clawd 原值)`，Clawd 不设，样子就和以前一样；没写原值的那几个，不设时整条声明作废，等于没写（字体、颜色会继承，底色、圆角、毛玻璃回到默认的无）。目前聊天室有这些（App.css 里 `.cc-room` 那几条）：

  | 变量 | 管什么 | Clawd 不设时 | Vesper |
  |---|---|---|---|
  | `--s-meBg` / `--s-meInk` / `--s-meR` | 她的气泡底色、字色、圆角 | `--cc-user-bg` / `--text` / 18px | `--v-acc` / `--v-acc-ink` / 17 17 6 17 |
  | `--s-himBg` / `--s-himInk` / `--s-himR` | 他的气泡 | 无底 / `--text` / 无 | `--vc-his` / `--vc-ink` / 17 17 17 6 |
  | `--s-glass` | 他的气泡毛玻璃（backdrop-filter） | 无 | `blur(12px)` |
  | `--s-body` / `--s-title` | 气泡字体、顶栏名字字体 | 继承 | `--v-sc` / `--v-serif` |
  | `--s-bar` / `--s-barGlass` | 输入栏底色、毛玻璃 | `--bg` / 无 | `--vc-head` / `blur(20px) saturate(1.3)` |
  | `--s-field` | 输入框底色 | `--surface` | `--v-card` |
  | `--s-accent` / `--s-accentInk` | 发送键底色、箭头色 | `--text` / #fff | `--v-acc` / `--v-acc-ink` |

  间距、字号、尺寸这些不是主题，还留在皮肤自己的 `.v-chat` 规则里。往后一步一步把颜色类的覆盖换成变量。
  - 换之前先看清楚原来的覆盖是不是在"压"别的状态：比如 `.v-chat .cc-hold-btn` 的底色同时压住了 `.cc-hold-btn.recording`，`.v-chat .cc-composer-row .attach-btn` 的颜色压住了 `.attach-btn.active`。这种直接删掉覆盖、改读变量，Vesper 在那个状态下的样子就变了，要么连那个状态一起换成变量，要么先别动。
  - 每换一批，用计算样式比对：改前改后各抓一份聊天页所有元素的颜色、字体、圆角、位置（Clawd 浅 / 深、Vesper 白天 / 夜间四种），要求零差异。
- `--v-*`：Vesper 自己的颜色、字体、阴影，只挂在 `.vesper` 上。

## 一、高度和安全区

### 1. 主屏幕模式底部一条黑
- **现象**：装到主屏幕后，页面底下露一条黑，tab 栏下面空一截。Safari 里正常。
- **原因**：iOS 26 起，`black-translucent` 状态栏 + `viewport-fit=cover` 时，视口高度少算了状态栏那一截（WebKit 301108）。
- **走过的弯路**：
  - 2f03901 / afdee99：把里面的容器拉高（`screen.height`、`100lvh`）。iOS 不往少算的那条边外面画，tab 栏反而被截掉。
- **正确做法**（407ad70）：在 `src/index.css` 里把 html 撑到整屏：
  ```css
  @media (display-mode: standalone) { html { min-height: min(100lvh, calc(100% + env(safe-area-inset-top))) } }
  ```
  外框用 `height: var(--s-vh, 100%)`，跟着 html 走。
- **以后别做**：用 `100dvh`、`innerHeight`、或者把外框拉得比 html 高来铺满整屏。

### 2. 弹键盘时输入栏被挡、或者和键盘之间空一截
- **现象**：iOS 不缩页面，而是把整页往上推。顶栏被推出屏幕，输入框和键盘之间空一截，或者输入栏被键盘挡住。
- **第一次**（d4dba4c）：外框高度跟 `visualViewport.height` 走，再把页面滚回顶。方向对。
- **第二次的坑**（73b55a9）：判断“键盘开没开”时拿 `innerHeight` 比。主屏幕模式下 `innerHeight` 会跟着键盘一起变小，比不出来。
- **正确做法**：拿 `visualViewport.height` 和 **html 自己的高度**比（html 高度不随键盘变）。小了 150px 以上就算键盘开着：
  - 这时才设 `--s-vh`，同时记下 `--s-kb`（键盘高度）和 `localStorage.v_kb_h`；
  - 键盘收起后去掉 `--s-vh`，`--s-kb` 留着。
- 代码在 `src/shell/viewport.js` 的 `useVisibleHeight`。

### 2b. 键盘起落时整页跳（顶栏被挤到中间、列表先掉下去再弹回）
- **现象**：弹键盘时先白一帧，顶栏被整个往下挤到屏幕中间再回到位；收键盘时消息列表先掉到输入框下面再弹回来。
- **原因**：iOS 点输入框后，会自己去滚整个文档（或把 visualViewport 在 layout viewport 里挪开，`offsetTop > 0`）来露出输入框。我们同时又按 `visualViewport.height` 改外框高度，两边叠在一起。光靠 `html, body { overflow: hidden }` 拦不住，iOS 照样会滚。
- **正确做法**：
  - 文档钉死：挂上 Vesper 时给 html 加 `v-lock`，`body { position: fixed; top: 0; height: var(--s-doc) }`。
    - `--s-doc` 是量出来的 html 高度。不能写 `height: 100%`：fixed 的 100% 是视口高度，而 iOS 26 主屏幕模式下那个视口少算了状态栏，底下会又空一条黑（见第 1 条）。
  - `useVisibleHeight` 在同一个回调里做三件事：`scrollTo(0,0)`；外框 `top` 设为 `visualViewport.offsetTop`（`--s-vtop`）；高度设为 `visualViewport.height`。外框正好盖住看得见的那块，不留空白帧。这个回调同时挂在 `visualViewport` 的 `resize`、`scroll` 和 `window` 的 `scroll` 上。
  - 点输入框：`touchend` 里先 `preventDefault`，再 `focus({ preventScroll: true })`，iOS 就不会自己滚页面。只在还没聚焦时这么做，已经在打字时照常挪光标、长按选字。手指拖过（超过 10px）再松开的不算点，不聚焦。
  - **拦在前面，不要事后拉回**：光有上面这些，手指在顶栏、输入栏这些不能滚的地方一拖，iOS 照样会拖动整页，`scrollTo(0,0)` 再拉回来，这一来一回就是跳。照 react-aria 的 `usePreventScroll` 做（`src/shell/preventScroll.js` 的 `usePreventPageScroll`）：
    - 插一条 `@layer{*{overscroll-behavior:contain}}`：列表滚到头不把滚动传给页面。iOS 26 起这条要在 touchstart 之前就生效，所以写成 `<style>`，不要等手指按下再加。
    - `touchmove`（capture、`passive:false`）里，手指下面往上找不到真能滚的元素（overflow 是 auto/scroll，而且内容确实比框长）就 `preventDefault`。两指缩放、正在选字、在已经聚焦的输入框里拖都放行。侧滑返回、下拖收键盘是自己听 touchmove 的，`preventDefault` 不影响它们。
    - 点输入框的处理从聊天 textarea 挪到这里，所有能弹键盘的输入框都管；`HTMLElement.prototype.focus` 改成一律带 `preventScroll`，代码里调的 focus 也不滚页面。
    - 在 React 里要注意顺序：这里挂在 document 的 capture 上，比 React 的 `onTouchEnd` 先跑，focus 在 React 收到 touchend 之前就发生了。所以"她自己点了输入框、清掉 `swipeBlurAt`"要放在 textarea 的 `onTouchStart` 里，放在 `onTouchEnd` 里就晚了：下拖收键盘后 600ms 内她真点输入框，会被当成误聚焦再收掉。
    - 挂在哪：聊天页（`CCChatPage` 的 `roomRef`）、日历的底部面板 `BottomSheet`（New Event、纪念日）、日记页 `DiaryScreen`。只在带 `data-shell-frame` 的外框里才生效，几个同时开着只装一次，全关了才撤。新加带输入框的页面或弹窗，挂上 `usePreventPageScroll(ref)`。
    - 往上找"能滚的元素"时，碰到 `position:fixed` 那层就停。弹窗、底部面板是 fixed 的，但 DOM 上还挂在日历页里面；不停的话，在面板头上一拖找到的是底下的日历页，拖动会去滚面板后面那一页。
  - 不用 Telegram Web 那套：它现在在 iOS 上只锁 `html{position:fixed}`、高度按 `innerHeight`，以前的 visualViewport 改高度和"聚焦前把输入框挪到屏幕外"的办法都用 `&& false` 关掉了，键盘动画不跟。
  - 消息列表贴底沿用第 8 条的 ResizeObserver：列表高度一变，在画出来之前就把 `scrollTop` 补上差值，不用 smooth。没改成 `column-reverse`：现有的贴底已经够用，改了还会影响往上加载更早消息时的位置保持。
- 代码在 `src/shell/viewport.js` 的 `useVisibleHeight`、`src/shell/viewport.css` 的 `html.v-lock`、`src/shell/preventScroll.js`。
- **从一个输入框点到另一个，键盘状态闪一下**：先 focusout 再 focusin，键盘其实一直开着。`useKeyboardOpen` 以前在 focusout 50ms 后无条件判成"关了"，于是 `kb-open`、`tab-hidden` 掉一下，底部面板内容区的留白跟着变，内容先跳一下，然后才是 `reveal` 的平滑滚动。真机现象：New Event 里先点 Notes 再点 Location，先弹一下再滑。现在 50ms 后先看焦点是不是还在某个输入框上，在就不算关（`src/shell/viewport.js`）。
- **iOS 26 新坑**：收起键盘后 `visualViewport.offsetTop` 有时回不到 0，或者 `height` 一直偏小（[Apple 论坛 800125](https://developer.apple.com/forums/thread/800125)、[WebKit 254861](https://bugs.webkit.org/show_bug.cgi?id=254861)，iOS 27 beta 又有）。我们的外框跟着 `offsetTop` 走，卡住就整体往下偏。现在的处理：失焦后 100ms、600ms 各查一次，`offsetTop` 还大于 0 就 `scrollBy(0,-1)` 再 `scrollBy(0,1)` 推一下。2026-10-24 真机（iOS 26.5.2）上 offsetTop 一直是 0，没遇到，这段先留着。

### 2c. 下拖收键盘要顺
- **现象**：
  - 下拖时键盘开始退，输入栏卡在原位，中间空出一大块；
  - 键盘中途弹回来一下；
  - 最后 tab 栏突然出现，整页往上一顶。
- **原因**：
  - iOS 收键盘的过程中常常只在开头、结尾各发一次 `visualViewport` 的 `resize`，中间外框高度不变。
  - 收键盘后底部 tab 栏的位置 `--v-tbSpace` 是一下子从 0 变成 84px 的。
  - 列表还在动的时候，焦点会被弄回输入框。
- **正确做法**：
  - 列表上往下拖超过 10px 就 `blur`。不 `preventDefault`，列表滚动和松手后的惯性照常；一次拖动只收一次。
  - **不要逐帧读 visualViewport 去跟键盘**（这处改过 2 次）。
    - 以前的做法：输入框得到或失去焦点后，用 `requestAnimationFrame` 每帧读 `visualViewport`，按键盘露出的比例算外框高度。
    - 为什么不对：2026-10-24 真机（iOS 26.5.2，主屏幕模式）录了 6 次起落，动画途中一个中间值都没有。聚焦后约 70–80ms，`visualViewport.height` 在一帧里从 852 跳到 448；失焦后约 30–50ms 跳回 852，每次只发一次 `resize`（和 [WebKit 265578](https://bugs.webkit.org/show_bug.cgi?id=265578) 说的一样）。逐帧读只读得到两头，输入栏比键盘先到：弹出时先跳上去、底下露背景，收起时先掉下去、被键盘盖住。
    - 现在的做法：`useVisibleHeight` 发现外框高度一下变了 150px 以上，就给 `.vesper` 加 `data-kb-anim`，让 `height` 用过渡走过去，600ms 后去掉。时长、曲线是 `--s-kbDur` / `--s-kbEase`（.4s、`cubic-bezier(.3,.7,.2,1)`），tab 栏滑出滑回、`--v-tbSpace` 用的也是这一套，要调只改这两个变量。
    - 标记用 data 属性，不用 class：React 每次改 `kb-open`、`tab-hidden` 都会把整串 className 重写，同一时刻加上的 class 会被冲掉。
    - 没键盘时 `--s-vh` 写成整屏的 px，不要删掉回到 `100%`：过渡是 px 到 px，不跨单位。
    - 表情、加号面板开着时不过渡（JS 不加标记，CSS 用 `:not(:has(面板))` 再保险一层）：面板和键盘互换要在同一帧，输入框不动。
    - 键盘高度 `--s-kb` 照旧只在键盘停稳（高度比整屏少 150px 以上）时才记。
  - 顺带：这台机器上主屏幕模式的 `innerHeight` 一直是 852，不随键盘变；以前有的版本会跟着变小。所以判断有没有键盘一律拿 html 的高度比，不要用 `innerHeight`。
  - `--v-tbSpace` 用 `@property` 注册成长度，才能 `transition`，和 tab 栏滑上来用同一条曲线（.4s）。面板开着时不过渡，同一帧贴底。
  - 下拖收键盘之后 600ms 内冒出来的 focus 直接再 `blur`（`swipeBlurAt`）：在 focus 事件里同步 `blur` 有的浏览器不认，下一帧再补一次。她自己点输入框（`touchend`）会清掉这个标记。
- 网页里键盘做不到原生那样跟着手指拖，能做的是一滑就收、输入栏贴着键盘、列表不断。


### 3. 背景图跟着键盘、面板缩放
- **现象**：聊天背景是按外框高度铺的，键盘起落、面板开合时背景跟着变。
- **正确做法**（1a1177d）：`useVisibleHeight` 每次把 html 高度记成 `--s-full`，背景层的高度写死成它，超出部分被外框裁掉。键盘、面板变化时只有消息区在变。

---

## 二、状态栏

### 4. 状态栏颜色和字色（这处改了 6 次）
- **现象**：状态栏那条颜色和页面不接，或者白字压在浅色页面上看不清。
- **走过的弯路**：
  1. d4dba4c：各页用 `useTopColor` 报顶部颜色，改 `theme-color`。**主屏幕 App 的状态栏露的是 html/body 的底色，根本不看 theme-color。**
  2. ddc2051：按皮肤和日夜，在第一帧前用脚本改 `apple-mobile-web-app-status-bar-style`，不一致就重新载入一次。**iOS 只认 HTML 里写死的那一项，脚本改了没用。**
  3. e233587 / 33921eb / 340d379：状态栏颜色定成 Home 顶上的雾蓝，开屏从同一个颜色渐过去。iOS 多半只在打开那一刻取一次 html 底色，后面不跟着换，越改越乱。
  4. ae5688a：统一在 index.html 写死 `black-translucent`，页面画到状态栏底下。方向对了。
  5. 3f7bc05：觉得浅色页上白字看不清，加了一层暗色遮罩（StatusScrim）。**多余**。
- **正确做法**（47080ad）：
  - 状态栏在 index.html 写死 `black-translucent`，页面自己画到最上面，各自让出 `env(safe-area-inset-top)`。
  - 主屏幕模式下状态栏的字会**自己随背景变黑/白**，不要加遮罩。

### 5. 页面顶上的罩
- 首页顶部的暗色渐变加模糊、Calendar / More 的雾、Memory 地图顶上那层，都是为了让状态栏的字看得清才加的。状态栏会自己变色以后，这些全部去掉了（a43b754）。
- 新皮肤不要再加**带颜色的罩**。
- **但渐进模糊要留**（10/24 补回）：
  - 现象：罩去掉以后，Home / Calendar / More 往上滑，标题、卡片和状态栏的时间叠在一起，两层字都看不清。
  - 原因：a43b754 删罩时把模糊一起删了。模糊不是为了状态栏变色，是为了让滑上去的内容在状态栏那里糊掉。
  - 正确做法：一级页顶上一层 `.v-top-blur`（VesperApp 里统一放，二级页和聊天不放；聊天顶栏有自己的玻璃）。两层 backdrop-filter，上面那层更糊、先淡掉，**只模糊、不加颜色**。高度只到状态栏下 18px，页面在顶上时标题不被糊到（之前 Calendar 初始状态顶部被糊过）。
  - 以前为什么不对：33921eb / afdee99 是模糊加暗色或页面色的渐变，用户嫌是"罩"；a43b754 连模糊一起删了，又露出叠字。罩和模糊要分开看。

---

## 三、键盘上方那条工具栏

### 6. 键盘上方的工具栏（上下箭头、对勾）发黑
- **现象**：浅色页面弹键盘时，键盘上面那条工具栏是黑的。
- **原因**：那条是半透明的，透出来的是 html/body 的底色和 `color-scheme`。当时 Vesper 把 html/body/#root 写死成了开屏黑。
- **第一次**（47080ad）：`usePageChrome(color)` 按页面设 html/body/#root 的 background、colorScheme 和 theme-color。白天浅色页用 `#f1f3f7` + `color-scheme: light`，夜间和 Home 壁纸用深色。
- **第二次的坑**（a43b754）：从 Home 打开的日记、读书也是浅色页，但判断时还算在 Home 里，工具栏一圈黑。改成 Home 并且没打开子页（`!immersive`）时才用深色。
- **正确做法**：底色跟着**当前最上面那一页**的实际颜色走，包括从 Home 叠上去的子页。

---

## 四、键盘和面板

### 7. 键盘、表情面板、加号面板三选一
- **现象**：面板和键盘同时出现、叠在一起；切换时输入框跳上跳下，消息列表跟着跳。
- **走过的弯路**：
  1. ee8a060：面板高度 = `--s-kb`。点面板先收键盘；点输入框时等键盘真的升上来（visualViewport 缩小超过 100px，或者最多 600ms）再收面板。思路对，但键盘还在的时候加上面板，外框高度还是“键盘开着”的高度，面板把输入栏往上顶，等键盘退了又落回来。
  2. 7f20e50：嫌面板空，改成“高度跟内容走”（约 140px）。这样键盘和面板互换时输入框高度就不一样了，**作废**。
- **正确做法**（5e0281f）：
  - 面板高度 = 上次键盘的实际高度（`--s-kb`，含工具栏）。没记过时用 300px。
  - 面板开着时外框不跟键盘缩：`.vesper:has(.cc-attach-menu,.cc-emoji-panel){height:100%}`。
    - 从键盘切到面板：面板一开始就在键盘后面那块，键盘退下去正好露出来；工具栏跟着键盘一起退。
    - 切回键盘：键盘盖住面板升上来，升好了才收面板。
  - 面板开着时底部 tab 栏也收起，用 `:has()` 同一帧就生效，不等状态更新。
  - 关面板的方式：点消息列表、再点同一个按钮、在列表上手指往下拖（1a1177d）。
  - 加号面板按钮放大排成网格，照微信。

### 8. 输入栏变高变矮时消息列表跳
- **原因**：面板开合、待发图片那一排出现消失，都会改输入栏高度，列表没跟着补滚动距离。
- **坑**：一开始在挂载时拿 `listRef`，那时列表还没渲染（先有“加载中”那一屏），是 null，监听根本没挂上。另外 ResizeObserver 在后台标签页里不触发。
- **正确做法**（ee8a060）：用一个**不带依赖的 `useLayoutEffect`**，每次渲染后在绘制前对一下：贴底（没在看历史）时把高度差加回 scrollTop；换了列表元素就重新挂。键盘起落不经过渲染，交给 ResizeObserver。
- **收键盘后最后一条离输入栏远一截**（这处改过 2 次）：
  - 以前的做法：底部附近时把高度差 `d` 加回 scrollTop。
  - 为什么不对：收键盘时列表一帧帧变高。列表变高时，浏览器自己会把 scrollTop 夹回新的底部，再 `+= d` 就多往上退一截；最后一帧退的那截留了下来，最后一条离输入栏空出一块。真机截图上差不多空了一行，本地模拟 404px 的键盘、24 帧缓出，最后差 49px。
  - 现在的做法：变化前在底部 80px 以内的，一律直接钉到真正的底（`scrollTop = scrollHeight`），不按差值补。不在底部附近的（在看历史）不动。
  - 目标距离：最后一条消息（含时间那行）的底边离输入栏 14px，也就是消息自己的下边距。`.v-chat .messages` 底部 padding 是 0。
    - 怎么定出来的：真机截图对比，时间戳那行在三个位置——1634（贴着输入栏，太近，修之前补多了）、1557（真正滚到底，当时还有 14px padding，太远）、1590（她要的）。1590 恰好比真正到底少 14px：刚进聊天页那次其实没滚到底。
  - **刚进聊天页没滚到底**：先滚到底，之后中文网页字体、图片才到，上面的消息被撑高；Safari 不支持 `overflow-anchor`，scrollTop 不变，最后一条就被往下推。所以列表里每条消息也挂 ResizeObserver，停在底部（`stuck`，手指滚开 80px 以上才算离开）时内容一变就钉回底部。

### 9. 弹窗、底部面板、输入卡片被键盘挡
- **日历待办、日记 New page**：键盘升起后，把整张卡片滚到键盘上方 24px（`keepAboveKeyboard`，跟着 visualViewport 的 resize 对齐，最多 1 秒，再补两次兜底）。
- **New Event 改了三次**：
  1. 居中卡片（e233587）：键盘一弹，卡片被压扁，输入框变细，Notes 被切掉。
  2. 底部面板（9380f20）：高度跟 `--s-vh`。但 iOS 聚焦输入框时会滚动布局视口（`visualViewport.offsetTop` 不为 0），fixed 的面板还是被盖住。
  3. **正确做法**（7f20e50）：
     - 面板的 top / height 直接用 `visualViewport.offsetTop` / `height`，监听 resize 和 scroll。
     - 标题和 Cancel / Save 钉在顶上，下面在面板里滚。
     - 输入框 `flex-shrink: 0`，固定 44px。
     - 聚焦时**只滚面板自己的内容区**，滚到中间；不用 `scrollIntoView`，它会把底下的页面一起带着滚。
     - 键盘开着时底部多留 32px。
- Notes 原来是衬线体，和别的输入框不一致：底部面板里的 textarea 统一用无衬线体。

---

## 五、路由和导航

### 10. 二级页面隐藏底部 tab
- **正确做法**（9380f20）：在皮肤的根组件一个地方算 `subPage`，页面自己不管。收不收起由 `src/shell/TabShell.jsx` 统一算（`subPage`、键盘开着、聊天面板开着三选一），Vesper 的 `subPage` 是：
  - Home 里打开的日记、读书（immersive）；
  - More 里的每一页；
  - 聊天里的 menu / 查找 / 回复方式 / Usage（ChatPage 通过 `onSubPage` 报上来）。
- 二级页底部原来给 tab 留的 110px 改成 24px，内容延伸到安全区。
- tab 栏滑出时，距离要连阴影一起算（多 48px），不然底边还露一线阴影。
- 聊天页本身虽然有返回键，但它是 Chats tab 默认进入的那一页，所以保留 tab。

### 11. 返回
- 从屏幕左边缘往右划，按最上面那页的返回键（d4dba4c）。
- 一次只退一层：DOM 里最后一个返回键或关闭层就是最上面那层（a78c891）。
- 聊天里点开的 Usage，返回要回到聊天（33921eb）。
- **聊天页侧滑返回误触**（`useChatSwipeBack`）：
  - **现象**：长按选字、看大图、横滑待发的图时，常常一下就退回了列表。
  - **原因**：
    - 旧的 `useSwipeBack` 只看起点 x < 40、终点比起点多 80px，不看是不是竖着拖、是不是长按。
    - 看大图用的是挂在 body 上的 portal，但 React 的触摸事件会沿着组件树冒泡回聊天页，在大图上划也会触发返回。
  - **正确做法**：
    - 用原生监听，不走 React。只认从聊天页自己的左边缘 20px 内起手、往右横着的拖；用 `getBoundingClientRect().left` 算，因为电脑上页面是居中的。
    - 按住不动 400ms 算长按，这次不再当返回；正选着字时也不起手。
    - 这些时候不许起手：大图、录音、原地改消息、任何弹窗或底部面板开着时，以及从待发的图那一排上起手。
    - 键盘、表情面板、加号面板开着时可以返回，退之前先收起来。
    - 跟手拖：`touchmove` 非被动，在里面 `preventDefault`。拖过 35% 宽或者甩得快才退，不够就弹回。
- **聊天页右滑时壁纸不跟着走、从列表点进去直接闪出来**（Vesper）：
  - **现象**：
    - 右滑返回时，消息、输入栏跟着手指走，壁纸和蒙版留在原地。中间出现一条竖线，左边是没盖蒙版的壁纸，输入栏右半截被截掉。
    - 从对话列表点进沐，没有滑入，直接闪出聊天页。
  - **原因**：
    - 壁纸 `.v-chat-wall` 从一开始（44ebe0a）就放在 `.chatroom` 外面，是 Chat.jsx 里的兄弟元素。侧滑只给 `.chatroom` 加 `transform`，壁纸自然不动。1a1177d 只是把它的高度改成整屏，并没有引入这个问题。
    - `ChatPage` 是按 `view` 直接换组件：列表和聊天页不会同时存在，也从来没有写过进场动画。
  - **正确做法**：
    - 壁纸加 `data-swipe-follow`。`useChatSwipeBack` 的 `chatSlider` 把同一个 `translateX` 同时设到聊天页和它的同级跟随元素上；滑完把 `transform` 清空，壁纸回到按整屏固定（第 3 条不受影响）。
    - 拖动开始和滑入期间，`ChatPage` 在底下垫一份对话列表（`.cc-under`，`z-index:0`，壁纸是 1，聊天页是 1、排在壁纸后面）。弹回之后、滑入结束时再撤掉。
    - 滑入在 `useLayoutEffect` 里做：先放到右边，强制回流一次，再加过渡滑到 0。用 `useEffect` 会先在原位画出一帧，看起来还是闪。
    - 滑入只对传了 `slideIn` 的皮肤生效（Vesper）；Clawd 不传，行为不变。
    - `.v-chat` 要用 `overflow:clip`，不能只写 `overflow:hidden`。
      - **现象**：PR #45 上线后，从列表点进去，聊天页和壁纸整体往左偏出去一截，右边露出空白，而且一直停在那里。
      - **原因**：`overflow:hidden` 的盒子仍然能被程序滚动。滑入开始时聊天页在右边屏幕外，挂载时又会把最后一条消息 `scrollIntoView`。iOS 为了让它露出来，把 `.v-chat` 横着滚了过去；等聊天页滑回 0，`scrollLeft` 还在，整页就偏了。电脑上的 Chrome 复现不出来。
      - **正确做法**：`overflow:clip` 不是滚动容器，谁都滚不动它；外框 `.vesper` 早就这么写了。以后凡是会用 `transform` 把内容挪到外面的容器，都用 `clip`。


---

## 六、聊天

### 12. 连接状态不要插进消息列表
- **现象**：消息列表底下的 “● Connecting…” 一出一收，列表滚两次。
- **之前**：d4dba4c / ddc2051 先放在输入框上方，后来挪出输入栏，还是会推动列表。
- **正确做法**（a43b754）：放在顶栏名字右边，7px 圆点，绝对定位，名字不动、列表不动。
  - 连接中：黄色，呼吸；
  - 连上：绿色，3 秒后淡出；
  - 断开：暗红。

### 13. 气泡
- **字号行距**：两边统一用她的气泡那一套（14.5px / 1.55）。Soren 原来比她大一号（15.5px / 1.7–1.85）。
- **Soren 的气泡**：
  - 宽度跟内容走（`fit-content`，最多 80%）；
  - 半透明底（浅色 / 深色都是 .45）加 `blur(12px)`；
  - 内边距、圆角和她的对称；
  - 段落间距 .45em。
- **壁纸上的可读性**：壁纸上盖一层纯色（浅色 rgba(255,255,255,.42)，深色 rgba(10,14,24,.45)），不要用渐变。
- **出现动画**：
  - 原来是逐段只改透明度。加了气泡底以后，变成底先弹出来、字再淡入。
  - 正确做法：新的一轮**整个气泡**一起淡入（opacity 0→1 + translateY 6px→0，350ms ease-out），第一段跟着气泡出现、自己不再播。
  - 后到的段落用同样的淡入。播过的记进 `ccRevealed`，重新挂载时不再闪。

### 14. 代码块
- 长行原来不换行，超出屏幕的部分被截掉。
- 气泡里的 `pre`：`white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere`，不横向滚动，宽度不超过气泡，字号 12.5px。
- Copy 复制的是原文，换行不影响。

### 15. 中文衬线字体的细节
- **省略号**：Noto Serif SC 的 … 是竖直居中的中文写法。所有用它的地方（气泡、输入框、正文）都换成西文字形，让它落在基线上（e233587）。
- **输入框提示字偏下**：这个字体上沿留得高，西文的提示字会偏下。没字的时候整体往上挪 2px（33921eb）。
- **Whisper 卡片**：不要用 `text-wrap: pretty`，iOS 上会提前换行，留一大块空白（ddc2051）。

### 16. 草稿和待发的图
- 图和文件是 Blob，放不进 localStorage。存 IndexedDB（`draftFiles.js`），张数另记一份到 localStorage，聊天列表同步就能读到。
- 发送失败的那条，离开页面时连图带文件放回草稿。
- 待发的图长按 300ms 拿起来拖动排序，发送和草稿都按这个顺序。
- 待发的图右上角的叉：看得见的圆 20px，往里缩 4px；外面一圈 32×32 透明的点按区，整个放在缩略图里面。
  - 不能挂在角外面：`.cc-pending` 是横向滚动容器，超出的部分（连同点按区）会被裁掉。
  - 按在叉上不会起拖动，因为拖动逻辑跳过 `button`。
  - iOS 会把拖动当成横向滚动接走，然后发 pointercancel。要用**非被动的 touchmove** 去 preventDefault 才拦得住。
- 表情：系统 emoji 面板已撤掉，现在是空面板（“Stickers are on the way”），以后放自己的表情包。

### 16b. 一次发多张：上限、进度、单张重试
- 上限只有一个来源：VPS 上 `/opt/mu-bridge/file_types.json` 里的 `max_items`。前端（`CC_MAX_ITEMS_FALLBACK`）和后端的数字只是拿不到这个文件时的兜底，**只改前端没用**。
- 一张一张排队传，不能并发：后端会把整份读进内存再转给 VPS，一起传会把 Render 的内存顶满。
- 上传要用 XHR，不能用 fetch：fetch 拿不到上传进度（`ccUploadForm`）。进度到 95% 就停住，因为剩下的时间是在等后端转给 VPS。
- 一张失败了接着传后面的，不要整条中断。每张的状态记在临时消息的 `up` 上：`{ pct }` 正在传，`{ failed }` 没传上，`null` 传完了。
  - 点那张图上的重试，只重传那一张（`deliver(msg, key)`）；全部传上去以后才真正发出这条消息。
  - 已经传上去的记在 `uploadedRef` 里，重试时不再传。
- 超过 4 张缩成 84px，免得一条消息占好几屏。

### 17. 多图发送：一张变成 `[Image #N]`、消息重复、来源标成 “From Claude App”（mu-bridge PR #18）
- **现象**：
  - 一次发两张图加多行文字，其中一张图在 Claude Code 里变成 `[Image #8]` 文字；
  - App 里多出一条一样的消息，来源标成 “From Claude App”。
- **原因**：
  - bridge 用 tmux 把整段文字（图片路径加多行正文）一次打进 Claude Code。
  - 多行内容会被 Claude Code 当成粘贴（bracketed paste），粘贴里的图片路径被换成 `[Image #N]` 附件。
  - 随后 bridge 拿 Claude Code 记下的提示和自己打过的 `typed.jsonl` 做比对（`typedByBridge` / `foreignPrompt`）。两边文字已经不一样，比不上，就当成别处来的，重新记了一条 `via=app`。
- **正确做法**：
  - `typeIntoMuNow`：第一行用 `send-keys -l` 逐字打，从第一个换行起的部分用 `paste-buffer -p`（`splitForTyping`）。
  - 比对时，提示里有 `[Image #N]` 的话，两边都去掉图片部分再比（`dropImages`、`sameTyped`）。
  - 那条重复消息在 inbox 里删掉（删之前先备份）。

### 18. 图片查看器
- **现在的做法**（5e0281f / 1a1177d）：
  - **打开**：从缩略图的位置 FLIP 放大，300ms ease-out。缩略图是裁成方块的，用 `clip-path: inset()` 一起动画去掉裁切。背景从透明渐黑。先用已经加载好的缩略图做动画，原图到了无缝换掉。尺寸按原图比例 contain 算好写死，不然小缩略图不会放大，原图一到就跳。
  - **关闭**：单击要等 250ms 确认不是双击；往下拖时跟手缩小、背景变淡，拖超过 110px 或快速一甩就关，不够就弹回；关的时候缩回缩略图，缩略图不在屏幕上就原地缩小淡出。
  - **缩放**：双指捏合，最大 4 倍，松手小于 1 倍弹回；双击在点的位置放大 2 倍，再双击还原；放大以后单指拖着看，这时不翻页、往下拖也不关。
- **捏合缩不回来的坑**：
  - `touch-action` 只往上算到最近的滚动容器（横向翻页那条 track），所以只写在外层不管用，图那一层也要写。
  - iOS 不认 `user-scalable=no`：双指、放大了、正在下拉这三种情况下，要自己拦 `touchmove` 和 `gesturestart`。
- **其他**：
  - 查看器要挂到 body 上（portal），不然被 tab 栏压住。
  - 聊天里点开时，聊天里所有的图排成一组左右滑（scroll-snap）。

---

### 18b. 往上翻加载历史时位置跳
- **现象**：聊天页滑到顶加载更早的消息，加载中整列先往下掉一截，加载完也不停在原来看的那条，每次偏得不一样。
- **原因**：
  - 开始加载时记 `scrollHeight`，插入后 `scrollTop = scrollHeight - 旧 scrollHeight`。这默认插入前 `scrollTop` 是 0，可触发时（`scrollTop < 80`）可能是几十 px，等请求那 0.x 秒手指和惯性也还在滑，这些全丢了。
  - 加载中顶上插一行 `Loading…`（`.empty-state`，约 98px），一出现就把整列往下推。Safari 不支持 `overflow-anchor`，浏览器不会替你补。
  - `'keep'` 模式补完不清，之后他回话、三个点亮灭，又按旧的高度再补一次，人在看历史也被拽走。
- **正确做法**（`src/shell/chat/CcChat.jsx` 的 `loadOlder` / `ccListAnchor`）：
  - 数据回来、插进去之前那一刻记锚点：屏幕顶上那一带的消息行（`data-mids`）和它离列表顶的距离。这时 DOM 还是插入前的样子，`scrollTop` 也是最新的。
  - 跳过列表第一行：更早的话可能和它是同一轮（`ccRows` 会把他连着的几段并成一行），并进去后这一行的顶会往上撑。
  - 插入后在 `useLayoutEffect` 里（画出来之前）找到同一行，`scrollTop += 现在的距离 - 原来的距离`。补完把模式改成 `'stay'`，之后的更新不再动位置。完全手动算，不靠 `overflow-anchor`。
  - 甩到顶时 iOS 在回弹（`scrollTop` 是负的）：这时直接改 `scrollTop`，下一帧会被回弹动画盖回负数，屏幕闪到刚插进来的最老那几条，那一帧 `scrollTop < 80` 还会多拉一页（真机读数 `scrollTop -44→7530 · drift 0/7571/0`，后面紧跟一次多余的加载）。
    - 第一次修（PR #51）：插入时 `overflow-y: hidden` 把回弹停掉再设。位置对了（drift 0/0/0），但回弹被掐断，手上明显顿一下。
    - 现在的做法：数据到了先看列表停稳没有。回弹中（`scrollTop < 0`）或手指还按在列表上，就先拿在手里、顶上照样显示 Loading，每 50ms 看一次，弹完、松手再插。插的时候列表是静的，按锚点补就准，不用掐断任何东西。停掉回弹那段只留作兜底（等的那一下又甩回顶上之类）。
    - 离顶还有一屏（`clientHeight`）就开始拉，往上翻得不太快时数据在碰到顶之前就到了，根本不进回弹。
    - 补完下一帧不要再"复核、差了就再补"：那一帧手指、惯性自己走的距离会被当成偏差拽回去。复核只在停掉了回弹的兜底那条路上做。
  - 还有更早的（`hasMore`）就在顶上一直占一格 `.cc-older`（固定 44px），加载时只换里面的字。最后一页拿掉这格和插入在同一次渲染里，一起补回。
  - 聊天里的图一律是固定大小的方块（`.cc-thumb` 120×120，多张 84×84），加载中、过期占位同尺寸。别改成按原图比例撑高：后端没给宽高，图到了才撑开就会把上面的消息顶走。
  - 真机读数：键盘调试读数开着时（聊天顶栏名字连点 5 下），每次加载完记一行 `older: moved … · waited 等停稳的毫秒 · drift 当帧/下一帧 · then 之后 300ms 列表自己又走了多少`。drift 都该是 0（1 是亚像素取整）；`then` 不是 0 说明惯性没被打断。
- **以前为什么不对**：按 `scrollHeight` 差值补只在 `scrollTop` 正好是 0、加载期间没人动时才对；Chrome 上有 `overflow-anchor` 兜着看不出来，只在 iPhone 上跳。

## 七、开场和数据

### 19. 开场和数字跳动
- **开场**：字体（样式表加首页用到的几种字重）和壁纸都到了才淡出，至少 1.25 秒，最多 4 秒。字体和壁纸在 index.html 里就开始下，不等 React。
- **数字跳动**：
  - **现象**：日记数量、sealed、倒计时、More 格子上的小字，从 0 或空白跳到真实值；切到 More 时又跳一次。
  - **正确做法**（1a1177d，`src/vesper/data.js`）：
    - 开场时一起取首页、More、Usage 要用的数据，全到或者最多 3 秒就结束开场。
    - 每份存 `localStorage.v_cache_*`，下次先用缓存画。
    - 取到新值时和缓存比，真的变了才更新。
    - 页面一律用 `useCached(key)`，不要自己 `useState([])` 再去取。

### 20. 背景图加载
- 壁纸用 WebP。index.html 里预加载；用 Service Worker 缓存，先拿缓存立刻出图，后台再去服务器对一次（服务器给的是 `max-age=0`）。
- 越往下越糊的效果：事先把 3/8/16/30px 的模糊烤进小图，手机上不用每帧现算（a78c891）。

---

## 开工前自查

- [ ] 装到主屏幕上，在真机上看：底部没有黑条，tab 栏完整。
- [ ] 浅色页面弹键盘：上方那条工具栏不黑。
- [ ] 键盘 ⇄ 面板来回切：输入框不动，列表不跳，两者不重叠。
- [ ] 每个带输入框的弹窗：键盘弹起时输入框完整可见。
- [ ] 每个二级页：tab 收起，内容到底。
- [ ] 打开 App、切 tab：数字不跳。
- [ ] 聊天往上翻好几页（包括最后一页）：原来看的那条不动，加载中不往下掉。
- [ ] 图片查看器：打开和关闭有动画，捏合能缩回。
- [ ] 聊天里弹键盘、收键盘各两次：顶栏和背景不动，最后一条消息贴着输入框，没有空白帧。
- [ ] 一次发 20 张：逐张显示进度，断网让其中一张失败，点它能单独重传。
- [ ] 聊天里只有从左边缘起手才能侧滑返回；长按选字、看大图、横滑待发的图都不会退。拖一半松手会弹回。
- [ ] 从列表点进聊天：从右边滑进来，壁纸一起动。右滑返回：壁纸和蒙版跟着走，左边露出对话列表，没有竖线；滑完弹键盘，背景不缩放。
- [ ] 下拖收键盘：输入栏贴着键盘往下走，tab 栏同时滑上来，键盘不弹回。
- [ ] 键盘开着时，手指在顶栏、输入栏、气泡上下拖：整页一点不动；消息列表照常滚，滚到头不带着页面走。New Event 面板、写日记时也一样，面板头上拖不会带着后面那页滚。
- [ ] 下拖收起键盘后马上再点输入框：键盘正常弹出，不会被收回去。
- [ ] 收起键盘后，最后一条消息和输入栏的距离跟刚进聊天页时一样，不远也不近。
- [ ] New Event 里 Notes ⇄ Location 来回点：两个方向都只有一次平滑滚动，不先跳一下。
- [ ] 量键盘：`src/shell/kbDebug.js` 的读数（聊天顶栏名字 2 秒内连点 5 下）看新机型、新 iOS 版本键盘起落有没有中间值（`N mid values`），有的话可以考虑改回逐帧跟。
