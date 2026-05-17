# Local Cloud Drive

English | [Chinese](./README.zh-CN.md)

A lightweight local cloud-drive web app built with plain Node.js and vanilla HTML/CSS/JavaScript. It supports isolated storage spaces, large-file uploads, upload progress, file listing, downloads, and deletion.

This project has no runtime npm dependencies.

## Features

- Create multiple storage spaces, such as `User A` and `User B`
- Upload files into the currently selected space
- Keep files isolated by space under `uploads/<space-name>`
- Stream large files directly to disk on the server
- Show upload progress in the browser
- List file name, size, and modified time
- Download and delete files
- Access from localhost or another device on the same LAN

## Tech Stack

- Node.js HTTP server
- Vanilla JavaScript frontend
- HTML and CSS
- Filesystem-based storage

## Requirements

- Node.js 18 or newer
- Windows, macOS, or Linux

## Quick Start

```bash
npm start
```

Open:

```text
http://127.0.0.1:3107/
```

The server listens on `0.0.0.0` by default, so other devices on the same LAN can also visit it with your computer's LAN IP:

```text
http://<your-lan-ip>:3107/
```

Example:

```text
http://192.168.0.102:3107/
```

## Configuration

You can configure the host and port with environment variables:

```bash
HOST=0.0.0.0 PORT=3107 node server.js
```

On Windows PowerShell:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "3107"
npm start
```

## Storage Layout

Uploaded files are stored in the `uploads` directory:

```text
uploads/
  Default Space/
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
`-- uploads/
```

## API Overview

List spaces:

```http
GET /api/spaces
```

Create a space:

```http
POST /api/spaces
Content-Type: application/json

{
  "name": "User A"
}
```

List files in a space:

```http
GET /api/files?space=User%20A
```

Upload a file:

```http
POST /api/upload?space=User%20A
x-file-name: video.mp4
Content-Type: video/mp4
```

Download a file:

```http
GET /files?space=User%20A&name=video.mp4
```

Delete a file:

```http
DELETE /api/files?space=User%20A&name=video.mp4
```

## LAN Access Notes

If `http://127.0.0.1:3107/` works but `http://<your-lan-ip>:3107/` does not:

- Make sure the other device is on the same network
- Use the real LAN IP, not a virtual adapter IP
- Allow Node.js or TCP port `3107` through the firewall
- Avoid guest Wi-Fi networks that block device-to-device access

On Windows, `ipconfig` can show your LAN IP. It is usually under an Ethernet or Wi-Fi adapter and often looks like `192.168.x.x`.

## Security Notes

This is a local-network file sharing app, not a production cloud storage service.

It currently does not include:

- User login
- Password protection
- Permission management
- HTTPS
- File type restrictions
- Virus scanning

Only run it on a trusted network. Do not expose it directly to the public internet without adding authentication and transport security.

## Development

Check JavaScript syntax:

```bash
node --check server.js
node --check public/app.js
```

Start the app:

```bash
npm start
```

## License

MIT
