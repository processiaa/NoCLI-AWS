# NoCLI AWS

[Leer documentacion en Espanol](README.es.md)

**NoCLI AWS** is an open-source desktop application designed to manage AWS services visually without needing web console access (`aws.amazon.com`) or pre-installed `aws-cli` tools.

In many enterprise environments, security teams disable browser console access and distribute short-lived programmatic credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`). NoCLI AWS removes terminal friction by letting users paste their temporary credential block and immediately browse Amazon S3 buckets and push or pull Docker images with Amazon ECR.

---

## Key Features

### 1. Smart Paste Authentication and Session Guard
- **Multi-format Smart Paste**: Paste raw blocks directly from PowerShell (`$env:AWS_ACCESS_KEY_ID=...`), Bash (`export ...`), Windows CMD (`set ...`), `~/.aws/credentials` INI format, or `aws sts` JSON output.
- **Real-time STS Verification**: Validates active credentials via `sts:GetCallerIdentity` and displays the active AWS Account ID, IAM Role/Principal, and Region.
- **In-place Token Renewal**: Automatically detects `ExpiredTokenException` and lets users paste a fresh temporary token without closing the application or losing their active S3 folder or ECR view.
- **RAM-first Security with Optional OS Vault**: Credentials live strictly in RAM by default and never overwrite `~/.aws/credentials`. Users can optionally store encrypted profiles using native OS encryption (`Electron safeStorage` backed by Windows DPAPI / macOS Keychain / Linux Secret Service).

### 2. Amazon S3 Visual File Explorer
- **Direct Bucket/Prefix Navigation**: Navigate directly to `s3://my-corporate-bucket/reports/` even when corporate IAM policies block global bucket listing (`s3:ListAllMyBuckets`).
- **Desktop Drag and Drop**: Drag files or entire folder hierarchies from your OS file manager into S3 with automatic multipart streaming (`@aws-sdk/lib-storage`) and real-time progress tracking.
- **In-memory File Preview**: Inspect `.json`, `.csv` (rendered as an interactive table), `.txt`, `.md`, `.log`, `.yaml`, `.xml`, and images directly without downloading them to disk.
- **Presigned URL Generator**: Create temporary shareable download links with configurable expiration windows and automatic clipboard copy.

### 3. Amazon ECR and Local Docker Manager
- **Full-Width ECR with Collapsible Docker Drawer**: Local Docker stays neatly tucked into a smooth sliding drawer on the left so it never gets in the way when Docker Desktop is closed, expanding on demand with one click.
- **Image Lifecycle and Retention Inspector**: View per-image age, last recorded pull time, and storage tier (`Standard` vs `Archive`), inspect repository Lifecycle rules translated into plain language, run official AWS Lifecycle Preview dry-runs to see which images will expire, and apply preset retention templates.
- **One-Click Local Docker Login**: Fetches ECR authorization tokens through AWS SDK v3 and authenticates your local Docker daemon silently without chaining terminal commands.
- **Visual Push and Pull Assistant**: Tag and push local images to ECR or pull remote ECR images to your local machine with layer-by-layer progress bars.
- **PowerShell Command Generator (Fallback)**: Generates ready-to-copy PowerShell commands both in **Direct Mode (zero AWS CLI required)** and **Standard AWS CLI Mode**.

### 4. Human-Readable IAM Error Translation
- Translates raw AWS `AccessDenied` responses into clear explanations indicating which specific IAM permission (`s3:PutObject`, `s3:DeleteObject`, `ecr:GetAuthorizationToken`, etc.) is restricted on the current token.

---

## Architecture

For security and performance, the Renderer UI never communicates directly with AWS APIs or the local Docker socket. All I/O runs inside Electron's isolated Main Process over a typed IPC bridge.

```text
+-------------------------------------------------------------------+
|                      NOCLI AWS DESKTOP APP                        |
|                                                                   |
|  +-----------------------+             +-----------------------+  |
|  |   RENDERER (React)    |  Typed IPC  |  MAIN PROCESS (Node)  |  |
|  |   React + Tailwind    | <=========> |  Electron + AWS SDK   |  |
|  |                       |  Preload    |                       |  |
|  | - Smart Paste UI      |             | - RAM Session Manager |  |
|  | - S3 File Explorer    |             | - S3 Multipart Stream |  |
|  | - ECR / Docker Split  |             | - ECR + Dockerode API |  |
|  +-----------------------+             +-----------+-----------+  |
+----------------------------------------------------|--------------+
                                                     |
                    +--------------------------------+--------------------+
                    |                                                     |
                    v (HTTPS - AWS SDK v3)                                v (Named Pipe / Unix Socket)
      +---------------------------+                         +---------------------------+
      |         AWS CLOUD         |                         |       LOCAL DOCKER        |
      | - STS (GetCallerIdentity) |                         | - Docker Engine Daemon    |
      | - S3 (Buckets & Objects)  |                         |   (//./pipe/docker_engine)|
      | - ECR (Repos & AuthToken) |                         |   (/var/run/docker.sock)  |
      +---------------------------+                         +---------------------------+
```

---

## Getting Started

### Prerequisites
- **Node.js** 18 or newer
- **npm** 9 or newer
- **Docker Desktop / Docker Engine** (optional; only needed for direct local Push/Pull operations)
- **No AWS CLI installation required**

### Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/processiaa/NoCLI-AWS.git
cd NoCLI-AWS

# 2. Install dependencies
npm install

# 3. Launch the desktop app in development mode with hot reload
npm run dev
```

### Typechecking and Building Installers

```bash
# Run TypeScript checks across Main, Preload, and Renderer
npm run typecheck

# Build production bundles into ./out
npm run build

# Package native desktop installers into ./dist
npm run win     # Windows (.exe NSIS installer)
npm run mac     # macOS (.dmg installer)
npm run linux   # Linux (.AppImage)
```

---

## Roadmap

NoCLI AWS starts with **Amazon S3** and **Amazon ECR**, and is architected so new AWS service modules can be added cleanly:
- [x] Smart Paste STS Credential Parser and Session Guard
- [x] Amazon S3 File Explorer (Multipart Upload, Preview, Presigned URLs)
- [x] Amazon ECR and Local Docker Manager
- [ ] Amazon CloudWatch Logs Viewer (tail and filter log groups without CLI)
- [ ] AWS Secrets Manager and SSM Parameter Store Inspector
- [ ] Amazon SQS Queue Inspector and Message Sender
- [ ] Amazon DynamoDB Table Browser

---

## Contributing and Security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) to learn how to set up your environment, follow architectural guidelines, and add new AWS service modules.
- Read [SECURITY.md](SECURITY.md) for details on how credentials are handled and how to report security vulnerabilities responsibly.
- Please review our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for full details.
