# Security Policy

Because **NoCLI AWS** handles AWS programmatic credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`), security and credential isolation are top priorities of the project.

---

## Security Architecture

1. **Zero Telemetry and Zero Third-Party Servers**:
   - NoCLI AWS has no custom backend, analytics, or telemetry servers.
   - Network requests go exclusively from your local machine directly to official AWS HTTPS endpoints via the official modular `@aws-sdk/*` v3 packages, and locally to your machine's Docker daemon socket/pipe (`//./pipe/docker_engine` or `/var/run/docker.sock`).

2. **RAM-Only Credentials by Default**:
   - By default, pasted credentials reside solely in the Electron Main Process memory and are wiped immediately when disconnecting or closing the application.
   - NoCLI AWS never modifies or overwrites `~/.aws/credentials` or `~/.aws/config`.

3. **OS-Native Encrypted Vault (Optional)**:
   - When a user explicitly opts into saving a profile locally, credentials are encrypted using Electron's `safeStorage` API, which delegates encryption to **Windows DPAPI**, **macOS Keychain**, or **Linux Secret Service** (`libsecret`).
   - If OS-level encryption is unavailable on the host system, profile persistence is automatically disabled rather than falling back to plaintext storage.

4. **Electron Process Isolation**:
   - BrowserWindow instances run with `contextIsolation: true` and `nodeIntegration: false`.
   - External URLs are intercepted via `setWindowOpenHandler` and opened strictly in the system browser rather than inside the application window.
   - Content Security Policy (CSP) headers restrict scripts and resources inside `src/renderer/index.html`.

---

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

---

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, please report security issues privately using **GitHub Private Vulnerability Reporting** (under the repository's **Security > Advisories > Report a vulnerability** tab) or by contacting the repository maintainers directly.

When reporting a vulnerability, please include:
- A clear description of the issue and potential impact.
- Step-by-step reproduction instructions or proof-of-concept.
- Affected operating system(s) and application version.

We aim to acknowledge vulnerability reports within 72 hours and coordinate a fix and disclosure timeline with the reporter.

