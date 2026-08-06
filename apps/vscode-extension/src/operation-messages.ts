export function updateResultMessage(files: number, commits: number): string {
  return `${files} ${files === 1 ? 'file' : 'files'} updated in ${commits} ${commits === 1 ? 'commit' : 'commits'}.`;
}

export function pushResultMessage(commits: number, target: string): string {
  return `Pushed ${commits} ${commits === 1 ? 'commit' : 'commits'} to ${target}.`;
}

export function changelistDeleteMessage(name: string, files: number, target: string): string {
  return files
    ? `Deleted changelist ${name}. Moved ${files} ${files === 1 ? 'file' : 'files'} to ${target}.`
    : `Deleted empty changelist ${name}.`;
}
