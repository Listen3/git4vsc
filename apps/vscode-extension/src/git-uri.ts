import * as vscode from 'vscode';
import type { RepositoryController } from '@git4vsc/repo-state';

export function gitResourceUri(repository: RepositoryController, path: string, revision: string | null): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'git4vsc',
    path: `/${path.replaceAll('\\', '/')}`,
    query: encodeURIComponent(JSON.stringify({ root: repository.root, path, revision }))
  });
}
