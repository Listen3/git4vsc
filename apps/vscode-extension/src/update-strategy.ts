import * as vscode from 'vscode';

export async function pickUpdateStrategy(): Promise<boolean | undefined> {
  const picked = await vscode.window.showQuickPick([
    {
      label: 'Merge incoming changes into the current branch',
      description: 'Default',
      picked: true,
      rebase: false
    },
    {
      label: 'Rebase the current branch on top of incoming changes',
      rebase: true
    }
  ], {
    title: 'Update Project',
    placeHolder: 'Choose how to integrate incoming changes'
  });
  return picked?.rebase;
}
