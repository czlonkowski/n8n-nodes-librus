const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	mkdtempSync,
	mkdirSync,
	copyFileSync,
	writeFileSync,
	rmSync,
	readFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');

for (const extra of [
	null,
	'docs/.env',
	'docs/.npmrc',
	'docs/session.sqlite',
	'dist/nodes/private.pem',
	'docs/.n8n/config',
]) {
	test(`release ${extra ? 'rejects ' + extra : 'dry run never invokes a real publish'}`, () => {
		const fixture = mkdtempSync(join(tmpdir(), 'librus-release-test-'));
		try {
			mkdirSync(join(fixture, 'scripts'));
			mkdirSync(join(fixture, 'bin'));
			for (const file of ['package.json', 'package-lock.json', 'scripts/release.mjs'])
				copyFileSync(resolve(__dirname, '..', file), join(fixture, file));
			// No network or actual npm commands are used by these isolated release-contract tests.
			writeFileSync(
				join(fixture, 'offline.mjs'),
				'globalThis.fetch = async () => ({ok:false,status:404});',
			);
			const npmMock = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'pack') {
 const p = require(process.cwd() + '/package.json');
 const files = ['package.json','README.md','LICENSE',...p.n8n.nodes,...p.n8n.credentials];
 if (process.env.TEST_PACK_EXTRA) files.push(process.env.TEST_PACK_EXTRA);
 console.log(JSON.stringify([{name:p.name,version:p.version,filename:'fixture.tgz',integrity:'synthetic',files:files.map(path => ({path}))}]));
} else if (args[0] === 'publish') {
 fs.writeFileSync(process.cwd() + '/publish-args.json', JSON.stringify(args));
} else if (!['ci','run'].includes(args[0])) process.exit(99);
`;
			writeFileSync(join(fixture, 'bin/npm'), npmMock, { mode: 0o755 });
			const result = spawnSync(
				process.execPath,
				[
					'--import',
					join(fixture, 'offline.mjs'),
					join(fixture, 'scripts/release.mjs'),
					'--dry-run',
				],
				{
					cwd: fixture,
					encoding: 'utf8',
					env: {
						...process.env,
						PATH: `${join(fixture, 'bin')}:${dirname(process.execPath)}:${process.env.PATH}`,
						TEST_PACK_EXTRA: extra ?? '',
					},
				},
			);
			if (extra) {
				assert.equal(result.status, 1, result.stderr);
				assert.match(result.stderr, /Publikacja zatrzymana/);
				assert.throws(() => readFileSync(join(fixture, 'publish-args.json')), { code: 'ENOENT' });
			} else {
				assert.equal(result.status, 0, result.stderr);
				const args = JSON.parse(readFileSync(join(fixture, 'publish-args.json'), 'utf8'));
				assert.ok(args.includes('--dry-run'));
				assert.ok(args.includes('--access=public'));
				assert.ok(args.includes('--registry=https://registry.npmjs.org/'));
			}
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
}
