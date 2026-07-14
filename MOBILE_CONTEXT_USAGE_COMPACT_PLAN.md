# 移动端上下文用量紧凑展示实施计划

## 目标

将聊天输入工具栏右侧的上下文用量入口在紧凑布局中收缩为小圆环，减少移动端横向占用；普通桌面布局继续显示圆环、Token 用量和百分比。

## 当前实现

- `src/features/chat/input/InputToolbar.tsx` 已通过 `useChatViewport()` 获取 `presentation.isCompact`。
- `src/features/chat/input/ContextUsageButton.tsx` 始终渲染圆环、Token 比例和百分比，没有紧凑分支。
- `StatusIndicator` 已提供所需的圆环进度、阈值颜色和连接状态点。
- 点击入口后的下拉摘要和 `ContextDetailsDialog` 完整详情无需改变。

## 设计

1. 为 `ContextUsageButton` 增加可选的 `compact` 属性。
2. `InputToolbar` 将现有的 `isCompact` 传给上下文用量入口，不新增媒体查询或设备判断。
3. 紧凑模式下：
   - 按钮固定为 32×32px；
   - 仅渲染现有 18px `StatusIndicator`；
   - 不渲染 Token 比例和百分比文字。
4. 非紧凑模式保持当前完整展示和间距。
5. 两种模式都保留动态 `title` 和 `aria-label`，并补充弹出摘要的展开状态语义。
6. 点击行为、统计计算、阈值颜色、下拉摘要及详情弹窗保持不变。

## 修改范围

- `src/features/chat/input/ContextUsageButton.tsx`
- `src/features/chat/input/InputToolbar.tsx`
- `src/features/chat/input/InputToolbar.test.tsx`

不修改：

- `src/features/chat/sidebar/ContextDetailsDialog.tsx`
- `useSessionStats` 及 Token/费用计算逻辑
- `StatusIndicator` 和 `CircularProgress`

## 测试计划

在现有 `InputToolbar.test.tsx` 中让 viewport mock 可切换，并覆盖：

1. 桌面模式继续显示 Token 比例和百分比。
2. 紧凑模式不显示上述文字，只保留可操作的圆环按钮。
3. 紧凑按钮具有完整可访问名称和弹出摘要状态。
4. 点击紧凑按钮仍打开现有上下文用量下拉摘要。
5. 现有键盘焦点跳转行为不回归。

## 验证命令

从 `packages/newweb` 运行：

```bash
npm run test:run -- src/features/chat/input/InputToolbar.test.tsx
npm run typecheck
npm run lint
```

如本地服务条件允许，再分别以移动端窄宽度和普通桌面宽度进行视觉检查。

## 完成标准

- 紧凑布局中的上下文用量入口为固定尺寸小圆环。
- 普通桌面布局外观和信息密度保持不变。
- 下拉摘要、详情弹窗、统计逻辑和连接状态显示保持不变。
- 回归测试、类型检查与 lint 通过。
- Chimera 变更审计没有未处理的相关发现。
