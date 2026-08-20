# 一键杀毒(Windows Defender 封装版)— 设计文档

- 日期:2026-08-20
- 状态:已确认,待拆实现计划
- 目标平台:Windows 11(x64)

## 1. 目标

做一个**极简的"一键杀毒"桌面程序**:用户双击打开,点一个大按钮,程序调用系统自带的 Windows Defender 引擎执行全盘扫描并自动清除威胁,最后列出结果。

核心原则:**越简单越好,效果最好**。检测能力不自己造,直接复用 Defender(第一梯队水准),程序只负责"触发扫描 + 展示结果"。

## 2. 技术路线

- 语言/框架:C# / .NET Framework 4.8 + WinForms
- 交付物:单个原生 `OneClickAntivirus.exe`(约几百 KB),双击即用
- 运行时依赖:无(Win11 自带 .NET Framework 4.8)
- 引擎:调用系统自带 `MpCmdRun.exe`(Defender 命令行扫描工具)

选择 C#/WinForms 而非 Python/PyInstaller 的原因:编译产物体积小、启动快、无需运行时,且**不会被其他杀软误报**(对一个杀毒工具而言,自身可信度很关键)。

## 3. 架构与文件结构

```
OneClickAntivirus/
├── build.bat                     # 编译脚本:调用系统自带 csc.exe 生成 exe(零工具链,无需 VS/dotnet)
├── app.manifest                  # 请求管理员权限(UAC 提权)
├── Program.cs                    # 入口
├── MainForm.cs                   # 主窗口 UI + 按钮事件
└── DefenderScanner.cs            # 核心引擎封装
```

职责边界:

- `DefenderScanner`:定位 MpCmdRun → 执行扫描 → 读取威胁清单 → 把退出码映射成中文结果。**不依赖任何 UI**。
- `MainForm`:只负责按钮、进度条、状态文字、结果列表。**不碰引擎细节**。

## 4. 数据流(扫描流程)

1. 用户点击"一键全盘杀毒"→ 按钮禁用,进度条进入不确定(marquee)状态,显示"正在扫描…"。
2. `DefenderScanner` 定位 `MpCmdRun.exe`(两个标准位置都查,任一命中即可):
   - `C:\Program Files\Windows Defender\MpCmdRun.exe`(本机实测存在);
   - `C:\ProgramData\Microsoft\Windows Defender\Platform\*\MpCmdRun.exe` 最新版本目录(本机该目录为空,需容错)。
3. 执行 `MpCmdRun.exe -Scan -ScanType 2`(全盘扫描,同步阻塞直到完成,自动隔离/清除)。
4. 依据退出码映射结果:
   - `0` → 未发现威胁;
   - `2` → 发现并清除了威胁(随后调 `Get-MpThreatDetection` 拉取清单);
   - 其他 → 扫描出错,展示错误信息。
5. 按钮恢复可用,结果展示在列表区,底部更新"上次扫描时间"。

## 5. UI 界面

单窗口,从上到下:

- 标题:"一键杀毒"
- 大按钮:"🛡️ 一键全盘杀毒"(视觉中心)
- 进度条(扫描时 marquee 滚动)
- 状态文字(未开始 / 正在扫描 / 已完成)
- 结果列表:检测/清除的威胁(病毒名 + 文件路径 + 时间)
- 底部小字:"上次扫描时间:xxx"

## 6. 错误处理

- Defender 实时保护被关闭 → 提示先开启。
- 找不到 MpCmdRun → 明确报错 + 指引。
- 扫描返回错误退出码 → 显示错误,不静默失败。
- 无管理员权限 → `app.manifest` 声明 `requireAdministrator`,启动时自动弹 UAC(全盘扫描+清除需要权限)。

## 7. 构建与分发

- 用系统自带 `csc.exe`(`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`)直接编译,由 `build.bat` 一键生成单个 `OneClickAntivirus.exe`。本机无 dotnet/msbuild,此方案无需安装任何工具链。
- 双击即用,无需安装任何运行时。
- 程序名/图标暂用默认,可后续替换。

## 8. 测试

- **手动验证为主**:真机跑全盘扫描,覆盖三种退出码路径(0 / 2 / 错误)。
- **辅助单元测试**:`DefenderScanner` 中"退出码 → 结果文案"的映射逻辑。

## 9. 明确过的决策(避免歧义)

- 扫描范围:**一键即全盘扫描**(不做"快速+全盘"两档)。
- 威胁处理:**自动隔离/清除**,扫完列出清单。
- 形态:**桌面 GUI 单窗口**,非脚本、非托盘。
- 不做的(YAGNI):不加重启计划、不加签名更新按钮、不做实时监控、不做定时扫描。
