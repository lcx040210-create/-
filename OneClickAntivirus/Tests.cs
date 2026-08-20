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

            Console.WriteLine(failures == 0 ? "ALL PASS" : (failures + " FAILED"));
            Environment.Exit(failures);
        }
    }
}
