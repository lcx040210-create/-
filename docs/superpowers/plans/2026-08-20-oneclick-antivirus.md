# 一键杀毒(Windows Defender 封装版)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个双击即用的单窗口 WinForms 程序,一键触发 Windows Defender 全盘扫描并自动清除威胁,扫完展示结果。

**Architecture:** 单个原生 `.exe`,核心逻辑是一个静态类 `DefenderScanner`(定位 `MpCmdRun.exe` → 跑 `-Scan -ScanType 2` → 按退出码映射结果 → 经 PowerShell 读威胁清单),UI 是 `MainForm`(一个按钮 + 进度条 + 结果列表),二者通过 `ScanResult`/`ThreatInfo` 类型解耦。用系统自带 `csc.exe` 编译,零工具链。

**Tech Stack:** C# / .NET Framework 4.8(WinForms),系统自带 `csc.exe` 编译,PowerShell(`Get-MpThreatDetection`)读威胁清单。

**Spec:** `docs/superpowers/specs/2026-08-20-oneclick-antivirus-design.md`

## Global Constraints

- 平台:Windows 11 x64。
- 运行时:目标 .NET Framework 4.8(本机 CLR 为 `v4.0.30319`,自带,无需安装)。
- 编译:`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`(本机无 dotnet/msbuild,不得使用)。
- 提权:`app.manifest` 声明 `requireAdministrator`(全盘扫描+清除需要管理员)。
- 扫描:一键即全盘扫描(`-ScanType 2`),自动隔离/清除(Defender 默认动作)。
- UI 文案:简体中文;主按钮文案固定为「🛡️ 一键全盘杀毒」。
- 退出码约定:`0`=未发现威胁,`2`=发现并清除,其他=出错。

---

### Task 1: 结果模型 + 退出码映射(纯逻辑,TDD)

**Files:**
- Create: `OneClickAntivirus/test.bat`
- Create: `OneClickAntivirus/Tests.cs`
- Create: `OneClickAntivirus/DefenderScanner.cs`

**Interfaces:**
- Produces:
  - `enum ScanStatus { Clean, ThreatsFound, Error, NotFound }`
  - `class ThreatInfo { string Name; string Path; string DetectedAt; }`
  - `class ScanResult { ScanStatus Status; int ExitCode; string Message; List<ThreatInfo> Threats; }`
  - `static ScanResult DefenderScanner.MapExitCode(int code)`

- [ ] **Step 1: 写编译脚本 test.bat**

```bat
@echo off
setlocal
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set FW=C:\Windows\Microsoft.NET\Framework64\v4.0.30319

"%CSC%" /nologo /target:exe /out:RunTests.exe ^
  /r:"%FW%\System.dll" ^
  /r:"%FW%\System.Core.dll" ^
  DefenderScanner.cs Tests.cs

if %errorlevel% neq 0 ( echo TEST BUILD FAILED & exit /b 1 )
RunTests.exe
if %errorlevel% neq 0 ( echo TESTS FAILED & exit /b 1 )
echo TESTS PASSED
```

- [ ] **Step 2: 写失败测试 Tests.cs**

```csharp
using System;

namespace OneClickAntivirus
{
    internal static class Tests
    {
        static int failures = 0;

        static void Check(bool cond, string name)
        {
            if (cond) Console.WriteLine("PASS  " + name);
            else { Console.WriteLine("FAIL  " + name); failures++; }
        }

        static void Main()
        {
            ScanResult clean = DefenderScanner.MapExitCode(0);
            Check(clean.Status == ScanStatus.Clean, "退出码 0 → 未发现威胁");
            Check(clean.Message.Contains("未发现"), "退出码 0 文案");

            ScanResult threats = DefenderScanner.MapExitCode(2);
            Check(threats.Status == ScanStatus.ThreatsFound, "退出码 2 → 发现并清除");
            Check(threats.Message.Contains("清除"), "退出码 2 文案");

            ScanResult err = DefenderScanner.MapExitCode(5);
            Check(err.Status == ScanStatus.Error, "退出码 5 → 出错");
            Check(err.Message.Contains("5"), "退出码 5 文案");

            Console.WriteLine(failures == 0 ? "ALL PASS" : (failures + " FAILED"));
            Environment.Exit(failures);
        }
    }
}
```

- [ ] **Step 3: 运行测试,确认失败(编译错误)**

Run: `cd OneClickAntivirus && cmd //c test.bat`
Expected: 编译失败,提示 `DefenderScanner` 不存在。

- [ ] **Step 4: 实现 DefenderScanner.cs(模型 + MapExitCode)**

```csharp
using System;
using System.Collections.Generic;

namespace OneClickAntivirus
{
    public enum ScanStatus { Clean, ThreatsFound, Error, NotFound }

    public class ThreatInfo
    {
        public string Name = "";
        public string Path = "";
        public string DetectedAt = "";
    }

    public class ScanResult
    {
        public ScanStatus Status = ScanStatus.Error;
        public int ExitCode = -1;
        public string Message = "";
        public List<ThreatInfo> Threats = new List<ThreatInfo>();
    }

    public static class DefenderScanner
    {
        public static ScanResult MapExitCode(int code)
        {
            switch (code)
            {
                case 0:
                    return new ScanResult { Status = ScanStatus.Clean, ExitCode = 0, Message = "✅ 扫描完成:未发现任何威胁。" };
                case 2:
                    return new ScanResult { Status = ScanStatus.ThreatsFound, ExitCode = 2, Message = "⚠️ 扫描完成:发现并已清除威胁,详见下方列表。" };
                default:
                    return new ScanResult { Status = ScanStatus.Error, ExitCode = code, Message = "❌ 扫描出错(退出码 " + code + ")。" };
            }
        }
    }
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `cd OneClickAntivirus && cmd //c test.bat`
Expected: 输出 `ALL PASS`,`TESTS PASSED`。

- [ ] **Step 6: Commit**

```bash
cd OneClickAntivirus && git add test.bat Tests.cs DefenderScanner.cs && git commit -m "feat: 退出码映射逻辑 + 结果模型(TDD)"
```

---

### Task 2: 定位 MpCmdRun.exe(路径解析,TDD)

**Files:**
- Modify: `OneClickAntivirus/DefenderScanner.cs`(新增 `FindMpCmdRun`)
- Modify: `OneClickAntivirus/Tests.cs`(新增路径测试)

**Interfaces:**
- Produces: `static string DefenderScanner.FindMpCmdRun()`(返回路径,找不到返回 `null`)

- [ ] **Step 1: 写失败测试(在 Tests.cs 的 Main 末尾、`Environment.Exit` 之前插入)**

```csharp
            string p = DefenderScanner.FindMpCmdRun();
            Check(p != null, "FindMpCmdRun 返回路径");
            Check(p != null && System.IO.File.Exists(p), "MpCmdRun 路径真实存在");
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd OneClickAntivirus && cmd //c test.bat`
Expected: 编译错误,`FindMpCmdRun` 未定义。

- [ ] **Step 3: 实现 FindMpCmdRun(在 DefenderScanner 类内、MapExitCode 之后)**

```csharp
        public static string FindMpCmdRun()
        {
            string a = @"C:\Program Files\Windows Defender\MpCmdRun.exe";
            if (System.IO.File.Exists(a)) return a;

            string platform = @"C:\ProgramData\Microsoft\Windows Defender\Platform";
            if (System.IO.Directory.Exists(platform))
            {
                foreach (string dir in System.IO.Directory.GetDirectories(platform))
                {
                    string exe = System.IO.Path.Combine(dir, "MpCmdRun.exe");
                    if (System.IO.File.Exists(exe)) return exe;
                }
            }
            return null;
        }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd OneClickAntivirus && cmd //c test.bat`
Expected: `ALL PASS`。

- [ ] **Step 5: Commit**

```bash
cd OneClickAntivirus && git add DefenderScanner.cs Tests.cs && git commit -m "feat: 定位 MpCmdRun.exe(Program Files + Platform 双路径)"
```

---

### Task 3: 扫描编排 + 威胁清单解析

**Files:**
- Modify: `OneClickAntivirus/DefenderScanner.cs`(新增 `RunFullScan`、`GetRecentThreats`、`ParseThreatLine`)
- Modify: `OneClickAntivirus/Tests.cs`(新增解析测试)

**Interfaces:**
- Consumes: `MapExitCode`, `FindMpCmdRun`(Task 1/2)
- Produces:
  - `static ScanResult DefenderScanner.RunFullScan()`
  - `static ThreatInfo DefenderScanner.ParseThreatLine(string line)`(返回 `null` 表示跳过该行)

- [ ] **Step 1: 写失败测试(在 Tests.cs 的 Main 末尾、`Environment.Exit` 之前插入)**

```csharp
            ThreatInfo t = DefenderScanner.ParseThreatLine("Worm:Win32/Foo\tC:\\a.exe\t2026-08-20 12:00");
            Check(t != null && t.Name == "Worm:Win32/Foo", "ParseThreatLine 名称");
            Check(t != null && t.Path == "C:\\a.exe", "ParseThreatLine 路径");
            Check(t != null && t.DetectedAt == "2026-08-20 12:00", "ParseThreatLine 时间");
            Check(DefenderScanner.ParseThreatLine("") == null, "ParseThreatLine 空行返回 null");
            Check(DefenderScanner.ParseThreatLine(null) == null, "ParseThreatLine null 返回 null");
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd OneClickAntivirus && cmd //c test.bat`
Expected: 编译错误,`ParseThreatLine` 未定义。

- [ ] **Step 3: 实现 ParseThreatLine + GetRecentThreats + RunFullScan(加在 DefenderScanner 类内,并补 `using System.Diagnostics; using System.IO;`)**

```csharp
        public static ScanResult RunFullScan()
        {
            string mpCmd = FindMpCmdRun();
            if (mpCmd == null)
                return new ScanResult { Status = ScanStatus.NotFound, ExitCode = -1, Message = "❌ 未找到 Windows Defender 扫描组件(MpCmdRun.exe)。" };

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = mpCmd,
                Arguments = "-Scan -ScanType 2",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using (System.Diagnostics.Process p = System.Diagnostics.Process.Start(psi))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();

                ScanResult result = MapExitCode(p.ExitCode);
                if (result.Status == ScanStatus.ThreatsFound)
                    result.Threats = GetRecentThreats();
                return result;
            }
        }

        private static List<ThreatInfo> GetRecentThreats()
        {
            var list = new List<ThreatInfo>();
            string script = "$ErrorActionPreference='SilentlyContinue'; Get-MpThreatDetection | Select-Object -First 50 | ForEach-Object { $n=(Get-MpThreat -ThreatID $_.ThreatID).ThreatName; Write-Output ($n + \"`t\" + ($_.Resources -join '; ') + \"`t\" + $_.InitialDetectionTime.ToString('yyyy-MM-dd HH:mm')) }";

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -NonInteractive -Command \"" + script + "\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using (System.Diagnostics.Process p = System.Diagnostics.Process.Start(psi))
            {
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                foreach (string line in output.Split('\n'))
                {
                    ThreatInfo t = ParseThreatLine(line);
                    if (t != null) list.Add(t);
                }
            }
            return list;
        }

        public static ThreatInfo ParseThreatLine(string line)
        {
            if (line == null) return null;
            line = line.Trim('\r', '\n', ' ', '\t');
            if (line.Length == 0) return null;
            string[] parts = line.Split('\t');
            var t = new ThreatInfo();
            t.Name = parts.Length > 0 ? parts[0] : "";
            t.Path = parts.Length > 1 ? parts[1] : "";
            t.DetectedAt = parts.Length > 2 ? parts[2] : "";
            return t;
        }
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd OneClickAntivirus && cmd //c test.bat`
Expected: `ALL PASS`(验证 `ParseThreatLine`;`RunFullScan`/`GetRecentThreats` 仅编译,不经单元测试)。

- [ ] **Step 5: Commit**

```bash
cd OneClickAntivirus && git add DefenderScanner.cs Tests.cs && git commit -m "feat: 全盘扫描编排 + 威胁清单解析"
```

---

### Task 4: WinForms UI + 打包成 exe

**Files:**
- Create: `OneClickAntivirus/Program.cs`
- Create: `OneClickAntivirus/MainForm.cs`
- Create: `OneClickAntivirus/app.manifest`
- Create: `OneClickAntivirus/build.bat`

**Interfaces:**
- Consumes: `DefenderScanner.RunFullScan()`, `ScanResult`, `ThreatInfo`, `ScanStatus`(Task 1-3)
- Produces: `OneClickAntivirus.exe`(双击可运行)

- [ ] **Step 1: 写 app.manifest(提权清单)**

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
```

- [ ] **Step 2: 写 Program.cs**

```csharp
using System;
using System.Windows.Forms;

namespace OneClickAntivirus
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
```

- [ ] **Step 3: 写 MainForm.cs**

```csharp
using System;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OneClickAntivirus
{
    public class MainForm : Form
    {
        private Button btnScan;
        private ProgressBar progressBar;
        private Label lblStatus;
        private ListBox lstResults;
        private Label lblLastScan;

        public MainForm()
        {
            Text = "一键杀毒";
            ClientSize = new System.Drawing.Size(520, 420);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;

            btnScan = new Button
            {
                Text = "🛡️ 一键全盘杀毒",
                Font = new System.Drawing.Font("Microsoft YaHei UI", 16f, System.Drawing.FontStyle.Bold),
                Size = new System.Drawing.Size(360, 60),
                Location = new System.Drawing.Point(80, 30)
            };
            btnScan.Click += btnScan_Click;

            progressBar = new ProgressBar
            {
                Style = ProgressBarStyle.Blocks,
                Size = new System.Drawing.Size(480, 20),
                Location = new System.Drawing.Point(20, 110)
            };

            lblStatus = new Label
            {
                Text = "点击上方按钮开始全盘杀毒",
                AutoSize = true,
                Font = new System.Drawing.Font("Microsoft YaHei UI", 10f),
                Location = new System.Drawing.Point(20, 145)
            };

            lstResults = new ListBox
            {
                Size = new System.Drawing.Size(480, 200),
                Location = new System.Drawing.Point(20, 175),
                HorizontalScrollbar = true
            };

            lblLastScan = new Label
            {
                Text = "上次扫描时间:—",
                AutoSize = true,
                Font = new System.Drawing.Font("Microsoft YaHei UI", 9f),
                ForeColor = System.Drawing.Color.Gray,
                Location = new System.Drawing.Point(20, 385)
            };

            Controls.Add(btnScan);
            Controls.Add(progressBar);
            Controls.Add(lblStatus);
            Controls.Add(lstResults);
            Controls.Add(lblLastScan);
        }

        private async void btnScan_Click(object sender, EventArgs e)
        {
            btnScan.Enabled = false;
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.MarqueeAnimationSpeed = 30;
            lblStatus.Text = "正在全盘扫描…(可能需要较长时间)";
            lstResults.Items.Clear();

            try
            {
                ScanResult result = await Task.Run(() => DefenderScanner.RunFullScan());

                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 100;
                lblStatus.Text = result.Message;

                foreach (ThreatInfo t in result.Threats)
                    lstResults.Items.Add(t.Name + " — " + t.Path + " (" + t.DetectedAt + ")");

                lblLastScan.Text = "上次扫描时间:" + DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            }
            catch (Exception ex)
            {
                progressBar.Style = ProgressBarStyle.Blocks;
                progressBar.Value = 0;
                lblStatus.Text = "扫描出错:" + ex.Message;
            }
            finally
            {
                btnScan.Enabled = true;
            }
        }
    }
}
```

- [ ] **Step 4: 写 build.bat**

```bat
@echo off
setlocal
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set FW=C:\Windows\Microsoft.NET\Framework64\v4.0.30319

"%CSC%" /nologo /target:winexe /out:OneClickAntivirus.exe /win32manifest:app.manifest ^
  /r:"%FW%\System.dll" ^
  /r:"%FW%\System.Core.dll" ^
  /r:"%FW%\System.Drawing.dll" ^
  /r:"%FW%\System.Windows.Forms.dll" ^
  Program.cs MainForm.cs DefenderScanner.cs

if %errorlevel% neq 0 ( echo BUILD FAILED & exit /b 1 )
echo BUILD OK: OneClickAntivirus.exe
```

- [ ] **Step 5: 编译出 exe**

Run: `cd OneClickAntivirus && cmd //c build.bat`
Expected: `BUILD OK: OneClickAntivirus.exe`,生成 `OneClickAntivirus.exe`。

- [ ] **Step 6: 冒烟测试(可选,验证窗口能打开)**

Run: `cd OneClickAntivirus && ./OneClickAntivirus.exe`
Expected: 弹出 UAC 提权框,确认后显示「一键杀毒」窗口(关闭窗口退出)。若环境无法交互,跳过本步,留到 Task 5 真机验证。

- [ ] **Step 7: Commit**

```bash
cd OneClickAntivirus && git add Program.cs MainForm.cs app.manifest build.bat OneClickAntivirus.exe && git commit -m "feat: WinForms UI + 打包脚本生成 exe"
```

---

### Task 5: 端到端真机验证 + README

**Files:**
- Create: `OneClickAntivirus/README.md`

**Interfaces:**
- Consumes: `OneClickAntivirus.exe`(Task 4)

- [ ] **Step 1: 验证引擎命令可用(快速扫描冒烟,验证"干净"路径退出码 0)**

Run(需管理员终端): `"C:\Program Files\Windows Defender\MpCmdRun.exe" -Scan -ScanType 1`
Expected: 输出 `Scan starting...` → `Scan finished.`,退出码为 `0`(未发现威胁)。确认引擎调用方式正确。

- [ ] **Step 2: 真机全盘扫描验证**

Run: 双击 `OneClickAntivirus.exe` → UAC 确认 → 点「🛡️ 一键全盘杀毒」。
Expected:
- 按钮禁用、进度条滚动、状态显示「正在全盘扫描…」;
- 扫描结束后状态变为「✅ 未发现任何威胁」或「⚠️ 发现并已清除威胁」;
- 若发现威胁,结果列表逐条列出(病毒名 — 路径 — 时间);
- 底部更新「上次扫描时间」;
- 按钮恢复可点。

- [ ] **Step 3: 写 README.md**

````markdown
# 一键杀毒(Windows Defender 封装版)

双击 `OneClickAntivirus.exe`,点「🛡️ 一键全盘杀毒」即可。程序调用系统自带 Windows Defender 引擎做全盘扫描并自动清除威胁,扫完列出结果。

## 重新编译
双击 `build.bat`(用系统自带 csc.exe,无需安装任何工具链)。

## 运行测试
双击 `test.bat`(编译并运行纯逻辑单元测试)。
````

- [ ] **Step 4: Commit**

```bash
cd OneClickAntivirus && git add README.md && git commit -m "docs: 使用与编译说明"
```

---

## 验证清单(收尾自查)

- [ ] `test.bat` 全绿(退出码映射、路径定位、清单解析)。
- [ ] `build.bat` 产出 `OneClickAntivirus.exe`。
- [ ] exe 双击提权运行,一键全盘扫描返回三种结果之一(干净/已清除/出错),文案正确。
- [ ] 发现威胁时列表逐条显示,否则列表为空。
