# Third-Party Notices

## JetBrains IntelliJ Community Edition

This project studies the architecture and behavior of JetBrains IntelliJ Community Edition, including Git4Idea and the platform VCS Log implementation:

- Source: https://github.com/JetBrains/intellij-community
- License: Apache License 2.0
- Copyright: JetBrains s.r.o. and contributors

No JetBrains source code, trademarks, icons, or proprietary visual assets are included in this repository. The TypeScript Git graph and all application code in this repository are original implementations based on independently described behavior and public Git formats.

If a future change ports or adapts Apache-2.0 source code, that change must add the source file URL and revision here, preserve its copyright header in the adapted file, and include the Apache License 2.0 text in the distribution before merge.

## Microsoft Visual Studio Code

The project uses the public VS Code Extension API and studies the built-in Git extension as an interoperability reference:

- Source: https://github.com/microsoft/vscode
- License: MIT
- Copyright: Microsoft Corporation

No VS Code source code or product artwork is copied into this repository. `@types/vscode` and `@vscode/test-electron` are development dependencies under their published licenses.

## Runtime and build dependencies

The project currently uses React, Vite, Vitest, TypeScript, tsup, ESLint and their transitive dependencies under their respective published open-source licenses. Production packaging must generate a dependency license inventory from the lockfile and ship all notices required by the versions actually included. Development-only packages are not bundled into the VS Code extension or uTools plugin.

## uTools

uTools is a target host platform. This repository contains an original `plugin.json`, preload bridge and logo. It does not redistribute uTools software or brand assets.

