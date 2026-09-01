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

            string p = DefenderScanner.FindMpCmdRun();
            Check(p != null, "FindMpCmdRun 返回路径");
            Check(p != null && System.IO.File.Exists(p), "MpCmdRun 路径真实存在");

            ThreatInfo t = DefenderScanner.ParseThreatLine("Worm:Win32/Foo\tC:\\a.exe\t2026-08-20 12:00");
            Check(t != null && t.Name == "Worm:Win32/Foo", "ParseThreatLine 名称");
            Check(t != null && t.Path == "C:\\a.exe", "ParseThreatLine 路径");
            Check(t != null && t.DetectedAt == "2026-08-20 12:00", "ParseThreatLine 时间");
            Check(DefenderScanner.ParseThreatLine("") == null, "ParseThreatLine 空行返回 null");
            Check(DefenderScanner.ParseThreatLine(null) == null, "ParseThreatLine null 返回 null");

            ScanResult failed = DefenderScanner.MapScanResult(2, "CmdTool: Failed with hr = 0x80004005.");
            Check(failed.Status == ScanStatus.Error, "输出含 Failed → 判定为失败而非清除威胁");
            Check(failed.Message.Contains("失败") || failed.Message.Contains("禁用"), "失败文案");

            ScanResult realThreats = DefenderScanner.MapScanResult(2, "Scan starting...\nScan finished.");
            Check(realThreats.Status == ScanStatus.ThreatsFound, "无失败字样 + 退出码 2 → 发现威胁");

            ScanResult cleanEmpty = DefenderScanner.MapScanResult(0, "");
            Check(cleanEmpty.Status == ScanStatus.Clean, "退出码 0 → 未发现威胁");

            Check(DiskCleaner.FormatBytes(0) == "0 B", "FormatBytes 0 B");
            Check(DiskCleaner.FormatBytes(512) == "512 B", "FormatBytes 512 B");
            Check(DiskCleaner.FormatBytes(1024) == "1.0 KB", "FormatBytes 1 KB");
            Check(DiskCleaner.FormatBytes(1536) == "1.5 KB", "FormatBytes 1.5 KB");
            Check(DiskCleaner.FormatBytes(1048576) == "1.0 MB", "FormatBytes 1 MB");
            Check(DiskCleaner.FormatBytes(1073741824) == "1.0 GB", "FormatBytes 1 GB");

            string tmp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "DCT_" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(tmp);
            System.IO.File.WriteAllBytes(System.IO.Path.Combine(tmp, "a.bin"), new byte[100]);
            System.IO.File.WriteAllBytes(System.IO.Path.Combine(tmp, "b.bin"), new byte[200]);
            long freed = DiskCleaner.CleanDirectory(tmp);
            Check(freed == 300, "CleanDirectory 释放 300 字节(实际 " + freed + ")");
            Check(!System.IO.File.Exists(System.IO.Path.Combine(tmp, "a.bin")), "CleanDirectory 删除文件 a");
            Check(!System.IO.File.Exists(System.IO.Path.Combine(tmp, "b.bin")), "CleanDirectory 删除文件 b");

            Console.WriteLine(failures == 0 ? "ALL PASS" : (failures + " FAILED"));
            Environment.Exit(failures);
        }
    }
}
