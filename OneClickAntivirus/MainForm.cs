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
