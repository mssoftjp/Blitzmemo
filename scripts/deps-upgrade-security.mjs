import {
  formatVersionChange,
  installDevDependencies,
  readPackageJson,
  runNpm,
  runNpmJson
} from './deps-lib.mjs';

function getLatest40X(versionData) {
  const versions = Array.isArray(versionData) ? versionData : [versionData];
  const stable40 = versions.filter((version) => typeof version === 'string' && /^40\.\d+\.\d+$/.test(version));
  return stable40.at(-1) ?? null;
}

async function main() {
  const beforePkg = await readPackageJson();
  const electronVersions = await runNpmJson(['view', 'electron@40', 'version', '--json']);
  const latest40 = getLatest40X(electronVersions.data);
  if (!latest40) {
    throw new Error('failed to resolve the latest electron 40.x version');
  }

  console.log(`Updating electron within 40.x to ${latest40}`);
  const installResult = await installDevDependencies([`electron@${latest40}`]);
  if (installResult.code !== 0) {
    process.exit(installResult.code);
  }

  const afterPkg = await readPackageJson();
  console.log('\nUpdated package baselines');
  console.log(
    `  - ${formatVersionChange(
      'electron',
      beforePkg.devDependencies?.electron ?? beforePkg.dependencies?.electron,
      afterPkg.devDependencies?.electron ?? afterPkg.dependencies?.electron
    )}`
  );

  const statusResult = await runNpm(['run', 'deps:status'], { stdio: 'inherit' });
  process.exit(statusResult.code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
