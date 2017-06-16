/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IModel } from 'vs/editor/common/editorCommon';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { IDisposable, IReference } from 'vs/base/common/lifecycle';
import Event from 'vs/base/common/event';

export const ITextModelService = createDecorator<ITextModelService>('textModelService');

export interface ITextModelService {
	_serviceBrand: any;

	/**
	 * Emitted when the state of one of the resources changed.
	 */
	onDidChangeState: Event<ITextModelStateChangeEvent>;

	/**
	 * Provided a resource URI, it will return a model reference
	 * which should be disposed once not needed anymore.
	 */
	createModelReference(resource: URI): TPromise<IReference<ITextEditorModel>>;

	/**
	 * Registers a specific `scheme` content provider.
	 */
	registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable;

	/**
	 * Registers a specific `scheme` saver.
	 */
	registerTextModelSaver(scheme: string, saver: ITextModelSaver): IDisposable;

	/**
	 * Saves the provided resource. This will only work if a ITextModelSaver is registered for the
	 * scheme of the resource.
	 */
	save(resource: URI, options?: ITextModelSaveOptions): TPromise<void>;

	/**
	 * Finds out if a resource supports saving via the ITextModelSaver helper.
	 */
	supportsSave(resource: URI): boolean;
}

export interface ITextModelContentProvider {

	/**
	 * Given a resource, return the content of the resource as IModel.
	 */
	provideTextContent(resource: URI): TPromise<IModel>;
}

export interface ITextModelSaveOptions {
	encoding?: string;
}

export interface ITextModelSaver {
	saveTextContent(resource: URI, model: IModel, options?: ITextModelSaveOptions): TPromise<void>;
}

export interface ITextModelStateChangeEvent {
	type: 'dirty' | 'reverted' | 'saving' | 'saved';
	resource: URI;
}

export interface ITextEditorModel extends IEditorModel {

	/**
	 * Provides access to the underlying IModel.
	 */
	textEditorModel: IModel;
}
