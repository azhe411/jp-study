# 第三方声明

- **Barlow Semi Condensed** 字体由 The Barlow Project Authors 创作。下载页使用的字体遵循 SIL Open Font License 1.1。[字体许可证](site/get/fonts/OFL.txt)
- **下载页照片** 来自 Wikimedia Commons。各图的作者、原始文件地址及各自的 CC BY、CC BY-SA 或 CC0 条款列在[图片署名记录](site/get/assets/credits.json)中。
- **日语语音识别模型** 来自 Alpha Cephei 的 `vosk-model-small-ja-0.22`，上游许可为 Apache-2.0。仓库采用适用于客户端的 tar.gz 封装。[Vosk 模型目录](https://alphacephei.com/vosk/models) · [许可证](licenses/Apache-2.0.txt)
- **日语读音对照表** 位于 `server/src/content/voskReadings.json.gz`，由项目用 kuromoji 对 Vosk 词表标注并转换为平假名。kuromoji 使用 MeCab IPADIC 词典，其署名和使用条款随附。[kuromoji.js](https://github.com/takuyaa/kuromoji.js) · [词典声明](licenses/kuromoji-NOTICE.md)
- **Gradle Wrapper** 由 Gradle 项目提供，启动脚本保留上游版权声明。[Gradle](https://github.com/gradle/gradle) · [Apache-2.0](licenses/Apache-2.0.txt)
- **课程视频** 由哔哩哔哩 UP 主「教日语的阿飞老师」发布。应用通过视频编号和分集索引访问原平台，视频版权归相应权利人。[原课程](https://www.bilibili.com/video/BV1Bp4y1D747/)

npm 和 Cargo 依赖各自沿用上游许可证，具体版本记录在相应的 lockfile 中。
