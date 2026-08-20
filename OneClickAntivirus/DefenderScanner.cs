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
