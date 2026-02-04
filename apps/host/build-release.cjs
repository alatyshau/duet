/**
 * Bump version and build release with version in filename.
 * Usage: npm run release [-- --mac|--win|--linux]
 *        node build-release.cjs [--mac|--win|--linux]
 *
 * Creates:
 * - macOS: dist/Duet-{version}.dmg
 * - Windows: dist/Duet-{version}-setup.exe
 * - Linux: dist/Duet-{version}.AppImage
 *
 * IMPORTANT: When Host installs backend, it must write this version
 * to DuetData/backend/VERSION for version tracking.
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

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Version bumped to ${newVersion}`);

// Determine platform from args (default: mac)
const args = process.argv.slice(2);
let platform = 'mac';
if (args.includes('--win')) platform = 'win';
else if (args.includes('--linux')) platform = 'linux';

console.log(`Building release for ${platform}...`);
execSync(`npm run build:${platform}`, { stdio: 'inherit', cwd: __dirname });

// Output expected artifact path
const artifacts = {
    mac: `dist/Duet-${newVersion}.dmg`,
    win: `dist/Duet-${newVersion}-setup.exe`,
    linux: `dist/Duet-${newVersion}.AppImage`
};

console.log(`\n✅ Release built: ${artifacts[platform]}`);
console.log(`\n📝 Remember: Host must write version ${newVersion} to DuetData/backend/VERSION when installing backend.`);
