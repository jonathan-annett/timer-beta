import type { SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
	/** The Companion link copied from the timer's share panel (Companion mode), or just the part after '#' */
	link: string
	/** Pairing server override (normally taken from the link; default wss://<timer host>:8443/) */
	server: string
	/** Accept a self-signed certificate on the pairing server (local testing only) */
	insecure: boolean
	/** Token from a PIN approval, kept here so a restart needs no new PIN (written by the module) */
	token: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'How to connect',
			value:
				'On the timer, click <b>share</b>, choose <b>Companion</b> and copy the link shown under the code (<b>Copy link</b>). Paste it below. ' +
				'If the timer has <b>Require a PIN</b> on, this connection shows a PIN in its status; type it into the timer’s share panel once.',
		},
		{
			type: 'textinput',
			id: 'link',
			label: 'Companion link from the timer',
			width: 12,
			default: '',
		},
		{
			type: 'textinput',
			id: 'server',
			label: 'Pairing server (leave empty to use the one in the link)',
			width: 8,
			default: '',
		},
		{
			type: 'checkbox',
			id: 'insecure',
			label: 'Accept a self-signed certificate (testing only)',
			width: 4,
			default: false,
		},
	]
}
