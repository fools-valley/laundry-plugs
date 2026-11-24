export function getPlugLabels(identifiers: Iterable<string>) {
  const baseNames = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const identifier of new Set(identifiers)) {
    const baseName = identifier.replace(/-\d+$/, '');
    baseNames.set(identifier, baseName);
    counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const [identifier, baseName] of baseNames) {
    labels.set(identifier, (counts.get(baseName) === 1 ? baseName : identifier).replaceAll('-', ' '));
  }
  return labels;
}
