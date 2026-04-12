/**
 * clean-for-lambda.mjs
 *
 * Strips packages that are either provided by the Lambda Node.js 20 runtime
 * or are not needed at runtime, bringing the zip well under 10 MB.
 *
 * Run AFTER `npm install --omit=dev`, BEFORE zipping.
 * On Windows, open a FRESH terminal (DLL files get locked once loaded).
 *
 * Usage:
 *   node clean-for-lambda.mjs           — clean only
 *   node clean-for-lambda.mjs --zip     — clean then create lambda.zip
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const args  = process.argv.slice(2);
const doZip = args.includes('--zip');

// ── Packages to remove before zipping ────────────────────────────────────────
//
// Lambda Node.js 20 runtime ships with AWS SDK v3 built in:
//   @aws-sdk/*, @smithy/*, @aws-crypto/*
// Bundling them wastes ~18 MB with no benefit.
//
// Everything else below is either a dev dep or was removed from package.json.
const dirsToRemove = [
    // Provided by the Lambda Node.js 20 runtime — safe to exclude
    'node_modules/@aws-sdk',
    'node_modules/@smithy',
    'node_modules/@aws-crypto',

    // Removed from package.json (contact feature uses browser Gmail compose, not API)
    'node_modules/@googleapis',

    // Dev deps — should not be present after `--omit=dev`, but guard anyway
    'node_modules/@xenova',
    'node_modules/@huggingface',
    'node_modules/@types',
    'node_modules/rollup',
    'node_modules/@rollup',

    // Leftover large packages from old deps
    'node_modules/onnxruntime-web',
    'node_modules/onnxruntime-node',
    'node_modules/sharp',
    'node_modules/protobufjs/cli',
];

let lockedDirs = [];

for (const dir of dirsToRemove) {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
        console.log(`⏩ Skipped (not found): ${dir}`);
        continue;
    }
    try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        if (fs.existsSync(fullPath)) throw new Error('Still exists after rmSync');
        console.log(`✅ Deleted: ${dir}`);
    } catch (err) {
        console.warn(`⚠️  Locked (Windows DLL in use): ${dir}`);
        lockedDirs.push(dir);
    }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────');
if (lockedDirs.length > 0) {
    console.warn('⚠️  Some directories could not be deleted because Windows has');
    console.warn('   their files locked (loaded by a prior Node process).');
    console.warn('');
    console.warn('   Fix: close VS Code and all terminals, open a FRESH terminal,');
    console.warn('   cd into the lambda/ folder, and re-run:');
    console.warn('     node clean-for-lambda.mjs');
    console.warn('');
    console.warn('   Locked dirs (still in zip until deleted):');
    lockedDirs.forEach(d => console.warn(`     • ${d}`));
} else {
    console.log('🧹 Cleanup complete!');
    console.log('   Remaining: index.mjs + package.json + node_modules/jose (~460 KB)');
    console.log('   Expected zip size: < 1 MB');
}

// ── Optional zip ──────────────────────────────────────────────────────────────
if (doZip) {
    console.log('\n📦 Creating lambda.zip …');

    const zipPath = path.resolve('..', 'lambda.zip');

    // Only include the runtime files — exclude dev scripts and local tools
    const includeFiles = ['index.mjs', 'package.json', 'node_modules'];

    const excludeFlags = lockedDirs
        .map(d => `-xr!"${d.replace(/\//g, '\\')}"`).join(' ');

    // Try 7-Zip first (most reliable on Windows)
    try {
        const targets = includeFiles.join(' ');
        execSync(
            `7z a -tzip -mx=5 "${zipPath}" ${targets} ${excludeFlags}`,
            { cwd: path.resolve('.'), stdio: 'inherit' }
        );
        console.log(`✅ lambda.zip created: ${zipPath}`);
    } catch {
        // Fall back to PowerShell (includes all files in current dir — less optimal but works)
        console.warn('⚠️  7-Zip not found — falling back to PowerShell Compress-Archive.');
        try {
            execSync(
                `powershell.exe -Command "Compress-Archive -Path index.mjs,package.json,node_modules -DestinationPath '${zipPath.replace(/\//g, '\\')}' -Force"`,
                { cwd: path.resolve('.'), stdio: 'inherit' }
            );
            console.log(`✅ lambda.zip created: ${zipPath}`);
        } catch (e2) {
            console.error('❌ Zip failed:', e2.message);
        }
    }
}
