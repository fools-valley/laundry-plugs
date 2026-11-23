export function formatPlugName(identifier: string) {
  return identifier.replaceAll('-', ' ').replace(/\bwashing machine\b/g, 'washer');
}
