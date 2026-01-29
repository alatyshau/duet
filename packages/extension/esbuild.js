const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    // Copy sql-wasm.wasm to dist
    const wasmSource = path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
    const distDir = path.join(__dirname, 'dist');
    
    // Check if wasm exists at workspace root (monorepo structure)
    let finalWasmSource = wasmSource;
    if (!fs.existsSync(wasmSource)) {
         // Fallback to local node_modules
         finalWasmSource = path.join(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
    }

    if (fs.existsSync(finalWasmSource)) {
        if (!fs.existsSync(distDir)) {
            fs.mkdirSync(distDir, { recursive: true });
        }
        fs.copyFileSync(finalWasmSource, path.join(distDir, 'sql-wasm.wasm'));
        console.log(`Copied sql-wasm.wasm from ${finalWasmSource} to dist/`);
    } else {
        console.error('Could not find sql-wasm.wasm to copy!');
    }

    // Common build options
    const commonOptions = {
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        logLevel: 'silent',
        plugins: [esbuildProblemMatcherPlugin],
    };

    // Extension build
    const extCtx = await esbuild.context({
        ...commonOptions,
        entryPoints: ['src/vscode/extension.ts'],
        outfile: 'dist/extension.js',
        external: ['vscode'],
    });

    // MCP Server build (standalone process, bundle everything)
    const mcpCtx = await esbuild.context({
        ...commonOptions,
        entryPoints: ['src/mcp-server/index.ts'],
        outfile: 'dist/mcp-server.js',
        external: [],
    });

    if (watch) {
        await extCtx.watch();
        await mcpCtx.watch();
    } else {
        await extCtx.rebuild();
        await mcpCtx.rebuild();
        await extCtx.dispose();
        await mcpCtx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
