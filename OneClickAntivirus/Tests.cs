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

            Console.WriteLine(failures == 0 ? "ALL PASS" : (failures + " FAILED"));
            Environment.Exit(failures);
        }
    }
}
