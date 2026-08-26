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

        public static ScanResult MapScanResult(int exitCode, string output)
        {
            string o = output == null ? "" : output.Trim();
            if (o.IndexOf("Product/Feature disabled", StringComparison.OrdinalIgnoreCase) >= 0)
                return new ScanResult { Status = ScanStatus.Error, ExitCode = exitCode, Message = "❌ Windows Defender 已被第三方杀毒软件禁用,无法扫描。请卸载第三方杀毒软件以启用 Defender,或直接使用你已安装的杀毒软件。" };
            if (o.IndexOf("Failed with hr", StringComparison.OrdinalIgnoreCase) >= 0 || o.IndexOf("hr = 0x", StringComparison.OrdinalIgnoreCase) >= 0)
                return new ScanResult { Status = ScanStatus.Error, ExitCode = exitCode, Message = "❌ 扫描失败:Windows Defender 引擎不可用(通常是第三方杀毒软件禁用了 Defender)。\n" + o };
            return MapExitCode(exitCode);
        }

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

                ScanResult result = MapScanResult(p.ExitCode, stdout + "\n" + stderr);
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
    }
}
