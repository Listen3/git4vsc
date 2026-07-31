const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

function git(root, ...args) {
  return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createConflictRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git4vsc-extension-test-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Git4VSC Test');
  git(root, 'config', 'user.email', 'git4vsc@example.test');
  for (const file of ['first.txt', 'second.txt']) fs.writeFileSync(path.join(root, file), `base ${file}`);
  git(root, 'add', '--all');
  git(root, 'commit', '-m', 'base');
  git(root, 'checkout', '-b', 'topic');
  for (const file of ['first.txt', 'second.txt']) fs.writeFileSync(path.join(root, file), `incoming ${file}`);
  git(root, 'commit', '-am', 'incoming');
  git(root, 'checkout', 'main');
  for (const file of ['first.txt', 'second.txt']) fs.writeFileSync(path.join(root, file), `current ${file}`);
  git(root, 'commit', '-am', 'current');
  try { git(root, 'merge', '--no-edit', 'topic'); } catch { /* expected conflicts */ }
  return root;
}

async function main() {
  const repository = createConflictRepository();
  try {
    await runTests({
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, 'suite', 'index.cjs'),
      launchArgs: [repository, '--disable-extensions']
    });
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
