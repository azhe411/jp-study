# 一駅 · 日语学习

一駅把日语课程排成一条铁路线路。学习者从假名开始，按目标和每天可用的时间安排进度。每一站把课程视频、语法讲解、生词和随堂测验放在一起，学过的词进入间隔复习，答错的题可以单独重练。

同一套 React 界面支持浏览器、PWA、Android 和 Windows。练习涵盖听力、跟读、阅读、写作与场景对话。后端使用 Fastify 和 PostgreSQL。

## 用示例数据体验

安装 Node.js 22.12 或更高版本后，在终端运行以下命令。

```sh
git clone https://github.com/azhe411/jp-study.git
cd jp-study/web
npm ci
npm run dev
```

打开终端显示的本地地址，在末尾加上 `/?preview`。预览使用内置示例账号和学习记录，可直接浏览课程和复习页。

## 运行自己的服务

1. 在仓库根目录将 `deploy/.env.example` 复制为 `deploy/.env`。分别为 `POSTGRES_PASSWORD` 和 `JWT_SECRET` 填写随机值。可用 `node -p "require('node:crypto').randomBytes(32).toString('hex')"` 分别生成两次。
2. 本地 HTTP 调试时设置 `COOKIE_SECURE=false`，正式 HTTPS 部署时设为 `true`。需要 AI 练习时填写 `DEEPSEEK_API_KEY`。如需使用朗读缓存，请让容器内的 UID 1000 对仓库根目录的 `audio/` 有写权限。
3. 从仓库根目录运行 `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`。服务启动时会执行数据库迁移。打开 `http://127.0.0.1:3100/api/v1/health`，可查看数据库和 AI 配置状态。
4. 在 `web/` 目录安装依赖，用以下命令将开发前端接到自己的后端。打开终端显示的地址，用新浏览器会话注册账号。

   ```powershell
   $env:VITE_PROXY_TARGET = 'http://127.0.0.1:3100'
   npm run dev
   ```

   在 Bash 中可运行 `VITE_PROXY_TARGET=http://127.0.0.1:3100 npm run dev`。

## 客户端构建

| 目标 | 从 `web/` 开始 |
| --- | --- |
| 网页 / PWA | `npm run build`，将生成的 `dist/` 放到静态服务器，将同源的 `/api/` 反向代理到后端。 |
| Android | 准备 JDK 21 和 Android SDK 36。运行 `npm run android:sync`，把下述模型复制到原生资源目录，再在 `android/` 下运行 Gradle wrapper 的 `assembleDebug`。用 `-Dorg.gradle.java.home=<JDK 路径>` 覆盖项目原有的本机路径。 |
| Windows | 准备 Rust、MSVC C++ 构建工具和 WebView2。`npm run desktop:dev` 启动桌面开发模式。打包用 `npm run desktop:build`，当前配置要求为更新包提供与公钥配对的 Tauri 签名私钥。自行分发时请使用自己的密钥对。 |

原生客户端的后端地址在 `web/.env.android` 和 `web/.env.desktop`。自行部署时，同步修改 Tauri 的 CSP、更新地址和更新公钥，并设置后端的 `PUBLIC_BASE_URL`。

离线日语识别模型随源码存放在 `web/native-assets/vosk-model-small-ja-0.22.tar.gz`。Windows 构建会自动复制它。Android 打包前，将它复制为 `web/android/app/src/main/assets/models/vosk-model-small-ja-0.22.tar.gz.bin`，保留末尾的 `.bin`。网页自托管时，将原压缩包放入仓库根目录的 `models/`，Compose 会将该目录挂载给后端。

## 项目目录

| 路径 | 内容 |
| --- | --- |
| `web/` | React、Vite、PWA、Capacitor Android 和 Tauri Windows 客户端 |
| `server/` | Fastify API、数据库迁移、课程内容和复习调度 |
| `shared/` | 前后端共用的类型、枚举和常量 |
| `deploy/` | Docker Compose、Caddy 示例及备份恢复脚本 |
| `site/get/` | 应用下载页和素材署名 |

接口定义见 [OpenAPI](openapi.yaml) 和 [API 契约](CONTRACT.md)。

## 许可证

原创代码采用 [MIT 许可证](LICENSE)。照片、字体、语音模型、读音词表和其他第三方组件的来源与许可见[第三方声明](THIRD_PARTY_NOTICES.md)。
