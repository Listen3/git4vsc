import * as vscode from 'vscode';

export type UpdateStrategySetting = 'ask' | 'merge' | 'rebase';

export interface GeneralSettings {
  updateStrategy: UpdateStrategySetting;
  showResultNotifications: boolean;
  showOperationProgress: boolean;
}

export type GeneralSettingKey = keyof GeneralSettings;

export const defaultGeneralSettings: GeneralSettings = {
  updateStrategy: 'ask',
  showResultNotifications: true,
  showOperationProgress: true
};

export function readGeneralSettings(): GeneralSettings {
  const configuration = vscode.workspace.getConfiguration('git4vsc');
  return {
    updateStrategy: configuration.get<UpdateStrategySetting>('updateStrategy', defaultGeneralSettings.updateStrategy),
    showResultNotifications: configuration.get<boolean>('showResultNotifications', defaultGeneralSettings.showResultNotifications),
    showOperationProgress: configuration.get<boolean>('showOperationProgress', defaultGeneralSettings.showOperationProgress)
  };
}

export function validGeneralSetting(key: unknown, value: unknown): key is GeneralSettingKey {
  if (key === 'updateStrategy') return value === 'ask' || value === 'merge' || value === 'rebase';
  return (key === 'showResultNotifications' || key === 'showOperationProgress') && typeof value === 'boolean';
}

export async function updateGeneralSetting(key: GeneralSettingKey, value: GeneralSettings[GeneralSettingKey]): Promise<void> {
  await vscode.workspace.getConfiguration('git4vsc').update(key, value, vscode.ConfigurationTarget.Global);
}

export async function resetGeneralSettings(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('git4vsc');
  await Promise.all((Object.keys(defaultGeneralSettings) as GeneralSettingKey[]).map(key => configuration.update(key, undefined, vscode.ConfigurationTarget.Global)));
}
