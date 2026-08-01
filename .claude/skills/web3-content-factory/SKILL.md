---
name: web3-content-factory
description: Use when creating Chinese Web3 content for X/Twitter — airdrop tutorials, degen farming guides, or sponsored brand advertorials. Triggers on: 空投教程, 撸毛攻略, 商单, 品牌推广, Web3内容创作, X平台文案
---

# Web3 内容工厂

Lee 的 Web3 中文内容创作入口。不做预处理，直接启动创作 agent。

## 执行

1. 读取 memory `web3-content-preferences`（如存在，作为用户偏好上下文）
2. 启动 `web3-content-factory` agent，传入：
   - 用户的原始消息（完整文本 + 所有链接）
   - memory 内容（如存在）
3. 不做任何预处理、不追问任何问题、不解析用户输入
