export function updateResultMessage(files: number, commits: number): string {
  return `${files} ${files === 1 ? 'file' : 'files'} updated in ${commits} ${commits === 1 ? 'commit' : 'commits'}.`;
}

export function pushResultMessage(commits: number, target: string): string {
  return `Pushed ${commits} ${commits === 1 ? 'commit' : 'commits'} to ${target}.`;
}
