import * as vscode from 'vscode';

export type UpdateStrategySetting = 'ask' | 'merge' | 'rebase';

export interface GeneralSettings {
  updateStrategy: UpdateStrategySetting;
  protectedBranches: string[];
  confirmForcePush: boolean;
  autoUpdateOnPushRejected: boolean;
  smartOperations: boolean;
  showResultNotifications: boolean;
  showOperationProgress: boolean;
}

export type GeneralSettingKey = keyof GeneralSettings;

export const defaultGeneralSettings: GeneralSettings = {
  updateStrategy: 'ask',
  protectedBranches: ['main', 'master', 'release/*'],
  confirmForcePush: true,
  autoUpdateOnPushRejected: false,
  smartOperations: true,
  showResultNotifications: true,
  showOperationProgress: true
};

export function readGeneralSettings(): GeneralSettings {
  const configuration = vscode.workspace.getConfiguration('git4vsc');
  return {
    updateStrategy: configuration.get<UpdateStrategySetting>('updateStrategy', defaultGeneralSettings.updateStrategy),
    protectedBranches: configuration.get<string[]>('protectedBranches', defaultGeneralSettings.protectedBranches),
    confirmForcePush: configuration.get<boolean>('confirmForcePush', defaultGeneralSettings.confirmForcePush),
    autoUpdateOnPushRejected: configuration.get<boolean>('autoUpdateOnPushRejected', defaultGeneralSettings.autoUpdateOnPushRejected),
    smartOperations: configuration.get<boolean>('smartOperations', defaultGeneralSettings.smartOperations),
    showResultNotifications: configuration.get<boolean>('showResultNotifications', defaultGeneralSettings.showResultNotifications),
    showOperationProgress: configuration.get<boolean>('showOperationProgress', defaultGeneralSettings.showOperationProgress)
  };
}

export function validGeneralSetting(key: unknown, value: unknown): key is GeneralSettingKey {
  if (key === 'updateStrategy') return value === 'ask' || value === 'merge' || value === 'rebase';
  if (key === 'protectedBranches') return Array.isArray(value) && value.every(pattern => typeof pattern === 'string');
  return (key === 'confirmForcePush' || key === 'autoUpdateOnPushRejected' || key === 'smartOperations' || key === 'showResultNotifications' || key === 'showOperationProgress') && typeof value === 'boolean';
}

export async function updateGeneralSetting(key: GeneralSettingKey, value: GeneralSettings[GeneralSettingKey]): Promise<void> {
  await vscode.workspace.getConfiguration('git4vsc').update(key, value, vscode.ConfigurationTarget.Global);
}

export async function resetGeneralSettings(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('git4vsc');
  await Promise.all((Object.keys(defaultGeneralSettings) as GeneralSettingKey[]).map(key => configuration.update(key, undefined, vscode.ConfigurationTarget.Global)));
}
