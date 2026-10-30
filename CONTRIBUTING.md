# Contributing to NoCLI AWS

Thank you for your interest in contributing to **NoCLI AWS**. Our mission is to provide an intuitive, secure, zero-CLI desktop interface for developers and analysts working with restricted or temporary AWS credentials.

---

## Development Workflow

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/processiaa/NoCLI-AWS.git
   cd NoCLI-AWS
   npm install
   ```
2. **Create a Feature Branch**:
   ```bash
   git checkout -b feat/cloudwatch-logs-viewer
   ```
3. **Run in Development Mode**:
   ```bash
   npm run dev
   ```
4. **Validate Before Submitting**:
   Ensure both TypeScript configurations (Node Main/Preload and React Renderer) and the production bundle succeed without errors:
   ```bash
   npm run typecheck
   npm run build
   ```

---

## Architectural Principles

When contributing new features or new AWS service integrations (such as CloudWatch Logs, Secrets Manager, SQS, or DynamoDB), please follow these strict boundaries:

1. **Two-Process Security Boundary**:
   - The React Renderer (`src/renderer/`) **must never** import `@aws-sdk/*`, `dockerode`, `fs`, or `child_process`.
   - All AWS SDK calls, local filesystem streams, and Docker socket interactions belong exclusively in `src/main/`.
   - Expose strictly typed IPC methods through `src/preload/index.ts` using `contextBridge.exposeInMainWorld`.

2. **RAM-First Credential Handling**:
   - Never write AWS keys or session tokens to plaintext files, logs, or `~/.aws/credentials`.
   - Use `awsManager` in `src/main/aws-manager.ts` to instantiate SDK clients from the active in-memory session.
   - Any optional local persistence must go through `profileStorage` (`Electron safeStorage`).

3. **Human-Readable Error Translation**:
   - Corporate IAM roles often have granular restrictions. Wrap new IPC handlers with `toFailureResponse(error, 'service:ActionName')` from `src/main/error-translator.ts` and add friendly permission explanations for new IAM actions.
   - Ensure `ExpiredTokenException` propagates `isExpiredToken: true` so the UI prompts for in-place token renewal instead of failing silently.

4. **Streaming Over Buffering**:
   - Never load large S3 payloads or Docker image layers entirely into memory. Always stream uploads, downloads, and progress events over IPC (`transfer:progress`).

---

## Guide: Adding a New AWS Service Module

1. Install the modular AWS SDK v3 client (for example `@aws-sdk/client-cloudwatch-logs`).
2. Define shared request/response interfaces in `src/shared/types.ts`.
3. Instantiate and manage the client lifecycle inside `src/main/aws-manager.ts` (including region switching in `changeRegion` and cleanup in `disconnect`).
4. Add friendly IAM permission mappings in `src/main/error-translator.ts`.
5. Register `ipcMain.handle(...)` channels in `src/main/index.ts` and expose typed methods in `src/preload/index.ts`.
6. Build the React view component under `src/renderer/src/components/` and wire it into the sidebar navigation in `src/renderer/src/App.tsx`.

---

## Documentation Standards

- Keep all Markdown files clean, professional, and strictly free of emojis or emoticons.
- If you add user-facing features, update both `README.md` (English) and `README.es.md` (Spanish).

---

## Pull Request Checklist

- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run build` succeeds cleanly.
- [ ] No credentials, account IDs, or private corporate bucket/repository names appear in code, tests, or screenshots.
- [ ] Error states (`ExpiredTokenException` and `AccessDenied`) are handled gracefully in the UI.

