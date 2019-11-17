/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OpenContext, IWindowConfiguration, IWindowOpenable, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { ParsedArgs } from 'vs/platform/environment/common/environment';
import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ISerializableCommandAction } from 'vs/platform/actions/common/actions';
import { URI } from 'vs/base/common/uri';
import { Rectangle, BrowserWindow } from 'electron';
import { IDisposable } from 'vs/base/common/lifecycle';

export interface IWindowState {
	width?: number;
	height?: number;
	x?: number;
	y?: number;
	mode?: WindowMode;
	display?: number;
}

export const enum WindowMode {
	Maximized,
	Normal,
	Minimized, // not used anymore, but also cannot remove due to existing stored UI state (needs migration)
	Fullscreen
}

export interface ICodeWindow extends IDisposable {

	readonly onClose: Event<void>;
	readonly onDestroy: Event<void>;

	readonly whenClosedOrLoaded: Promise<void>;

	readonly id: number;
	readonly win: BrowserWindow;
	readonly config: IWindowConfiguration | undefined;

	readonly openedFolderUri?: URI;
	readonly openedWorkspace?: IWorkspaceIdentifier;
	readonly backupPath?: string;

	readonly remoteAuthority?: string;

	readonly isExtensionDevelopmentHost: boolean;
	readonly isExtensionTestHost: boolean;

	readonly lastFocusTime: number;

	readonly isReady: boolean;
	ready(): Promise<ICodeWindow>;
	setReady(): void;

	readonly hasHiddenTitleBarStyle: boolean;

	addTabbedWindow(window: ICodeWindow): void;

	load(config: IWindowConfiguration, isReload?: boolean): void;
	reload(configuration?: IWindowConfiguration, cli?: ParsedArgs): void;

	focus(): void;
	close(): void;

	getBounds(): Rectangle;

	send(channel: string, ...args: any[]): void;
	sendWhenReady(channel: string, ...args: any[]): void;

	readonly isFullScreen: boolean;
	toggleFullScreen(): void;

	isMinimized(): boolean;

	setRepresentedFilename(name: string): void;
	getRepresentedFilename(): string | undefined;

	handleTitleDoubleClick(): void;

	updateTouchBar(items: ISerializableCommandAction[][]): void;

	serializeWindowState(): IWindowState;
}

export const IWindowsMainService = createDecorator<IWindowsMainService>('windowsMainService');

export interface IWindowsCountChangedEvent {
	readonly oldCount: number;
	readonly newCount: number;
}

export interface IWindowsMainService {

	_serviceBrand: undefined;

	readonly onWindowReady: Event<ICodeWindow>;
	readonly onWindowsCountChanged: Event<IWindowsCountChangedEvent>;

	open(openConfig: IOpenConfiguration): ICodeWindow[];
	openEmptyWindow(context: OpenContext, options?: IOpenEmptyWindowOptions): ICodeWindow[];
	openExtensionDevelopmentHostWindow(extensionDevelopmentPath: string[], openConfig: IOpenConfiguration): ICodeWindow[];

	sendToFocused(channel: string, ...args: any[]): void;
	sendToAll(channel: string, payload: any, windowIdsToIgnore?: number[]): void;

	getLastActiveWindow(): ICodeWindow | undefined;

	getWindowById(windowId: number): ICodeWindow | undefined;
	getWindows(): ICodeWindow[];
	getWindowCount(): number;
}

export interface IOpenConfiguration {
	readonly context: OpenContext;
	readonly contextWindowId?: number;
	readonly cli: ParsedArgs;
	readonly userEnv?: IProcessEnvironment;
	readonly urisToOpen?: IWindowOpenable[];
	readonly waitMarkerFileURI?: URI;
	readonly preferNewWindow?: boolean;
	readonly forceNewWindow?: boolean;
	readonly forceNewTabbedWindow?: boolean;
	readonly forceReuseWindow?: boolean;
	readonly forceEmpty?: boolean;
	readonly diffMode?: boolean;
	addMode?: boolean;
	readonly gotoLineMode?: boolean;
	readonly initialStartup?: boolean;
	readonly noRecentEntry?: boolean;
}
