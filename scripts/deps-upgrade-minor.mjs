import {
  MINOR_UPGRADE_PACKAGES,
  formatVersionChange,
  installDevDependencies,
  readPackageJson,
  runNpmJson
} from './deps-lib.mjs';

async function main() {
  const beforePkg = await readPackageJson();
  const outdatedResult = await runNpmJson(['outdated', '--json']);
  const outdated = outdatedResult.data ?? {};

  const specs = MINOR_UPGRADE_PACKAGES
    .filter((name) => typeof outdated[name]?.wanted === 'string' && outdated[name].wanted !== outdated[name].current)
    .map((name) => `${name}@${outdated[name].wanted}`);

  if (specs.length === 0) {
    console.log('No approved patch/minor upgrades are currently available.');
    return;
  }

  console.log(`Updating approved packages: ${specs.join(', ')}`);
  const installResult = await installDevDependencies(specs);
  if (installResult.code !== 0) {
    process.exit(installResult.code);
  }

  const afterPkg = await readPackageJson();
  console.log('\nUpdated package baselines');
  for (const name of MINOR_UPGRADE_PACKAGES) {
    const beforeVersion = beforePkg.devDependencies?.[name] ?? beforePkg.dependencies?.[name];
    const afterVersion = afterPkg.devDependencies?.[name] ?? afterPkg.dependencies?.[name];
    if (beforeVersion === afterVersion) continue;
    console.log(`  - ${formatVersionChange(name, beforeVersion, afterVersion)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
