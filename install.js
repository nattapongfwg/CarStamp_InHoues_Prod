// Test Commit
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const requiredPackages = {
  googleapis: '^171.4.0',
  nodemailer: '^8.0.3',
  playwright: '^1.58.2',
};

const packageJsonPath = path.join(process.cwd(), 'package.json');

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit' });
}

function readPackageJson() {
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    throw new Error('package.json exists but is not valid JSON');
  }
}

function ensurePackageJson() {
  if (!fs.existsSync(packageJsonPath)) {
    console.log('package.json not found. Creating one...');
    run('npm init -y');
  } else {
    console.log('package.json found.');
  }
}

function getInstalledVersionFromPackageJson(packageName) {
  const packageJson = readPackageJson();
  if (!packageJson) return null;

  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  return allDeps[packageName] || null;
}

function isNodeModuleInstalled(packageName) {
  const packagePath = path.join(process.cwd(), 'node_modules', packageName);
  return fs.existsSync(packagePath);
}

function getMissingOrMismatchedPackages() {
  const packagesToInstall = [];

  for (const [pkg, requiredVersion] of Object.entries(requiredPackages)) {
    const versionInPackageJson = getInstalledVersionFromPackageJson(pkg);
    const installedInNodeModules = isNodeModuleInstalled(pkg);

    const versionMismatch = versionInPackageJson !== requiredVersion;
    const notInstalled = !installedInNodeModules;

    if (versionMismatch || notInstalled) {
      packagesToInstall.push(`${pkg}@${requiredVersion}`);
    }
  }

  return packagesToInstall;
}

function installRequiredPackages() {
  const packagesToInstall = getMissingOrMismatchedPackages();

  if (packagesToInstall.length === 0) {
    console.log('\nAll required packages are already installed and matched.');
    return;
  }

  console.log('\nInstalling/updating packages:');
  for (const pkg of packagesToInstall) {
    console.log(`- ${pkg}`);
  }

  run(`npm install ${packagesToInstall.join(' ')}`);
}

function installPlaywrightBrowsers() {
  if (!isNodeModuleInstalled('playwright')) {
    console.log('\nPlaywright package is not installed, skipping browser setup.');
    return;
  }

  console.log('\nInstalling Playwright browsers...');
  run('npx playwright install');
}

function main() {
  try {
    ensurePackageJson();
    installRequiredPackages();
    installPlaywrightBrowsers();

    console.log('\nSetup completed successfully.');
    console.log('You can now run: node index.js');
  } catch (error) {
    console.error('\nSetup failed:', error.message);
    process.exit(1);
  }
}

main();