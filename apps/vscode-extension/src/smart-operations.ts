import * as vscode from 'vscode';
import { isLocalChangesOverwriteError } from '@git4vsc/git-core';
import type { RepositoryController } from '@git4vsc/repo-state';
import { readGeneralSettings } from './settings.js';

export async function updateWithSmartFallback(repository: RepositoryController, remote: string, branch: string, rebase: boolean): Promise<boolean> {
  try {
    await repository.pullBranch(remote, branch, rebase);
    return true;
  } catch (error) {
    if (!readGeneralSettings().smartOperations || !isLocalChangesOverwriteError(error)) throw error;
    const choice = await vscode.window.showWarningMessage(
      'Local changes prevent the update.',
      { modal: true, detail: 'Smart Update temporarily stashes local changes, updates the branch, then restores the changes.' },
      'Smart Update'
    );
    if (choice !== 'Smart Update') return false;
    await repository.smartPullBranch(remote, branch, rebase);
    return true;
  }
}

export async function checkoutWithSmartFallback(repository: RepositoryController, target: string, detach = false, track = false): Promise<boolean> {
  try {
    await repository.checkout(target, detach, track);
    return true;
  } catch (error) {
    if (!readGeneralSettings().smartOperations || !isLocalChangesOverwriteError(error)) throw error;
    const choice = await vscode.window.showWarningMessage(
      `Local changes prevent checkout of ${target}.`,
      { modal: true, detail: 'Smart Checkout stashes and restores local changes. Force Checkout permanently discards tracked local changes.' },
      'Smart Checkout',
      'Force Checkout'
    );
    if (choice === 'Smart Checkout') await repository.smartCheckout(target, detach, track);
    else if (choice === 'Force Checkout') await repository.forceCheckout(target, detach, track);
    else return false;
    return true;
  }
}

export async function createAndCheckoutWithSmartFallback(repository: RepositoryController, name: string, startPoint: string, track = false): Promise<boolean> {
  try {
    await repository.createAndCheckoutBranch(name, startPoint, track);
    return true;
  } catch (error) {
    if (!readGeneralSettings().smartOperations || !isLocalChangesOverwriteError(error)) throw error;
    const choice = await vscode.window.showWarningMessage(
      `Local changes prevent checkout of ${name}.`,
      { modal: true, detail: 'Smart Checkout temporarily stashes local changes, creates the branch, then restores the changes.' },
      'Smart Checkout'
    );
    if (choice !== 'Smart Checkout') return false;
    await repository.smartCreateAndCheckoutBranch(name, startPoint, track);
    return true;
  }
}

export async function runSmartCheckoutFallback(repository: RepositoryController, target: string, operation: () => Promise<void>, smartOperation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    if (!readGeneralSettings().smartOperations || !isLocalChangesOverwriteError(error)) throw error;
    const choice = await vscode.window.showWarningMessage(
      `Local changes prevent checkout of ${target}.`,
      { modal: true, detail: 'Smart Checkout temporarily stashes local changes, completes the branch operation, then restores the changes.' },
      'Smart Checkout'
    );
    if (choice !== 'Smart Checkout') return false;
    await smartOperation();
    return true;
  }
}
