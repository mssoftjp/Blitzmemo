import {
  getAuditEntries,
  getTopLevelPackageNames,
  hasHighOrCriticalVulnerabilities,
  printSection,
  readPackageJson,
  runNpmJson
} from './deps-lib.mjs';

async function main() {
  const pkg = await readPackageJson();
  const topLevelPackages = getTopLevelPackageNames(pkg);

  const outdatedResult = await runNpmJson(['outdated', '--json']);
  const auditResult = await runNpmJson(['audit', '--json']);

  const outdatedEntries = Object.entries(outdatedResult.data ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
  const directEntries = getAuditEntries(auditResult.data ?? {}, true);
  const transitiveEntries = getAuditEntries(auditResult.data ?? {}, false);
  const topLevelVulnEntries = transitiveEntries.filter(([name]) => topLevelPackages.has(name));

  printSection(
    'Available updates',
    outdatedEntries.map(([name, info]) => `${name}: ${info.current} -> wanted ${info.wanted} (latest ${info.latest})`)
  );

  printSection(
    'Top-level vulnerabilities',
    [...directEntries, ...topLevelVulnEntries]
      .filter((entry, index, arr) => arr.findIndex(([name]) => name === entry[0]) === index)
      .map(([name, detail]) => `${name}: ${detail.severity} (${detail.range ?? 'unknown range'})`)
  );

  printSection(
    'Transitive vulnerabilities',
    transitiveEntries
      .filter(([name]) => !topLevelPackages.has(name))
      .map(([name, detail]) => `${name}: ${detail.severity} (${detail.range ?? 'unknown range'})`)
  );

  const summary = auditResult.data?.metadata?.vulnerabilities ?? {};
  printSection('Security summary', [
    `critical=${summary.critical ?? 0}`,
    `high=${summary.high ?? 0}`,
    `moderate=${summary.moderate ?? 0}`,
    `low=${summary.low ?? 0}`
  ]);

  process.exit(hasHighOrCriticalVulnerabilities(auditResult.data ?? {}) ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
