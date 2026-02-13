# Contributing to lhremote

Thank you for your interest in contributing to lhremote!

## Contributor License Agreement (CLA)

By submitting a pull request or otherwise contributing to this project, you agree to the following terms:

1. **Grant of Rights**: You grant the project maintainer(s) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, distribute, sublicense, and otherwise exploit your contribution in any form.

2. **Dual Licensing**: You acknowledge that the maintainer(s) may offer the software under alternative licenses (including commercial licenses) in addition to the AGPL-3.0 license, and your contribution may be included in such offerings.

3. **Original Work**: You represent that your contribution is your original work, or you have the right to submit it under these terms.

4. **No Warranty**: You provide your contribution "as is" without warranty of any kind.

### How to Agree

By submitting a pull request, you indicate agreement with this CLA. No separate signature is required.

For substantial contributions, please include the following sign-off in your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

You can add this automatically with `git commit -s`.

## Development

### Prerequisites

- **Node.js** >= 24
- **pnpm** 9.15.4

### Setup

```sh
git clone https://github.com/alexey-pelykh/lhremote.git
cd lhremote
pnpm install
pnpm build
```

To run integration tests, install Chromium for Playwright:

```sh
npx playwright-core install chromium --with-deps
```

### Running Tests

```sh
pnpm test          # unit + integration tests
pnpm lint          # lint checks
```

### Project Structure

The repository is a pnpm monorepo with four packages:

| Package | Description |
|---------|-------------|
| `packages/core` | CDP client, LinkedHelper service layer, database access |
| `packages/mcp` | MCP server exposing LinkedHelper tools |
| `packages/cli` | CLI interface wrapping the same tools |
| `packages/lhremote` | Umbrella package published to npm |

### E2E Tests

E2E tests (`pnpm test:e2e`) require the LinkedHelper desktop application with an active license. They are not part of CI and are intended for local use only.

### Conventions

Follow the project conventions documented in [CLAUDE.md](CLAUDE.md).

### Submitting Changes

1. Fork and create a feature branch
2. Make changes following project conventions
3. Commit with descriptive message (see CLAUDE.md for format)
4. Open a pull request

## Code of Conduct

- Be respectful and constructive
- Focus on the technical merits
- This tool is for personal productivity only — contributions enabling spam, scraping, or harassment will be rejected

## Questions?

Open an issue for discussion before starting significant work.
