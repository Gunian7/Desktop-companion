双击启动说明

1. start-all.bat
   这是主入口。
   它会先确保 F:\You\GPT-SoVITS\GPT-SoVITS-v2pro-20250604 的 API 服务启动在 http://127.0.0.1:9880，
   而且 GPT-SoVITS 的启动命令已经直接写在脚本里，不再额外依赖 api.bat。
   然后自动在 F:\You\desktop-vtuber 里执行 npm start。
   如果第一次加载模型较慢，等待几十秒到几分钟都是正常的。
   现在 SoVITS 等待逻辑已经拆到 scripts\ensure-sovits.ps1，稳定性会更高。

2. start-app-only.bat
   只启动桌面 VTuber 应用。
   适合 GPT-SoVITS 已经手动启动好的情况。

首次使用前请确认：

- config.json 里的 LLM 接口信息已配置完成
- GPT-SoVITS 路径仍然是 F:\You\GPT-SoVITS\GPT-SoVITS-v2pro-20250604
- 如果 node_modules 不存在，start-all.bat 会自动执行一次 npm install
- 如果之前开过很多测试窗口，先关掉旧的 electron 进程会更干净
