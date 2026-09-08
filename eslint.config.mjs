import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['nodes/Librus/*.node.ts', 'credentials/LibrusSessionApi.credentials.ts'],
		rules: {
			// This package is Polish-only: English wording/title-case conventions do not apply.
			'n8n-nodes-base/node-param-display-name-miscased': 'off',
			'n8n-nodes-base/node-param-operation-option-action-miscased': 'off',
			'n8n-nodes-base/node-param-option-name-wrong-for-get-many': 'off',
			'n8n-nodes-base/node-param-description-boolean-without-whether': 'off',
			'n8n-nodes-base/node-param-description-wrong-for-return-all': 'off',
			'n8n-nodes-base/node-param-description-wrong-for-limit': 'off',
			'n8n-nodes-base/cred-class-field-display-name-miscased': 'off',
			'n8n-nodes-base/cred-class-field-display-name-missing-api': 'off',
		},
	},

	{
		files: ['nodes/Librus/Librus.node.ts', 'nodes/Librus/LibrusTrigger.node.ts'],
		rules: {
			// Internal sanitized errors are converted at the n8n boundary.
			'n8n-nodes-base/node-execute-block-wrong-error-thrown': 'off',
			// No AI tool exposure for this experimental personal-data integration.
			'@n8n/community-nodes/node-usable-as-tool': 'off',
			// Opaque teal tile and transparent exterior give this icon contrast in both themes.
			'@n8n/community-nodes/icon-prefer-themed-variants': 'off',
			// Preserve the user-requested generated PNG; n8n supports raster icons.
			'n8n-nodes-base/node-class-description-icon-not-svg': 'off',
			// ICredentialTestFunctions exposes only helpers.request in n8n-workflow 2.38.
			'@n8n/community-nodes/no-deprecated-workflow-functions': 'off',
		},
	},
	{
		files: ['nodes/Librus/LibrusClient.ts', 'nodes/Librus/pollState.ts'],
		rules: {
			// Framework-independent client: only safe errors cross into the node adapter.
			'@n8n/community-nodes/require-node-api-error': 'off',
		},
	},
	{
		files: ['credentials/LibrusSessionApi.credentials.ts'],
		rules: {
			// School account identifiers are personal data; keep them masked too.
			'@n8n/community-nodes/credential-unnecessary-password': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			// This unverified self-hosted package deliberately uses a real cookie jar.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
		},
	},
];
