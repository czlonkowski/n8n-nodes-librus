#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dry-run') || args.length > 1) {
	console.error('Użycie: npm run release [-- --dry-run]');
	process.exit(1);
}
const dryRun = args.includes('--dry-run');
function run(command, arguments_, capture = false) {
	const result = spawnSync(command, arguments_, {
		cwd: root,
		stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
		encoding: 'utf8',
	});
	if (result.error || result.status !== 0)
		throw new Error(`Nie powiodło się: ${command} ${arguments_.join(' ')}`);
	return result.stdout?.trim() ?? '';
}

let packDirectory;
try {
	if (Number(process.versions.node.split('.')[0]) < 24)
		throw new Error('Wymagany jest Node.js 24 lub nowszy.');
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
	if (
		pkg.name !== '@czlonkowski/n8n-nodes-librus' ||
		pkg.private ||
		lock.name !== pkg.name ||
		lock.version !== pkg.version ||
		lock.packages[''].name !== pkg.name ||
		lock.packages[''].version !== pkg.version
	) {
		throw new Error('Sprawdź nazwę paczki, wersję i zgodność package-lock.json.');
	}
	if (!dryRun) {
		if (run('git', ['status', '--porcelain'], true))
			throw new Error('Zapisz zmiany w commicie przed publikacją.');
		const username = run('npm', ['whoami', `--registry=${registry}`], true);
		if (username !== 'czlonkowski')
			throw new Error('Zaloguj się na konto npm czlonkowski: npm login');
	}
	const response = await fetch(`${registry}${encodeURIComponent(pkg.name)}`, {
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok && response.status !== 404)
		throw new Error(`Nie można sprawdzić rejestru npm (HTTP ${response.status}).`);
	if (response.ok) {
		const metadata = await response.json();
		if (metadata.versions?.[pkg.version] || metadata.time?.[pkg.version])
			throw new Error(`Wersja ${pkg.version} była już opublikowana. Zwiększ wersję paczki.`);
	}
	console.log(`${dryRun ? 'Sprawdzenie' : 'Publikacja'}: ${pkg.name}@${pkg.version}`);
	run('npm', ['ci', `--registry=${registry}`]);
	run('npm', ['run', 'check']);
	packDirectory = mkdtempSync(join(tmpdir(), 'librus-release-'));
	// Build and tests already passed. Pack once, then publish exactly this inspected archive.
	const [pack] = JSON.parse(
		run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory], true),
	);
	const files = new Set(pack.files.map((file) => file.path));
	const required = [
		'package.json',
		'README.md',
		'LICENSE',
		...pkg.n8n.nodes,
		...pkg.n8n.credentials,
	];
	if (
		pack.name !== pkg.name ||
		pack.version !== pkg.version ||
		required.some((file) => !files.has(file))
	)
		throw new Error('Archiwum nie zawiera wymaganych plików paczki.');
	const allowed =
		/^(dist\/(nodes|credentials)\/|docs\/|package\.json$|README\.md$|LICENSE$|NOTICE\.md$|SECURITY\.md$|CHANGELOG\.md$)/;
	if ([...files].some((file) => !allowed.test(file)))
		throw new Error('Archiwum zawiera pliki spoza listy publikowanych katalogów.');
	const sensitivePath =
		/(^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.n8n[^/]*|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx|db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i;
	if ([...files].some((file) => sensitivePath.test(file)))
		throw new Error(
			'Archiwum zawiera plik mogący przechowywać dane uwierzytelniające. Publikacja zatrzymana.',
		);
	console.log(`Archiwum: ${pack.filename}; plików: ${files.size}; integralność: ${pack.integrity}`);
	const tag = pkg.version.includes('-') ? 'next' : 'latest';
	const archive = join(packDirectory, pack.filename);
	run('npm', [
		'publish',
		archive,
		'--access=public',
		`--registry=${registry}`,
		`--tag=${tag}`,
		...(dryRun ? ['--dry-run'] : []),
	]);
	console.log(
		dryRun
			? 'Sprawdzenie zakończone. Nic nie opublikowano.'
			: `Opublikowano ${pkg.name}@${pkg.version} (tag: ${tag}).`,
	);
	if (!dryRun)
		console.log(`Sprawdź wynik: npm view ${pkg.name}@${pkg.version} version dist.integrity`);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	if (packDirectory) rmSync(packDirectory, { recursive: true, force: true });
}
