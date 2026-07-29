const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('Git4VSC Extension Host', () => {
  test('activates and registers public commands', async () => {
    const extension = vscode.extensions.getExtension('git4vsc.git4vsc');
    assert.ok(extension, 'extension should be installed in the development host');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('git4vsc.refresh'));
    assert.ok(commands.includes('git4vsc.openLog'));
  });
});

