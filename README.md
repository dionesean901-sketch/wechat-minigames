# 微信小游戏合集 wechat-minigames

四个原创微信小游戏，原生 Canvas 2D 编写，不依赖任何引擎。
同一份 `game.js` 既能在**微信开发者工具**里运行，也能通过内置适配层在**浏览器 / GitHub Pages** 里试玩。

| 游戏 | 目录 | 玩法 |
| --- | --- | --- |
| 🗂️ 代码堆 Code Stack | `games/code-stack` | 叠层三消：点击未被遮挡的代码块放入 7 格卡槽，凑 3 消除；撤销/移出/洗牌道具；关卡程序生成且保证有解 |
| ⭐ 星星收集者 | `games/star-catcher` | 拖动篮子接星星、躲炸弹，金星 +5，连击加分 |
| 🧱 叠叠高 | `games/stack-tower` | 点击落下方块，多出部分被切掉；连续完美对齐方块变宽 |
| 🟩 提交冲刺 Commit Rush | `games/commit-rush` | GitHub 贡献图主题：限时 60 秒点亮绿色 commit，避开红色 bug，结算显示本局热力图 |

## 目录结构

```
games/
  code-stack/        每个游戏都是一个独立的微信小游戏项目
    game.js          入口（全部游戏逻辑）
    game.json        小游戏全局配置（竖屏）
    project.config.json
  star-catcher/
  stack-tower/
  commit-rush/
web/
  index.html         浏览器里的游戏选择页（手机框预览）
  play.html          单个游戏全屏运行页 ?game=<目录名>
  web-adapter.js     用浏览器 API 模拟 wx.createCanvas / onTouch* / Storage 等
.github/workflows/
  check.yml          每次 push / PR 自动做语法和配置检查
  pages.yml          推送到 main 后自动部署到 GitHub Pages
```

## 在微信开发者工具中运行

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/minigame/dev/devtools/download.html)。
2. 「导入项目」→ 目录选择 `games/star-catcher`（或其它游戏目录）。
3. AppID 可先用测试号；正式发布前把 `project.config.json` 里的 `touristappid` 换成你自己的小游戏 AppID。

## 在浏览器中运行

需要一个静态服务器（直接双击打开 html 会因为 file:// 限制无法加载脚本）：

```bash
python3 -m http.server 8080
```

然后访问 <http://localhost:8080/web/>。

## 接入 GitHub

```bash
git remote add origin git@github.com:<你的用户名>/wechat-minigames.git
git push -u origin main
```

- **Actions**：`check.yml` 会自动对所有 `game.js` 做 `node --check`，并校验 JSON 配置。
- **Pages**：仓库 Settings → Pages → Source 选 **GitHub Actions**，之后每次推送 main，
  试玩页就会发布到 `https://<你的用户名>.github.io/wechat-minigames/`，可以直接把链接发给朋友玩。

## 新增一个游戏

1. 复制任一 `games/<name>` 目录并改名，修改 `project.config.json` 里的 `projectname`。
2. 在 `web/play.html` 的 `allowed` 列表和 `web/index.html` 里加上新游戏。
3. 只使用 `web/web-adapter.js` 已模拟的 wx API；如需新的 API（例如 `wx.createInnerAudioContext`），先在适配层里补一个浏览器实现。

## 参考的开源项目

- [justjavac/awesome-wechat-weapp](https://github.com/justjavac/awesome-wechat-weapp) —— 小程序/小游戏资源大全
- [bofeiw/tetris-wechat](https://github.com/bofeiw/tetris-wechat) —— 原生 JS 写的微信小游戏
- [pearmini/life-swings](https://github.com/pearmini/life-swings) —— 小游戏大赛获奖作品
- [dotgreg/weixin-minigame-tutorial](https://github.com/dotgreg/weixin-minigame-tutorial) —— Phaser 接入小游戏教程
- [wechat-miniprogram/minigame-unity-wechat-preview](https://github.com/wechat-miniprogram/minigame-unity-wechat-preview) —— 官方 Unity 转小游戏 SDK

## License

MIT
