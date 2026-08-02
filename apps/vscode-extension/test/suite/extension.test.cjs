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
    assert.ok(commands.includes('git4vsc.openSettings'));
    assert.ok(commands.includes('git4vsc.toggleLog'));
    assert.ok(commands.includes('git4vsc.openCommitView'));
    assert.ok(commands.includes('git4vsc.showBranchMenu'));
    assert.ok(commands.includes('git4vsc.updateCurrentBranch'));
    assert.ok(commands.includes('git4vsc.pushCurrentBranch'));
    assert.ok(commands.includes('git4vsc.stashChanges'));
    assert.ok(commands.includes('git4vsc.manageStashes'));
    assert.ok(commands.includes('git4vsc.justifyPanel'));
    assert.ok(commands.includes('git4vsc.repositories.focus'));
    assert.ok(commands.includes('git4vsc.resolveConflicts'));
    assert.ok(commands.includes('git4vsc.openConflict'));
    assert.ok(commands.includes('git4vsc.markConflictResolved'));
    assert.ok(commands.includes('git4vsc.continueOperation'));
    assert.ok(commands.includes('git4vsc.abortOperation'));
  });

  test('opens stage-based merge inputs and advances to the next conflict', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('git4vsc.resolveConflicts');
    const first = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(first?.label.includes('first.txt'), `expected first conflict tab, got ${first?.label}`);

    await vscode.commands.executeCommand('git4vsc.markConflictResolved');
    const second = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(second?.label.includes('second.txt'), `expected second conflict tab, got ${second?.label}`);
  });
});
