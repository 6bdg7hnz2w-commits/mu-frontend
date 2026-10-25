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
  | `--s-accent` / `--s-accentInk` | 发送键底色、箭头色；他那边语音条（`.voice-bar`）底色、字色；加号键选中（`.attach-btn.active`）的颜色 | 发送键 `--text` / #fff，语音条 `--accent` / #fff，加号键选中 `--text` | `--v-acc` / `--v-acc-ink` |
  | `--s-meBg` / `--s-meInk`（再用一次） | 她的语音条（`.cc-voice-bar`）底色、字色，和她的气泡同色 | `--cc-user-bg` / `--text` | 同上 |
  | `--s-meta` / `--s-metaShadow` | 小字：时间、复制 / 编辑 / 重发 / 转文字按钮（`.msg-meta` 里的）、思考过程和工具那行、`cc-msg-note`、`cc-late`、语音转的文字和语气；打字中的三个点的底色也用 `--s-meta` | 各自原来的 `--text-dim` / `--text-secondary` / `--text`，阴影无 | `--vc-meta` / `--vc-meta-shadow` |
  | `--s-icon` | 输入栏左边那排图标键（`.cc-composer-row .attach-btn`）没选中时的颜色 | `--text-secondary` | `--v-mute` |
  | `--s-card` / `--s-ink` | 回到底部键（`.cc-jump-btn`）的底色、图标色 | `--surface` / `--text-secondary` | `--v-card` / `--v-ink` |
  | `--s-recBg` / `--s-recInk` / `--s-recRing` | 按住说话键录音中（`.cc-hold-btn.recording`）的底、字色、描边 | `--cc-user-bg` / `--text` / 无（边框是 `--text-secondary`） | 主色淡底叠在 `--v-card` 上 / `--v-acc` / 1px 主色内描边 |
  | `--s-cancelBg` / `--s-cancelInk` / `--s-cancelRing` | 上滑取消（`.cc-hold-btn.cancel`） | 淡红 / #d94444 / 无（边框 #d94444） | `--v-danger` 淡底叠在 `--v-card` 上 / `--v-danger` / 1px 内描边 |
  | `--s-fileBg` / `--s-fileLine` / `--s-fileR` / `--s-fileShadow` | 她发的文件（`.bubble.cc-file`）底色、边框、圆角、阴影；`--s-fileR` 也管文件上的上传罩（`.cc-files .cc-up`） | 和她的气泡一样（`--s-meBg` / 无 / `--s-meR`）/ 无；上传罩 12px | `--v-card` / 1px `--v-line` / 16px / `--v-shadow` |
  | `--s-thumbR` / `--s-thumbShadow` | 图片缩略图（`.cc-thumb`）和上面的上传罩（`.cc-up`）圆角、缩略图阴影 | 12px / 无 | 14px / 淡阴影 |
  | `--s-meVoiceR` / `--s-voiceShadow` | 她的语音条圆角；两边语音条的阴影（他那边圆角两个皮肤一样，18 18 18 6，没设变量） | 18px / 无 | 18 18 6 18 / 淡阴影 |
  | `--s-foldBg` / `--s-foldInk` / `--s-foldRule` / `--s-foldR` / `--s-foldShadow` | 展开的思考过程、工具列表（`.cc-thinking-body` / `.cc-tools-body`）：底、字色、左边那条线、圆角、字的阴影 | 无 / 思考 `--text-secondary`、工具继承 / 2px `--border` / 无 / 继承 | `--vc-glass` / `--v-ink2` / 0 / 12px / none |
  | `--s-toolInk` / `--s-toolAlpha` | 工具那行后面的文件名、失败（`.cc-tool-sum` / `.cc-tool-fail`） | `--text-dim` / 不透明 | `currentColor`（跟 Read 同色）/ .82 |
  | `--s-noticeR` | 聊天里的提示条（`.cc-notice`）圆角 | 10px | 12px |

  对话列表（App.css 里 `.chatlist-page` / `.session-*`）也读这一套，Vesper 同样挂在 `.v-chat` 上：

  | 变量 | 管什么 | Clawd 不设时 | Vesper |
  |---|---|---|---|
  | `--s-title` / `--s-body` / `--s-ui`（再用） | 整页字体 / 预览字体 / 时间字体 | 继承 | `--v-serif` / `--v-sc` / `--v-sans` |
  | `--s-rule` | 标题下面那条线 | 无 | 1px `--v-line` |
  | `--s-card` / `--s-cardLine` / `--s-cardR` / `--s-cardShadow` | 会话卡片底色、边框、圆角、阴影 | `--surface`（置顶 `--pinned-bg`）/ 无 / 14px / 淡阴影 | `--v-card` / 1px `--v-line` / 20px / `--v-shadow` |
  | `--s-avatarBg` / `--s-avatarR` | 头像方块 | `--card` / 12px | `--v-cover` / 16px |
  | `--s-mute` / `--s-ink2` / `--s-draft` | 时间、预览、草稿预览的字色 | `--text-dim` / `--text-secondary` / `--accent` | `--v-mute` / `--v-ink2` / `--v-ink2` |

  查找页（App.css 里 `.cc-search-*`）也读这一套：搜索框、结果卡片的底色 / 边框 / 阴影跟会话卡片用同一组 `--s-card` / `--s-cardLine` / `--s-cardShadow`，小字用 `--s-mute`，结果正文用 `--s-body` / `--s-ink2`，输入框字色用 `--s-ink`。另外加了：

  | 变量 | 管什么 | Clawd 不设时 | Vesper |
  |---|---|---|---|
  | `--s-input` | 搜索框里输入的字体 | 继承 | `--v-scIn` |
  | `--s-press` | 按住一条结果时的底色（`.cc-search-hit:active`） | `--card` | `--v-card`（不变色） |
  | `--s-whoBg` / `--s-whoInk` | 结果上"Me / Soren"那个标签 | 无底 / `--text` | `--v-acc-soft` / `--v-acc`（小胶囊） |
  | `--s-fromBg` / `--s-fromInk` | 出处标签（Thinking 之类） | `--accent-light` / `--accent` | 无底 / `--v-mute`（只是一行淡字） |
  | `--s-markBg` / `--s-markInk` | 命中的词 | 无底 / `--accent` | 淡粉底 / `--v-ink` |

  结果卡片 Clawd 只有底下一条线，Vesper 是四边框：写成 `border:var(--s-cardLine);border-bottom:var(--s-cardLine,1px solid var(--border))`，不设时四边清掉、底边兜回原来那条线。`.cc-search-hit:active` 原来被 Vesper 的卡片底色压着（同特异性、vesper.css 在后），所以单独给了 `--s-press`。"没找到 / 搜索中"用的是公共的 `.empty-state`，还留在 vesper.css 里。

  回复方式页（App.css 里 `.cc-brain-*`）：提示、选项副标题、开关上的字用 `--s-mute`，选中的那边用 `--s-ink`；字体用 `--s-body` / `--s-ui` / `--s-title`；选项之间的线用 `--s-rule`；测试键和卡片一样（`--s-card` / `--s-cardLine` / `--s-cardShadow` / `--s-ink`）；勾用 `--s-accent`。另外加了：

  | 变量 | 管什么 | Clawd 不设时 | Vesper |
  |---|---|---|---|
  | `--s-track` / `--s-knob` / `--s-knobShadow` | CC / API 开关的底、滑块、滑块阴影 | `--cc-switch-track` / `--cc-switch-thumb` / 原来的阴影 | `--v-card2` / `--v-card` / 淡阴影 |
  | `--s-faint` | 选项下面那行模型名（`.cc-brain-row-model`） | `--text-dim` | `--v-faint` |
  | `--s-ok` | 测试成功那行字 | `--green` | #5d9b7a |

  这一页的选项、开关上的字、测试键都是 `<button>`，读变量的那几条都挂在 `.cc-brain-page` 下（同 `.vesper button` 那条坑）。带模型名的选项（`:has(.cc-brain-row-model)`）Vesper 换了字体和字号，那三条是排法，还留在 vesper.css。

  Vesper 以前的预览字色（`.v-chat .chatlist-page .session-preview`）把 `.draft` 的高亮也压住了，所以草稿在 Vesper 下和普通预览同色。改变量时单独给了 `--s-draft`，保持原样；想让草稿高亮，改 Vesper 的 `--s-draft` 就行。

  聊天壁纸和弹窗蒙版（6h）：壁纸是 `src/shell/chat/ChatWall.jsx`（`<ChatWall src=... />`，一张照片 + 一层纯色蒙版，带 `data-swipe-follow`，右滑返回时跟着走），铺法在 `shell/chat/wall.css`；弹窗蒙版在 `shell/sheets.css`，`ActionSheet` / `BottomSheet` 的外层带 `data-scrim`，皮肤自己写的居中弹窗（Vesper 日历的 `.v-modal`）也加上 `data-scrim` 就行。皮肤的 CSS 里不要再给这几层写 `background`。

  | 变量 | 管什么 | 不设时 | Vesper |
  |---|---|---|---|
  | `--s-wallBase` / `--s-wallF` / `--s-wallVeil` | 壁纸底色（图没出来时）、照片滤镜、照片上那层纯色蒙版 | 透明 / 无 / 透明 | `--vc-base` / `--vc-f` / `--vc-veil`（白天、夜间不同） |
  | `--s-scrim` | 弹窗、底部面板底下那层 | `rgba(0,0,0,.4)` | `rgba(10,14,24,.4)` |
  | `--s-scrimSheet` | 操作菜单（`ActionSheet`）底下那层 | `--s-scrim` | `rgba(10,14,24,.34)` |

  Clawd 的聊天没有壁纸，弹窗还是 App.css 里自己的 `.modal-overlay` / `.nook-sheet-overlay`，没换。

  按住说话键平时的底色读 `--s-field`（和输入框一样）。Vesper 的 `.vesper button` 把边框清成 0，所以描边用 inset box-shadow 画，按钮尺寸不变；淡色要叠在卡片色上（`linear-gradient(淡色,淡色),var(--v-card)`），直接用半透明色会透出输入栏后面的东西。

  间距、字号、尺寸这些不是主题，还留在皮肤自己的 `.v-chat` 规则里（比如展开的思考 / 工具的内边距 10px 12px）。加号面板、表情面板 Vesper 是另一种排法（一格一格的大按钮、占键盘的位置），整块布局都在 `vesper.css`，不走变量。
  - 想让某个属性"跟着父元素"（Vesper 的工具文件名跟 Read 同色），变量里写 `currentColor`，不能写 `inherit`：`--x:inherit` 是让这个变量自己去继承，不是把 inherit 这个值传下去。`color:currentColor` 算出来就是父元素的颜色。
  - 没有原值兜底的变量，放进特异性更高的规则里要小心：不设时这条声明照样赢，等于把属性清回默认。所以她的文件气泡那条（`.cc-room .msg.user .bubble.cc-file`，比她的气泡那条高）底色、圆角要兜回 `--s-meBg` / `--s-meR`，只有原来就没有的边框、阴影才能不写兜底。
  - 换之前先看清楚原来的覆盖是不是在"压"别的状态：比如 `.v-chat .cc-hold-btn` 的底色同时压住了 `.cc-hold-btn.recording`，`.v-chat .cc-composer-row .attach-btn` 的颜色压住了 `.attach-btn.active`。这种直接删掉覆盖、改读变量，Vesper 在那个状态下的样子就变了，要么连那个状态一起换成变量，要么先别动。（6c 把加号键连 `.active` 一起换成了变量；按住说话键的录音 / 取消状态以前在 Vesper 下被压没了，后来按用户的意思补上了，见下面变量表。）
  - 共用组件里的按钮，读变量的那条要挂在 `.cc-room` 下面（`.cc-room .cc-thinking-head`），不能只写单个类名。
    - **现象**（6c 比对时抓到）：Vesper 下"思考过程"那行字变成正文色，回到底部键底色变透明。
    - **原因**：Vesper 有一条全局重置 `.vesper button{background:initial;color:inherit}`，特异性 (0,1,1)，比 App.css 的 `.cc-thinking-head`、`.cc-jump-btn` (0,1,0) 高。以前 Vesper 自己写 `.v-chat .cc-jump-btn` (0,2,0) 把它压回来，删掉这条覆盖后，单类名的共用规则就输了。
    - **正确做法**：颜色这几条单独写一条 `.cc-room .xx{...}`（0,2,0），布局还留在原来的单类名规则里。`.msg-meta .copy-btn`、`.cc-composer-row .attach-btn` 本来就是两个类，不受影响。
    - 工具那行（`.cc-tools` 里的 `.cc-thinking-head`）当时看着是对的，只是因为它继承了 `.cc-tools` 的颜色；单独的"思考过程"没有这层，才露出来。所以比对要把每种状态都摆出来，不能只看 mock 里碰巧有的。
  - 输入框同理（6f 比对时抓到）：
    - **现象**：Vesper 下查找页输入框的字从衬线体变回系统字体，高度矮了 4px。
    - **原因**：Vesper 还有一条 `.vesper input,.vesper textarea,.vesper select{font:inherit;color:var(--v-ink)}`，特异性 (0,1,1)，和 `.cc-search-box input` 一样高，vesper.css 又在后面，所以共用规则读的 `--s-input` 被它盖掉了。以前 Vesper 自己写 `.v-chat .cc-search-box input` (0,2,1) 压回来。
    - **正确做法**：共用规则写成 `.cc-search-page .cc-search-box input` (0,2,1)。以后共用组件里读变量的 input / textarea 也要多挂一层类名。
  - 每换一批，用计算样式比对：改前改后各抓一份聊天页所有元素的颜色、字体、圆角、位置（Clawd 浅 / 深、Vesper 白天 / 夜间四种），要求零差异。 mock 里没有的状态（语音条、发送失败、补上的、打字中、加号键选中、回到底部键等）往 `.cc-room` 里塞一块静态 DOM 一起抓，动画关掉，免得 opacity 每次不同。 刚切到 Vesper 的第一次抓，网页字体可能还没加载完，标题宽度会差几像素（字体属性不差）：先 `await document.fonts.ready` 再抓，或者重抓一次。
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
- **正确做法**（1a1177d）：`useVisibleHeight` 每次把 html 高度记成 `--s-full`，背景层的高度写死成它，超出部分被外框裁掉。键盘、面板变化时只有消息区在变。现在这层是 shell 的 `ChatWall`（`shell/chat/wall.css`），新皮肤直接用。

### 3b. 聊天顶栏的名字发糊
- **现象**：聊天页顶栏的 “Soren” 字边不清楚；首页顶栏的字是清楚的。
- **原因**：顶栏的两层模糊（backdrop-filter）写在顶栏自己的 `::before` / `::after` 上，和名字在同一个层叠上下文里。iOS 会把模糊层单独合成，盖在它上面的名字也被拉进合成层一起画，字边变软。首页的模糊是单独的兄弟元素 `.v-top-blur`，字不在它里面，所以清楚。
- **正确做法**：模糊只放在背景层，和文字分开：两层模糊挪到 `.cc-room::before` / `::after`（z-index 2，高度 = 顶栏高度 `--s-top + 66px`），顶栏（z-index 3）本身不带任何 backdrop-filter / filter / opacity / transform。改顶栏的上下边距时，这个高度要一起改（这一步是好习惯，但不是发糊的真正原因，见下）。
- 以后加玻璃效果也一样：文字永远不要放在带 backdrop-filter / filter 的元素里面，也不要放在一直挂着 transform、opacity 动画的元素里。
- **（10/25 最后的做法）**：退回最开始那版、关深色相关改动后名字还是糊，iOS 27 的可能性最大。用户要求顶栏改成玻璃：返回键、名字、菜单各是一块独立的玻璃（材质和底部 tab 栏一样：`--v-tabbar` + blur 22 + `--v-tbLine` 描边），不再铺一整条带颜色的模糊带。状态栏那一截只留一层渐进模糊（和一级页的 `.v-top-blur` 一样）。下移方案不好看，不要。
- **（10/25 再更正）**：退回 01:15 版后名字还是有些糊；下移方案用户觉得不好看，不要。把前一晚为“System 跟不上深色”（其实是手机没开深色，第 21 条）调的几版也退回最开始：#67 给 html 写死的 `light dark` 撤回（html/body/#root 都写具体的 light 或 dark），#66 里回前台重读深浅色撤回。顶栏不下移。结论等真机。
- **（10/25 下午更正）上面“系统顶边效果”的结论不可靠**：用户翻出前一晚 01:15 的截图（#68 那一版，顶栏在原位置、带原来的渐变），浅色下名字是清楚的。#69–#72 期间唯一动到整页的是 #69：html / body 的 `color-scheme` 从 light / dark 改成 “light dark”（为了修 System 跟不上深色，后来查明是手机设置，第 21 条，这个改动本来就不需要）。另外用户当天升级到了 iOS 27。现在顶栏样式、页面底色都退回 01:15 那一版（#73、#74、#79、#80 的顶栏改动全部撤回，#69 的 body 改动撤回），用真机直接对照。下面几条是撤回前的过程记录，等真机结果再定结论。
- **真正的原因（10/25 查清）**：上面挪模糊层没用，真机上返回箭头也一样糊，是整条顶栏都糊。调试开关 No blur / No clip / No glass / Layer 都没效果，只有把顶栏整体往下挪 16px（Lower）变清楚了。原因是 iOS 26/27 系统自己在状态栏下面画一层边缘效果（scroll edge effect：白渐变 + 轻模糊），网页的 CSS 关不掉、也改不了范围，离屏幕顶边太近的内容都会被它糊掉。首页标题离顶远，所以清楚。
- **正确做法**：聊天顶栏上边距 `--s-top + 20px`（原来 +4），模糊层高度、消息列表的 padding-top 跟着 +16。新皮肤的顶栏文字也要离状态栏留够距离（约 20px 以上），不要贴着状态栏放字。
- **还要垫颜色**（10/25 真机对比）：#74 把状态栏那层渐变色整个去掉后，深色下名字也发灰发糊（前一晚还很清楚）。名字背后直接透出杂乱的气泡、文字，再叠上系统顶边效果。正确做法：颜色只铺状态栏那一截（`--v-bg` → `--vc-head`，到 `--s-top` 为止，再往下 16px 内淡完），名字那一行只有透明玻璃。不要把这层颜色当成“罩”整个删掉。
- 以前为什么不对：一直以为是自己 CSS 里的模糊层、气泡的玻璃、合成层把字画糊了，挪了模糊层、加了好几个开关，都没对上。系统画的东西，开关怎么切都不会变。

---

### 3c. iOS 27：状态栏下面一条黑 / 一片白
- **现象**（10/25 升级 iOS 27 后）：开屏、首页顶上多一条黑；浅色聊天页名字上面盖一片白，字边发糊。前一晚 iOS 26 上都没有。
- **原因**：iOS 27 系统在状态栏下面画一层顶边效果（渐变 + 轻模糊），**颜色取 html 的底色**。首页 html 底色是 `#000`、开屏前垫的也是 `#000`、浅色聊天页是 `#f1f3f7`，和页面顶上的颜色对不上，就露出来了。
- **正确做法**：html 底色（VesperApp 的 `CHROME`）照每页顶上实际显示的颜色：首页、聊天页取壁纸顶上那一截叠了滤镜 / 蒙版之后的平均色，开屏用开屏底色（index.html 开屏前垫的也按深浅选），其它页面用页面底色。换壁纸、改滤镜要重新取色。
- 以前为什么不对：一路以为是自己的模糊层、玻璃、合成层把字画糊了，挪模糊层、下移顶栏、退回旧版，都没对上。color-scheme 写死 dark 会让这层变深（第 21 条）。

### 3d. 所有顶栏：玻璃胶囊，整体离状态栏 22px
- **现象**（10/25 iOS 27）：html 底色对上以后，聊天页、Album 这些页顶栏的字还是有一点糊。
- **原因**：同 3b / 3c，系统顶边效果的模糊范围网页改不了，离状态栏太近的字都会被糊。
- **正确做法**：所有二级页和聊天页的顶栏统一成一个样子：返回键是 44px 圆形玻璃，标题是 44 高的胶囊玻璃（材质同 tab 栏），胶囊顶边在 `--s-top + 22px`。顶栏本身透明，后面垫一层渐进模糊（状态栏那截最糊，到 `--s-top + 72px` 淡完），内容从胶囊底下滚过去。涉及：`SubHead`（More 里各页、日记、读日记）、聊天页 `.cc-room>.chatroom-header`、聊天里 menu / 查找（`.more-sub-page>.page-header`，sticky）/ 回复方式（`.cc-brain-page>.chatroom-header`）。书架、阅读器、记忆地图自己的顶栏不是胶囊，但也一起往下挪 16px。改上边距时，内容的 padding-top、模糊层高度一起改。
- 以前为什么不对：之前只改聊天页一处，其它页还贴着状态栏；先前 Lower 试验（+16px）用户确认变清楚，只是当时觉得单独下移不好看，改成胶囊浮起来就不突兀了。
- **（10/25 晚更正）位置照 Telegram**（后来改成 +12，见下一条）：+22px 离灵动岛太远，用户要照 Telegram：胶囊顶边 `--s-top + 4px`，模糊层到 `--s-top + 54px`。书架、记忆地图、共读阅读器的顶栏也一样对齐到 +4：阅读器顶栏改成两颗纸色玻璃圆 + 书名章节胶囊；记忆地图顶栏样式保持原样（方形纸色返回键、邮票，用户试过胶囊后要求改回），只挪位置和其它页对齐：返回键中线在 `--s-top + 34px`，邮票顶边在 `--s-top + 12px`。书架 html 底色 `#28405b` / 夜 `#19293c`，阅读器、记忆地图用纸色 `#efebe2` / `#12161f`（第 3c 条）。
- **（10/25 再调）+12px**：+4 贴着状态栏，字还是被系统顶边效果糊到（系统那层盖在整个网页上面，胶囊压不过它）；+22 又离灵动岛太远。折中成胶囊顶边 `--s-top + 12px`，模糊层到 `+62px`，各页内容边距跟着 +8。
- **（10/25 再调）去掉胶囊后面自己垫的渐进模糊**（`.v-sub-head` / 聊天页 `.cc-room` / 聊天里三页顶栏 / 阅读器顶栏的 `::before`）：状态栏那截系统顶边效果已经模糊过一遍，自己再叠一层是重复。现在胶囊后面只有系统那层，加胶囊自己的玻璃。一级页的 `.v-top-blur` 不动。10/25 真机确认可以，定下来就这样。

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
  - 聊天顶栏是例外（10/25）：模糊层垫的 `--v-bg → --vc-head` 渐变去掉以后名字反而糊了（见第 3b 条），现在只在状态栏那一截保留颜色。

---

## 三、键盘上方那条工具栏

### 6. 键盘上方的工具栏（上下箭头、对勾）发黑
- **现象**：浅色页面弹键盘时，键盘上面那条工具栏是黑的。
- **原因**：那条是半透明的，透出来的是 html/body 的底色和 `color-scheme`。当时 Vesper 把 html/body/#root 写死成了开屏黑。
- **第一次**（47080ad）：`usePageChrome(color)` 按页面设 html/body/#root 的 background、colorScheme 和 theme-color。白天浅色页用 `#f1f3f7` + `color-scheme: light`，夜间和 Home 壁纸用深色。
- **第二次的坑**（a43b754）：从 Home 打开的日记、读书也是浅色页，但判断时还算在 Home 里，工具栏一圈黑。改成 Home 并且没打开子页（`!immersive`）时才用深色。
- **正确做法**：底色跟着**当前最上面那一页**的实际颜色走，包括从 Home 叠上去的子页。
- **第三次的坑**（10/25，接 3c）：为了 iOS 27 顶边效果，浅色聊天页 html 底色改成了壁纸色 `#afa7be`，弹键盘时工具栏、它和输入栏之间那条缝都透出淡紫灰。正确做法：键盘开着（`shell.keyboardOpen`）时聊天页的底色换回普通页底色（浅 `#f1f3f7` / 深 `#0a0c11`，和输入栏 `--vc-head` 接得上），键盘收起再换回壁纸色。**收起时要等键盘落完（650ms）再换**：键盘往下落的那段时间，让出来的那块透的也是 html 底色，立刻换回壁纸色会闪一下淡紫灰。
- **第四次（10/25，已撤回）**：键盘开着时换 html 底色，顶上的系统顶边效果也跟着变白（同一个颜色管两处，网页分不开）。改成反过来：html 底色**不换**，一直是壁纸色；键盘开着（`.vesper.kb-open`）时把输入栏 `--s-bar` 染成同一个颜色（浅 `rgba(175,167,190,.94)` / 深 `rgba(36,34,47,.94)`），输入栏、缝、工具栏连成一块。上面“第三次”的切 CHROME 和 650ms 延迟都撤掉了。
  - 真机：输入栏整条变紫，用户不要。撤回，输入栏回原色。
- **待查（10/25）**：以前说“顶边效果、工具栏都取 html 底色”，其实当时是 html / body / #root / theme-color 四个一起换的，没分开试过。工具栏透出来的更可能是外框缩到键盘上方后、下面露出来的那一层（#root 或 body），顶边效果可能取 html 或 theme-color。调试面板（连点聊天页名字 5 下）加了 html red / body green / root blue / theme yellow 四个按钮，每个只换一层，弹键盘截图看哪处跟着变，确认后再分开设。

---

## 四、键盘和面板

### 7. 键盘、表情面板、加号面板三选一
- **现象**：面板和键盘同时出现、叠在一起；切换时输入框跳上跳下，消息列表跟着跳。
- **走过的弯路**：
  1. ee8a060：面板高度 = `--s-kb`。点面板先收键盘；点输入框时等键盘真的升上来（visualViewport 缩小超过 100px，或者最多 600ms）再收面板。思路对，但键盘还在的时候加上面板，外框高度还是“键盘开着”的高度，面板把输入栏往上顶，等键盘退了又落回来。
  2. 7f20e50：嫌面板空，改成“高度跟内容走”（约 140px）。这样键盘和面板互换时输入框高度就不一样了，**作废**。
  3. 5e0281f：面板高度 = 上次键盘的实际高度（`--s-kb`），互换时输入栏不动。但网页输入框的键盘上面还有一条系统工具栏，iOS 26 上整块约 404pt，比微信的键盘（345）高一截，加号面板只有一排按钮，下面空一大片，看着太高。**改掉**。
- **正确做法**（照微信录屏量的，393pt 宽）：
  - 面板高度皮肤自己定：Vesper 加号面板 241 + 底部安全区（约 275），表情面板 353 + 安全区（约 387），都取 `min(--s-kb, …)`。
  - 面板之间、面板和键盘之间换的时候，输入栏跟着走，不是一下跳过去。CcChat 统一管时机，皮肤只写动画：
    - 打开：CcChat 把“原来那块有多高”（键盘 = 整屏高减 visualViewport 高、另一个面板的高度、什么都没有是 0）放在面板的 `--s-panelFrom` 和 `data-from` 上，皮肤用 keyframes 从这个高度变到自己的高度。键盘退下去的时候面板正好在键盘后面慢慢缩，输入栏不会被还没退完的键盘盖住。
    - 关掉（点列表、再点同一个按钮、下拖）：加 `data-close`，皮肤让它缩到 0（padding、上边框也要一起缩，不然最后一下会跳一截），缩完才拿掉。侧滑返回时直接拿掉。
    - 切回键盘：键盘真的升上来那一下加 `data-to-kb`，面板长回 `--s-kb`，长完才收。只等 visualViewport 变小的话，面板一下子从 275 变成 0，外框又贴到键盘顶上，输入栏会先被键盘盖住再跳上去。
    - 等多久读面板自己的 `transition-duration`。皮肤没写过渡（Clawd）就是 0，行为和以前一样，立刻收。
  - 面板开着时外框不跟键盘缩：`.vesper:has(.cc-attach-menu,.cc-emoji-panel){height:100%}`。
  - 面板开着时底部 tab 栏也收起，用 `:has()` 同一帧就生效，不等状态更新。
  - 关面板的方式：点消息列表、再点同一个按钮、在列表上手指往下拖（1a1177d）。
  - 加号面板按钮放大排成网格，照微信。
  - 本地浏览器面板隐藏时动画不走（currentTime 一直是 0，高度停在起点）。量过程之前先截一次图，让面板显示出来。
  - **第 4 次（收起是两段）**
    - **现象**：面板收起时输入栏先掉到屏幕最底下，面板拿掉后 tab 栏回来，输入栏再升回 tab 栏上面，看着"先下去再缩回来"。收键盘没有这个问题。
    - **原因**：面板开着时 `--v-tbSpace` 是 0（tab 栏收起），面板缩到 0 时输入栏就贴着底边；面板拿掉、tab 栏回来以后，`--v-tbSpace` 才从 0 过渡回原值，是第二段动画。打开时也一样，`v-panel-up` 从 0 长起，输入栏先掉到底再升。收键盘时 tab 栏和输入栏是同一下回到原位的。
    - **正确做法**：tab 栏那块的高度单独存成 `--v-tbRest`。收起时面板缩到 `--v-tbRest`（不是 0），内容淡掉；CcChat 一开始收就广播 `cc-panel` false（`panelClosing`），tab 栏同时滑回来；`.v-chat:has([data-close])` 先把 `--v-tbSpace` 设回原值（面板的负 margin 正好抵掉，输入栏不动），面板拿掉那一下就不会再过渡。打开时 `v-panel-up` 也从 `--v-tbRest` 长起。面板开着的时候输入栏位置只看面板高度、和 `--v-tbSpace` 无关（底下的 padding 和面板的负 margin 互相抵掉），所以中途改 `--v-tbSpace` 不会跳。
    - **以前为什么不对**：只量了面板高度（0 → 241 → 0），没量输入栏的位置，所以没发现终点比原位低一个 tab 栏。
    - 量法：浏览器面板在后台时过渡会停住，中间帧量不到；加一条 `transition:none` 的样式，直接量起点、终点（打开开始、收起终点、拿掉以后，输入栏底边都应该等于没面板时的位置）。

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

- **收键盘时最后一条停在原地，和输入栏之间空出一大块**（这处改过 6 次，前两次见上面）：
  - 现象：打了几行字、收起键盘，输入栏落下去了，最后一条还停在键盘开着时的位置，中间露出一大块壁纸（真机截图空了约 375pt，差不多就是键盘的高度）。弹键盘时没这个问题。
  - 原因（推测，还没真机数据证实）：收键盘时列表一帧帧变高，浏览器把 DOM 里的 scrollTop 夹回新的底部；我们再写 `scrollTop = scrollHeight` 是同一个值，iOS 当成没变、不重画，画面上的滚动位置跟不上。本地 Chrome 复现不出来。
  - 第 3 次（#63，已撤）：键盘起落时列表不变高，`.messages{margin-top:calc(var(--s-vh) - var(--s-full))}` 跟着外框同一条过渡平移。**为什么不对**：真机上键盘开着时最后一条和输入栏之间反而空出一块；关面板时 `margin-top` 在 0 和负值之间跳、过渡时有时无，关面板卡一下；列表最上面一截还被推到屏幕外。改布局牵连面太大。
  - 第 4 次（#64）：钉底时先写 `max − 1` 再写到底，逼 iOS 重画。点一下收键盘好了，**向下滑收键盘还是空一大块**。
  - **真机读数查到的真正原因**：收键盘、关面板时 `listToBottom` 是负的（到 −126），也就是 scrollTop 超过了最大值：iOS 没把它夹回去，当成"拉过头"（橡皮筋）。手指还按在列表上（向下滑收键盘）时尤其如此：松手后它自己慢慢弹回来，我们中途写的 scrollTop 会被它盖回 −126（读数里 520ms 那帧跳回去，冻住 270ms 再缓缓回弹）。点一下收起也有约 200ms 是负的，只是短。
  - 现在的做法（第 5 次）：列表变高、会滚过头时，不写 scrollTop，把多出来的那截垫在列表顶上（inline `padding-top` = 原 padding + 垫的量）。能滚的范围跟着变大，scrollTop 始终合法，最后一条跟着底边走。手松开、350ms 没再滚动或变高（settle）时再拿掉垫的、钉回底；变矮时先退垫的。代码在 `useStickToBottom` 的 `setPad / settle`。
  - 本地 Chrome 不会滚过头，这条路径本地走不到，只能真机看。
  - 第 6 次：向下滑收键盘、手指没及时松开时画面一闪一闪。原因：手指还在拖，我们每帧钉底写 scrollTop，和手指抢。正确做法：手指按着（touchstart 到 touchend）时只垫 padding、不写 scrollTop，欠下的（`owed`）等松手 350ms 安静后一起钉。
  - 调试读数有三列：列表 scrollTop、`listToBottom`（列表离底，负的就是拉过头）、`lastGap`（最后一条底边到输入栏顶边），面板开合也录。

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

### 9b. 查找页什么都没搜就返回，tab 栏不回来
- **现象**：进查找聊天记录，不输入直接返回，回到聊天页、对话列表都没有底部 tab 栏；搜过再返回就正常。
- **原因**：查找页没词时输入框 autoFocus，键盘开着。按返回，这个还聚焦着的输入框整个被 React 拿掉，iOS Safari 不发 `focusout`，`useKeyboardOpen` 的 kb-open 一直是 true，tab 栏一直收着。搜过的时候一般先收了键盘，focusout 正常发了。
- **正确做法**（`shell/viewport.js` 的 `useKeyboardOpen`）：输入框聚焦期间用 MutationObserver 盯着 DOM，它 `isConnected` 变成 false 就当键盘关了。
- 本地 Chrome 复现不了：浏览器面板在后台时 autoFocus 不发 focus 事件。验证时手动派发 focusin 再 remove 输入框，看 kb-open 有没有掉。

### 9c. 用着用着聊天页 tab 栏没了（切到后台再回来）
- **现象**：聊天页本该一直有底部 tab 栏，用一阵子就没了，切到后台再回来尤其容易出现。
- **原因**：键盘开着时切到后台，系统把键盘收了，但回来时输入框还是 `document.activeElement`，iOS 不发 `focusout`，kb-open 一直是 true，tab 栏一直收着。和 9b 一样，都是“键盘其实关了，但焦点事件没来”。
- **正确做法**（`useKeyboardOpen`）：`visibilitychange` 变成 hidden 时，把聚焦着的输入框 `blur()` 掉，直接当键盘关了。回来时焦点不在输入框上，不会再被当成键盘开着。每次前后台切换都会在调试读数里记一行（visible/hidden、activeElement、kb）。
- 以前为什么不对：`useKeyboardOpen` 只认 focusin / focusout（9b 又补了输入框被拿掉的情况），没管前后台切换。
- 本地验证：手动派发 focusin，再把 `document.visibilityState` 改成 hidden 派发 visibilitychange，看 kb-open、tab-hidden 有没有掉。
- **回前台重量也不够**（10/25 真机 iOS 27 读数）：回来时 `vv 431 · html 852`、焦点在 BODY、kb false——键盘早没了，iOS 的 visualViewport 还报着有键盘时的高度，重量多少次都是错的值。正确做法：切过后台以后（stale），只要没有输入框聚焦，就不信 visualViewport 的矮高度，按整屏排；它自己报回整屏或又点了输入框才恢复。依据：键盘只会在输入框聚焦时出现。
- **回来后再点输入框不弹键盘**（10/25 真机 iOS 27）：回前台时 iOS 有时自己把焦点还给输入框，但不弹键盘。kb-open、tab-hidden 挂着，输入框已经聚焦，再点也不弹。正确做法：回前台后 0.3s、1s 各查一次，输入框聚焦着但键盘不在就 blur 掉（`useKeyboardOpen` 的 unstick）。
- **回来后点输入框不弹键盘、光标跑到最前**（10/25 真机，0.3s/1s 检查没起作用）：回前台时 iOS 自己把焦点还给输入框，光标放在开头，不弹键盘。上一版的检查用 visualViewport 判断“键盘在不在”，可回前台时它还报着旧的键盘高度，以为键盘在，就没 blur。点按时 preventScroll.js 看到已经聚焦，就交给系统，系统也不弹。正确做法：记“这次聚焦后键盘真的升起来过没有”（viewport.js 的 `keyboardShown()`）。点按已聚焦的输入框时，如果键盘没升起来过，就先 blur，再在这次点按里重新聚焦，光标放到最后。
- **统一的原因和做法**（10/25）：几种情况都是 iOS 自己把焦点还给输入框——有时带着键盘（点空白处收键盘，收了又弹回来），有时不带（切后台回来；拼音没选字就点 ✓ 以后 tab 被吞）。#81 没起作用，是因为切后台时没清 `kbSeen`，回来还以为键盘在。正确做法（`useKeyboardOpen`）：
  - 看门狗：每次聚焦 0.7s 后，键盘还没升起来过，就 blur、tab 回来。正常点输入框键盘 0.3s 内就上来；只在触屏上看。
  - 聚焦那一刻键盘已经在（从一个输入框点到另一个），直接算升起过。刚回前台 visualViewport 报的是旧值，要等它真的 resize 过一次再信；这期间它显示有键盘时，看门狗不动手，只记一行。
  - 切后台、focusout 都要清 `kbSeen`。
  - 点空白处收键盘（CcChat 的 `onListTap`）：和下拖收键盘一样记 `swipeBlurAt`，之后 0.6s 里冒出来的 focus 再收一次。
  - #82 的“手指按下就 blur”撤回：会让页面先缩一下、tab 弹出来，键盘还是不出。
- **点按里 blur 再 focus 也不弹**（10/25 真机）：光标位置对了，键盘还是不弹，iOS 不认同一次点按里的 blur+focus。正确做法：touchstart（手指按下）时就 blur 掉“聚焦着但键盘没升起过”的输入框，touchend 走普通的 focus + 光标放最后；回前台后的检查加到 0.3/0.8/1.5/3s。
- **还有一种**（10/25 真机）：不切后台，键盘收起来（下滑收键盘等）以后 tab 也不回来。同样是输入框还聚焦着、没有 focusout。正确做法：`useKeyboardOpen` 也盯 visualViewport 的 resize，聚焦以后量到过键盘、后来键盘没了，就当关了并 blur 输入框（再点会重新弹）。只看焦点判断键盘不可靠，焦点只能当“开”的信号，“关”要以键盘真的不在为准。
- **跟着出的坑**（#73 之后真机）：键盘在后台被收掉，visualViewport 的 resize 在后台发不到，回来时 `--s-vh` 还是有键盘时的高度：输入栏和 tab 栏停在半屏，底下空一大块。正确做法：`useVisibleHeight` 在 visibilitychange（visible）和 pageshow 时重量一次，150ms、500ms 再补两次。

### 9d. 发完消息键盘别收
- **现象**：打完字点发送，键盘跟着收起来，接着打还要再点一次输入框。
- **原因**：点按钮时焦点从输入框移到按钮，iOS 输入框一失焦就收键盘。不是代码里调了 blur。
- **正确做法**：发送键在 `touchend` 里 `preventDefault()` 再直接调发送（拦掉之后不会再有 click，焦点留在输入框）；桌面上拦 `mousedown`。`onClick` 留着给键盘、鼠标。
- 以后其它“点了不该收键盘”的按钮也照这个做，不要在点完以后再 `focus()` 回去：iOS 不是用户手势里的 focus 不会再把键盘弹出来（第 9c 条）。

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
- **语音条不放在 Soren 的气泡里**（照微信）：
  - 现象：一轮里有文字又有语音时，语音条（本身就是一块主题色的底）套在半透明气泡里，像框里又套了个框。
  - 做法：英文版（Vesper）的 `CcTurn` 用 `ccTurnBlocks`（Turn.jsx）把一轮拆成几块：挨着的文字、工具合成一个气泡（`.cc-turn-body`），每条语音单独一块（`.cc-turn-voice`），块之间 6px。一段话里夹着语音的按段拆开，`VoiceAwareContent` / `CcPiece` 带 `range` 只画自己那几段，播放状态还按原来的段号记；思考过程跟第一截，"补上的"跟最后一截。最后一块是语音、他还在说时，三个点另起一个气泡。Clawd（中文版）没有气泡，还是一整块。

### 14. 代码块
- 长行原来不换行，超出屏幕的部分被截掉。
- 气泡里的 `pre`：`white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere`，不横向滚动，宽度不超过气泡，字号 12.5px。
- Copy 复制的是原文，换行不影响。

### 15. 中文衬线字体的细节
- **省略号**：Noto Serif SC 的 … 是竖直居中的中文写法。所有用它的地方（气泡、输入框、正文）都换成西文字形，让它落在基线上（e233587）。
- **输入框空着也能上下滑、提示字偏下**：
  - **现象**：输入框没字时手指一拖，里面能上下滑一点；真机上 Say to Soren 比框的中线低 2pt 左右。
  - **原因**：
    - 高度是 JS 按 `scrollHeight` 设的，可 `scrollHeight` 不含边框，`box-sizing:border-box` 下框里总比内容少 2px，于是能滑。
    - 行高是 `normal`，各设备、各字体算出来不一样，内容高度跟着变。
  - **正确做法**：
    - JS 先把高度还给 CSS（一行），只有 `scrollHeight > clientHeight` 才撑高，撑高时加上边框（`offsetHeight - clientHeight`），到 120px 封顶才让它滚；一行时 `overflow-y:hidden`（`CcChat.jsx` 里输入框那个 `useLayoutEffect`）。
    - Vesper 行高写死 20px，内边距上 7 下 9：1+7+20+9+1 = 38。这个字体上沿留得高，上 7 下 9 时西文提示字（大写字母那截的中线）和中文字面的中线都正好在框的正中。有字没字同一套内边距，打第一个字不跳。
  - **以前为什么不对**（33921eb）：没字时用 `:placeholder-shown` 把内边距改成上 6 下 10 往上挪 2px。挪的是字，没管内容比框高这件事；行高还是 `normal`，真机上照样偏、照样能滑，有字没字两套内边距，打第一个字还会跳一下。
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

### 21. 选了 System 也不跟系统换深色（最后查明不是 bug）
- **现象**：Vesper 选 System，以为手机是深色（凌晨一点），App 还是浅色。
- **真正原因**：手机系统其实是浅色（深色模式被误关了）。调试读数 `sys light · mode auto` 就是对的。
- **教训**：先打开调试读数看 `sys`（App 读到的系统深浅色）和 `mode`，再去改代码。这次在没有数据的情况下猜了两轮：#66 回前台重读、#67/#69 把 html/body 的 `color-scheme` 改成 `light dark`。这两处改动无害，保留下来了：深浅现在只写在 `.vesper` 外框上，`usePageChrome` 也不再收 scheme 参数。但它们都不是这次的原因。

- **（10/25 补）这条 light dark 不能撤**：#82 把它撤回成按页面写死 light / dark 以后，iOS 27 上开屏和首页状态栏下面多了一条黑。系统的顶边效果会按文档声明的深浅上色，夜间外观时声明 dark，就铺一层深色。#84 又改回 html / body / #root 都写 `light dark`（和前一晚 02:10 截图那版一样，那时顶上是干净的）。
