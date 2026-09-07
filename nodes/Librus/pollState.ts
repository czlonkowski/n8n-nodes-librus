import { createHash } from 'node:crypto';
import type { IDataObject } from 'n8n-workflow';
import { LibrusError, type Message } from './LibrusClient';

const MAX_SEEN_IDS = 10000;

export function accountKey(username: string, credentialId: string): string {
	return createHash('sha256')
		.update(JSON.stringify([credentialId, username]))
		.digest('hex');
}

/** Called only after a complete scan; no await between comparing and updating state. */
export function selectNewMessages(
	state: IDataObject,
	account: string,
	messages: Message[],
): Message[] {
	const raw: unknown = state.librus;
	if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw)))
		throw new LibrusError('TRIGGER_STATE_INVALID');
	const previous = raw as Record<string, unknown> | undefined;
	let seen = new Set<string>();
	let baseline = true;
	if (previous !== undefined) {
		if (
			previous.version !== 1 ||
			typeof previous.account !== 'string' ||
			!Array.isArray(previous.seenIds) ||
			previous.seenIds.length > MAX_SEEN_IDS ||
			previous.seenIds.some((id) => typeof id !== 'string' || !id)
		)
			throw new LibrusError('TRIGGER_STATE_INVALID');
		if (previous.account === account) {
			seen = new Set(previous.seenIds as string[]);
			baseline = false;
		}
	}
	const fresh: Message[] = [];
	for (const message of messages) {
		if (!seen.has(message.messageId)) {
			seen.add(message.messageId);
			if (!baseline) fresh.push(message);
		}
	}
	if (seen.size > MAX_SEEN_IDS) throw new LibrusError('TRIGGER_STATE_LIMIT');
	if (baseline || fresh.length) state.librus = { version: 1, account, seenIds: [...seen] };
	return fresh;
}
