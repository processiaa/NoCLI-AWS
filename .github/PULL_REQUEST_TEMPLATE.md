## Summary
Briefly describe the changes introduced in this Pull Request and link any related issue (e.g., `Closes #12`).

## Changes Made
- 
- 

## Security and Architecture Checklist
- [ ] All AWS SDK, filesystem, and Docker Engine calls run strictly in `src/main/` (never in `src/renderer/`).
- [ ] Credentials remain in RAM by default and never touch plaintext disk files or `~/.aws/credentials`.
- [ ] IAM `AccessDenied` and STS `ExpiredTokenException` errors are translated cleanly via `src/main/error-translator.ts`.
- [ ] No real credentials, Account IDs, or private resource names are present in code or commits.
- [ ] Documentation Markdown files contain no emojis or emoticons.

## Verification
- [ ] `npm run typecheck` passes without errors.
- [ ] `npm run build` completes without errors.
- [ ] Tested manually in development mode (`npm run dev`).

