# ADR 0001: Electron, React, and TypeScript

- Status: Accepted for M0
- Decision: Use Electron with React and TypeScript in a pnpm workspace.
- Context: The product needs a macOS desktop boundary and a TypeScript ecosystem for later PDF and Markdown work.
- Consequences: One language and strong shared contracts reduce delivery risk; Electron size and privileged-main-process risk require explicit security tests.
