# 本地网盘

[English](./README.md) | 中文

一个轻量级本地网盘应用，适合个人和局域网文件共享。支持管理员管理空间、公有/私有空间、大文件流式上传、上传进度、文件列表、下载、删除，以及带系统托盘图标的 Windows 单文件 EXE。

Node.js 版本运行时不依赖任何 npm 第三方包。Windows EXE 是自包含程序，不需要安装 Node.js。

## 功能

- 首次启动自动生成管理员账号和密码
- 支持管理员登录和退出登录
- 管理员退出登录后自动回到公共空间
- 只有管理员可以创建和删除空间
- 公有空间无需密码即可访问
- 私有空间需要输入空间密码后才能查看文件
- 管理员登录后可以访问所有空间，不需要输入私有空间密码
- 应用默认打开 `公共空间`
- 不同空间文件相互隔离，保存到 `uploads/<空间名>`
- 大文件直接流式写入磁盘，不压缩、不转码
- 浏览器显示上传进度
- 展示文件名、大小和修改时间
- 支持下载和删除文件
- 支持本机访问，也支持同一局域网内其他设备访问
- Windows EXE 运行时不弹出 CMD 窗口
- Windows 托盘菜单支持打开网盘、复制管理员密码、打开上传目录和退出程序

## 使用 Node.js 运行

环境要求：

- Node.js 18 或更高版本
- Windows、macOS 或 Linux

启动应用：

```bash
npm start
```

首次启动时，服务端会打印管理员账号密码：

```text
Admin credentials:
  username: admin
  password: <生成的密码>
```

打开：

```text
http://127.0.0.1:3107/
```

服务默认监听 `0.0.0.0`，同一局域网内的其他设备也可以通过这台电脑的局域网 IP 访问：

```text
http://<你的局域网IP>:3107/
```

## 使用 Windows EXE 运行

构建产物：

```text
dist/CloudStorage.exe
```

双击 `CloudStorage.exe` 即可启动。程序会在后台运行，不会弹出 CMD 窗口。

首次启动时，会弹出可复制的管理员账号密码窗口。启动后，Windows 右下角通知区域会显示托盘图标。

托盘菜单：

- 打开网盘
- 复制管理员密码
- 打开上传目录
- 退出程序

运行时数据会生成在 EXE 同级目录：

```text
cloud-drive-data.json
uploads/
```

## 构建 Windows EXE

环境要求：

- .NET SDK 7.0

发布命令：

```powershell
dotnet publish exe-src\CloudStorageExe.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=none -p:DebugSymbols=false -o dist
```

打包后只需要 `dist/CloudStorage.exe` 就能运行。

## 管理员和空间

只有管理员可以创建或删除空间。

空间类型：

- 公有空间：访问不需要密码。
- 私有空间：需要输入空间密码后，才能查看和上传文件。

管理员权限：

- 管理员登录后，可以直接访问所有空间，不需要输入私有空间密码。
- 管理员可以在管理面板里退出登录。
- 管理员退出登录后，应用会自动切换回公共空间。

应用打开后默认选择 `公共空间`。

## 配置

Node.js 版本：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "3107"
npm start
```

EXE 版本：

```powershell
$env:CLOUD_STORAGE_URL = "http://0.0.0.0:3107"
.\CloudStorage.exe
```

## 本地数据

管理员凭据、空间元数据、私有空间密码哈希会保存到：

```text
cloud-drive-data.json
```

这个文件已经被 git 忽略，因为它包含本地凭据。

## 存储结构

上传的文件会保存到 `uploads` 目录：

```text
uploads/
  公共空间/
    example.mp4
  用户A/
    report.pdf
  用户B/
    photo.png
```

每个空间对应一个独立目录。上传到某个空间的文件，不会显示在其他空间里。

如果同名文件已经存在，服务端会自动追加后缀，避免覆盖：

```text
video.mp4
video-1.mp4
video-2.mp4
```

## 项目结构

```text
.
|-- package.json
|-- README.md
|-- README.zh-CN.md
|-- server.js
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
`-- exe-src/
    |-- app.ico
    |-- CloudStorageExe.csproj
    `-- Program.cs
```

被忽略的运行和构建产物：

```text
uploads/
cloud-drive-data.json
dist/
exe-src/bin/
exe-src/obj/
```

## API 概览

管理员登录：

```http
POST /api/admin/login
Content-Type: application/json

{
  "username": "admin",
  "password": "<管理员密码>"
}
```

管理员退出登录：

```http
POST /api/admin/logout
x-admin-token: <token>
```

获取空间列表：

```http
GET /api/spaces
```

创建空间：

```http
POST /api/spaces
x-admin-token: <token>
Content-Type: application/json

{
  "name": "用户A",
  "visibility": "private",
  "password": "空间密码"
}
```

解锁私有空间：

```http
POST /api/spaces/login
Content-Type: application/json

{
  "name": "用户A",
  "password": "空间密码"
}
```

获取某个空间的文件列表：

```http
GET /api/files?space=%E7%94%A8%E6%88%B7A
x-space-token: <space-token>
```

上传文件：

```http
POST /api/upload?space=%E7%94%A8%E6%88%B7A
x-file-name: video.mp4
x-space-token: <space-token>
Content-Type: video/mp4
```

下载文件：

```http
GET /files?space=%E7%94%A8%E6%88%B7A&name=video.mp4&token=<space-token>
```

删除文件：

```http
DELETE /api/files?space=%E7%94%A8%E6%88%B7A&name=video.mp4
x-space-token: <space-token>
```

删除空间：

```http
DELETE /api/spaces?space=%E7%94%A8%E6%88%B7A
x-admin-token: <token>
```

## 局域网访问说明

如果 `http://127.0.0.1:3107/` 可以访问，但 `http://<你的局域网IP>:3107/` 访问不了：

- 确认另一台设备和本机在同一个网络下
- 使用真实局域网 IP，不要使用虚拟网卡 IP
- 允许 Node.js、`CloudStorage.exe` 或 TCP 端口 `3107` 通过防火墙
- 避免使用会阻止设备互访的访客 Wi-Fi

Windows 下可以通过 `ipconfig` 查看局域网 IP。通常它在以太网或 Wi-Fi 适配器下，格式类似 `192.168.x.x`。

## 安全说明

这是一个本地局域网文件共享应用，不是生产级云存储服务。

当前尚未包含：

- HTTPS
- 多用户账号体系
- 细粒度权限管理
- 文件类型限制
- 病毒扫描

请只在可信网络内运行。不要在没有更强认证和传输加密的情况下直接暴露到公网。

## 开发

检查 JavaScript 语法：

```bash
node --check server.js
node --check public/app.js
```

检查 EXE 项目：

```powershell
dotnet build exe-src\CloudStorageExe.csproj -c Release
```

## 许可证

MIT
