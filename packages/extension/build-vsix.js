/**
 * Bump version and build VSIX with version in filename.
 * Usage: node build-vsix.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Bump patch version
const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;

// Update viewContainer title
const container = pkg.contributes.viewsContainers.activitybar.find(c => c.id === 'duet-explorer');
if (container) {
    container.title = `Duet ${newVersion}`;
}

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 4) + '\n', 'utf8');
console.log(`Version bumped to ${newVersion}`);

const outputFile = `dist/duet-${newVersion}.vsix`;

console.log(`Building VSIX: ${outputFile}`);
execSync(`vsce package --no-dependencies -o ${outputFile}`, { stdio: 'inherit' });
