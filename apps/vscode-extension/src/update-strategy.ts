import * as vscode from 'vscode';
import { readGeneralSettings, type UpdateStrategySetting } from './settings.js';

export function configuredUpdateStrategy(): UpdateStrategySetting {
  return readGeneralSettings().updateStrategy;
}

export async function pickUpdateStrategy(): Promise<boolean | undefined> {
  const configured = configuredUpdateStrategy();
  if (configured !== 'ask') return configured === 'rebase';
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
