> Historical incubation record (2026-11-04), sanitized for publication. Current repository setup: [SETUP.md](SETUP.md).

# Moonshot 本地交付记录

网页：http://127.0.0.1:4177/github-factory/ （使用现有 Tailscale 连接）。可直接进入 `/world/openclaw/openclaw`，或在首页粘贴公开 GitHub 仓库。

## 交付范围

独立 TanStack Start 工程位于 `code/moonshot`，包含自己的依赖、lockfile、SQLite、配置、测试和运行服务。已实现 Moonshot、Factorio、Red Alert、Red Alert 2、Civilization 五种原创程序化画风；支持拖拽、缩放、区域索引、来源检查、真实 Issue/PR/提交/workflow 动态、Muse 导览与证据关联的贡献建议。UI 支持英文和中文；仓库原始内容及当前 AI 导览保留英文或来源原文。

生成的是受类型和来源约束的世界模型，由可信组件渲染。模型不会执行仓库代码或生成任意可执行页面。架构基于路径与有界清单分析，不表示完整调用图或运行时流量。

## 运行身份

- 服务：`moonshot-web.service`，独立用户服务，已启用常驻。
- 实际运行源码：`d170c944326523a67c99fa64fe262c13e2effec6`；后续提交只记录交付文档。
- 发布目录：`~/.local/share/moonshot/releases/20261104T182405Z/`。
- 受测构建与已安装构建：28 个文件、1,220,096 bytes，目录内容 SHA-256 均为 `284fd43e21c451bd7317a31971bd2ce3ee0cd20e9b1746b66eeaf846259f24b2`。
- `/api/health` 返回安装源码身份、Muse 配置及服务状态，不输出凭据。
- `.env` 权限为 0600；6 个客户端构建文件对实际配置的 3 个凭据进行扫描，匹配数为 0。
- 当前持久数据与共享费用账本仍使用原绝对路径，不能删除、分叉或改换账本；运行中的服务依赖此数据目录。
- 原 factory `:8091` 未改动；本任务临时 `:4176` loopback、`:4178`、`:4179` 服务均已停止。

## 验证

| 验证边界                               | 结果                                              |
| -------------------------------------- | ------------------------------------------------- |
| 应用与浏览器测试 TypeScript            | 通过                                              |
| 独立完整 unit suite                    | 169 pass / 0 fail / 0 skip，7 个文件              |
| 最终生产构建的 Playwright 合成 UI 合约 | 17 pass / 0 fail / 0 skip，Chromium               |
| 独立 build                             | 通过                                              |
| 正常提交 hooks                         | Gitleaks、格式及 lint 通过                        |
| 修改隔离                               | 本任务全部受版本控制的修改均在 `code/moonshot` 内 |

合成浏览器测试拦截 API，只证明 UI 合约；下方真实验收使用实际 GitHub 与最终 Muse 服务，分别报告。SQLite 并发预算测试使用真实独立进程与一次性数据库：160 次 $0.50 预留竞争，100 次接受、60 次拒绝，累计上限恰为 $50。

## 真实链路

2026-11-04 10:32:11 PT 至 2026-11-04 10:34:06 PT，在实际常驻 URL 完成 7/7 公开仓库验收。六个精选项目均返回真实 GitHub 快照与 Muse 导览；另从首页粘贴 `https://github.com/TanStack/router`，实际完成生成、跳转、来源检查、五风格切换、动态、导览、中文和 390px 布局。最后一次重跑复用了已生成的 TanStack 导览，未追加付费调用。

| 仓库                              | 区域 / 连接 | 路径覆盖  | 导览 |
| --------------------------------- | ----------- | --------- | ---- |
| openclaw/openclaw                 | 30 / 28     | truncated | muse |
| pingdotgg/t3code                  | 30 / 28     | truncated | muse |
| react/react                       | 30 / 28     | full      | muse |
| pytorch/pytorch                   | 25 / 24     | truncated | muse |
| facebookresearch/segment-anything | 6 / 5       | full      | muse |
| meta-llama/llama-models           | 4 / 3       | full      | muse |
| TanStack/router（现场粘贴）       | 30 / 28     | truncated | muse |

五种风格保留同一个选中区域与相同 head 的来源链接。最终浏览器错误 0、警告 0。前台一次自动轮询在 60.033 秒后收到 HTTP 200；随后手动刷新将采集时间从 2026-11-04 10:32:51 PT 推进到 2026-11-04 10:33:51 PT。轮询和刷新前后的模型调用均为 24 次。

实际 TanStack 首次模型请求开始于 10:25:17.252 PT，导览在 10:25:28.674 PT 保存，模型阶段本身超过 10 秒；真实页面生成仍成功返回，覆盖此前生产默认 idle timeout 的失败路径。React 旧地址 `facebook/react` 也已在真实 GitHub 读取中安全解析为 `react/react`。旧地址映射、固定主机跳转、公有仓库门禁、重定向循环/外部地址拒绝另有回归证明。

## 费用

截至 2026-11-04 10:35:33 PT，共享账本累计 **US$0.401026 / US$50**，预留 US$0.000000，剩余 US$49.598974。共 24 次请求尝试，21 次有效导览成功，3 次付费响应回退（无效 mission、无效 district、输出未完成），失败部分 US$0.064884 已包含在累计值内，没有退款或清零。

最终运行 provider 为 `muse`，模型 `muse-spark-1.3` Standard；GPT 引导开发和 Muse 调试共用原 SQLite 账本。上述为 provider token usage 与保守价格计算的估算，不是账户发票。没有待结算预留，也未启用自动付费重试。

## 修复与限制

生产实测发现并修复了 Bun 默认 10 秒 idle timeout 导致的大仓库请求断开，以及新 CI run 使未变更架构的导览缓存失效。保留了失败原件和回归证据。API 请求现在最多允许 180 秒空闲，GitHub 采集仍限 60 秒、模型请求仍单次有界；没有自动付费重试。

大仓库保留 8000 路径、30 区域、50 连接等上限；可读树优先保留浅层广度，超大响应使用受 12 次额外请求约束的浅层回退。缺失、折叠、推断、过期、跳过与未知状态均保留标记。workflow 窗口不能证明 required checks 完整、生产部署或发布状态。

前台每 60 秒检查更新，服务端缓存 90 秒；手动刷新至少间隔 15 秒。切换画风与普通刷新不会生成新的 AI 导览。旧 head 的解释可在明确标注旧/新 head 并移除已失去来源的条目后保留。

未测：Safari、Firefox、实体触屏设备、公网访问与公开托管；窄屏已在 Chromium 的 390/768px 布局检查。未创建 PR、未 push、未发布公开站点、未代提交比赛。比赛 portal 的最终提交格式和参赛资格未在此交付中核验。

## 本地证据

完整运行日志、真实快照验收、截图、费用账本汇总、构建身份及失败原件保存在 `<private-validation-artifacts>/`。关键入口：`live-browser/report.json`、`live-browser.acceptance.ts`、`delivery-browser.log`、`breadth-units.log`、`final-prefetch.log`、`artifact-identity.json`、`final-client-secret-scan.json`。

早期真实验收驱动的导航 response body、`zh-CN` 语言标签及刷新冷却断言也有保留的失败报告；它们与已修复的产品缺陷分开记录。最终验收结果以上述完整重跑为准。

## 20 库与英文影片扩展交付

2026-11-04 PT：扩展为20个精选热门项目，20/20真实图与Muse导览已生成，20/20浏览器地图已采集。三个Muse模型在同一组三份冻结快照上共9次测试，8次严格有效、1次可见回退；不将此小样本当作通用质量排名。更新后应用173项单元测试、18项Playwright合成测试通过，均0fail/0skip。运行JS/TS源码为f089316c6ce76eda0dbd69cf5d8e94316622422c。

正式电影已生成并核验：180.000秒、1080p、5400帧，英文旁白/55条字幕/标题与UI、原创配乐及音效。混音保持完整，实际图与录屏均有来源身份。累计文本API估算$0.828305/50，49次尝试、0预留；免费语音与本地配乐无付费API调用。

影片文件、制作来源与验收见[VIDEO.md](VIDEO.md)，20库及三模型分母/失败/费用见[MODEL-COMPARISON.md](MODEL-COMPARISON.md)。本地交付，未公开发布或代提交比赛。
