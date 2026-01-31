/**
 * Bundle Python backend for inclusion in vsix.
 *
 * Copies packages/backend/ → dist/backend/
 * Excludes: tests/, __pycache__/, *.pyc, .pytest_cache/
 */

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.resolve(__dirname, '../backend');
const BACKEND_DST = path.resolve(__dirname, 'dist/backend');

const EXCLUDE_PATTERNS = [
    /^tests$/,
    /^__pycache__$/,
    /^\.pytest_cache$/,
    /\.pyc$/,
    /^\.git$/,
];

function shouldExclude(name) {
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(name));
}

function copyDir(src, dst) {
    if (!fs.existsSync(dst)) {
        fs.mkdirSync(dst, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        if (shouldExclude(entry.name)) {
            continue;
        }

        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

function main() {
    console.log(`Bundling backend: ${BACKEND_SRC} → ${BACKEND_DST}`);

    // Clean destination
    if (fs.existsSync(BACKEND_DST)) {
        fs.rmSync(BACKEND_DST, { recursive: true });
    }

    // Copy
    copyDir(BACKEND_SRC, BACKEND_DST);

    // Verify
    const files = [];
    function countFiles(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                countFiles(fullPath);
            } else {
                files.push(path.relative(BACKEND_DST, fullPath));
            }
        }
    }
    countFiles(BACKEND_DST);

    console.log(`Bundled ${files.length} files:`);
    files.forEach(f => console.log(`  ${f}`));
}

main();
