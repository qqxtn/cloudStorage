# 本地网盘

[English](./README.md) | 简体中文

一个轻量级本地网盘 Web 应用，使用原生 Node.js、HTML、CSS 和 JavaScript 构建。支持管理员管理空间、公有空间、私有空间、大文件流式上传、上传进度、文件列表、下载和删除。

本项目运行时不依赖任何 npm 第三方包。

## 功能特性

- 首次启动自动生成管理员用户名和密码
- 支持管理员登录和退出登录
- 只有管理员可以创建空间和删除空间
- 公有空间不需要密码即可访问
- 私有空间需要输入空间密码，解锁后才显示文件
- 管理员登录后可以访问所有空间，不需要输入空间密码
- 应用打开后默认选择 `公共空间`
- 不同空间的文件相互隔离，保存在 `uploads/<空间名>` 下
- 大文件上传采用流式写入，服务端边接收边落盘
- 浏览器展示上传进度
- 展示文件名、大小和修改时间
- 支持下载和删除文件
- 支持本机访问，也支持同一局域网内其他设备访问

## 技术栈

- Node.js HTTP 服务
- 原生 JavaScript 前端
- HTML 和 CSS
- 基于文件系统的本地存储

## 环境要求

- Node.js 18 或更高版本
- Windows、macOS 或 Linux

## 快速开始

```bash
npm start
```

首次启动时，服务端会在终端打印管理员账号密码：

```text
Admin credentials generated:
  username: admin
  password: <生成的密码>
```

打开：

```text
http://127.0.0.1:3107/
```

服务默认监听 `0.0.0.0`，所以同一局域网内的其他设备也可以通过这台电脑的局域网 IP 访问：

```text
http://<你的局域网IP>:3107/
```

示例：

```text
http://192.168.0.102:3107/
```

## 管理员和空间

只有管理员可以创建或删除空间。

空间类型：

- 公有空间：访问不需要密码。
- 私有空间：需要输入空间密码后，才能查看和上传文件。

管理员权限：

- 管理员登录后，可以直接访问所有空间，不需要输入私有空间密码。
- 管理员可以在管理面板里退出登录。

应用打开后会默认选择 `公共空间`。

## 配置

可以通过环境变量配置监听地址和端口：

```bash
HOST=0.0.0.0 PORT=3107 node server.js
```

Windows PowerShell：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "3107"
npm start
```

## 本地数据

管理员凭据、空间元数据、私有空间密码哈希会保存到：

```text
cloud-drive-data.json
```

这个文件已经被 git 忽略，因为它包含本地凭据。

## 存储结构

上传的文件会保存在 `uploads` 目录：

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
`-- uploads/
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
- 允许 Node.js 或 TCP 端口 `3107` 通过防火墙
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

启动应用：

```bash
npm start
```

## 许可证

MIT
