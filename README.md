# Local Cloud Drive

English | [中文](./README.zh-CN.md)

A lightweight local cloud-drive app for personal and LAN file sharing. It supports admin-managed storage spaces, public/private access, large-file streaming uploads, upload progress, file listing, image preview, downloads, deletion, and a Windows single-file EXE with a system tray icon.

The Node.js version has no runtime npm dependencies. The Windows EXE is self-contained and does not require Node.js.

## Features

- Generate admin credentials on first run
- Admin login and logout
- Admin logout returns the app to the public space
- Admin-only space creation and deletion
- Public spaces that anyone can access without a password
- Private spaces that require a space password before files are shown
- Admin can access all spaces without entering private-space passwords
- The app opens on `Public Space` / `公共空间` by default
- Keep files isolated by space under `uploads/<space-name>`
- Stream large files directly to disk without compression or transcoding
- Show upload progress in the browser
- List file name, size, and modified time
- Preview uploaded images in the browser
- Mobile-friendly image preview with scrollable full-image viewing
- Download and delete files
- Access from localhost or another device on the same LAN
- Windows EXE runs without a console window
- Windows tray menu for opening the app, copying admin credentials, opening uploads, and exiting

## Run With Node.js

Requirements:

- Node.js 18 or newer
- Windows, macOS, or Linux

Start the app:

```bash
npm start
```

On first run, the server prints admin credentials:

```text
Admin credentials:
  username: admin
  password: <generated-password>
```

Open:

```text
http://127.0.0.1:3107/
```

The server listens on `0.0.0.0` by default, so other devices on the same LAN can also visit it with your computer's LAN IP:

```text
http://<your-lan-ip>:3107/
```

## Run With Windows EXE

Build output:

```text
dist/CloudStorage.exe
```

Double-click `CloudStorage.exe` to start the app. It runs in the background without opening a CMD window.

On first start, the app shows a copyable admin credential dialog. After startup, a tray icon appears in the Windows notification area.

Tray menu:

- Open cloud drive
- Copy admin password
- Open uploads folder
- Exit

Runtime data is created next to the EXE:

```text
cloud-drive-data.json
uploads/
```

## Build Windows EXE

Requirements:

- .NET SDK 7.0

Publish:

```powershell
dotnet publish exe-src\CloudStorageExe.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=none -p:DebugSymbols=false -o dist
```

Only `dist/CloudStorage.exe` is needed to run the packaged app.

## Admin and Spaces

Only the admin can create or delete spaces.

Space types:

- Public space: no password is required.
- Private space: users must enter the space password before files are listed or uploaded.

Admin access:

- After admin login, all spaces are accessible without entering private-space passwords.
- Admin can log out from the admin panel.
- After admin logout, the app switches back to the public space.

The app selects `公共空间` by default when opened.

## Configuration

Node.js version:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "3107"
npm start
```

EXE version:

```powershell
$env:CLOUD_STORAGE_URL = "http://0.0.0.0:3107"
.\CloudStorage.exe
```

## Local Data

Admin credentials, space metadata, and private-space password hashes are stored in:

```text
cloud-drive-data.json
```

This file is ignored by git because it contains local credentials.

## Storage Layout

Uploaded files are stored in the `uploads` directory:

```text
uploads/
  公共空间/
    example.mp4
  User A/
    report.pdf
  User B/
    photo.png
```

Each space maps to one directory. Files uploaded to one space are not shown in other spaces.

If a file with the same name already exists, the server keeps both files by appending a suffix:

```text
video.mp4
video-1.mp4
video-2.mp4
```

## Project Structure

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

Ignored runtime/build output:

```text
uploads/
cloud-drive-data.json
dist/
exe-src/bin/
exe-src/obj/
```

## API Overview

Admin login:

```http
POST /api/admin/login
Content-Type: application/json

{
  "username": "admin",
  "password": "<password>"
}
```

Admin logout:

```http
POST /api/admin/logout
x-admin-token: <token>
```

List spaces:

```http
GET /api/spaces
```

Create a space:

```http
POST /api/spaces
x-admin-token: <token>
Content-Type: application/json

{
  "name": "User A",
  "visibility": "private",
  "password": "space-password"
}
```

Unlock a private space:

```http
POST /api/spaces/login
Content-Type: application/json

{
  "name": "User A",
  "password": "space-password"
}
```

List files in a space:

```http
GET /api/files?space=User%20A
x-space-token: <space-token>
```

Upload a file:

```http
POST /api/upload?space=User%20A
x-file-name: video.mp4
x-space-token: <space-token>
Content-Type: video/mp4
```

Download a file:

```http
GET /files?space=User%20A&name=video.mp4&token=<space-token>
```

Delete a file:

```http
DELETE /api/files?space=User%20A&name=video.mp4
x-space-token: <space-token>
```

Delete a space:

```http
DELETE /api/spaces?space=User%20A
x-admin-token: <token>
```

## LAN Access Notes

If `http://127.0.0.1:3107/` works but `http://<your-lan-ip>:3107/` does not:

- Make sure the other device is on the same network
- Use the real LAN IP, not a virtual adapter IP
- Allow Node.js, `CloudStorage.exe`, or TCP port `3107` through the firewall
- Avoid guest Wi-Fi networks that block device-to-device access

On Windows, `ipconfig` can show your LAN IP. It is usually under an Ethernet or Wi-Fi adapter and often looks like `192.168.x.x`.

## Security Notes

This is a local-network file sharing app, not a production cloud storage service.

It currently does not include:

- HTTPS
- User-level accounts
- Fine-grained permission management
- File type restrictions
- Virus scanning

Only run it on a trusted network. Do not expose it directly to the public internet without adding stronger authentication and transport security.

## Development

Check JavaScript syntax:

```bash
node --check server.js
node --check public/app.js
```

Check EXE project:

```powershell
dotnet build exe-src\CloudStorageExe.csproj -c Release
```

## License

MIT
