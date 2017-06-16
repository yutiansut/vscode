/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { first } from 'vs/base/common/async';
import Event, { Emitter } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModel } from 'vs/editor/common/editorCommon';
import { IDisposable, toDisposable, IReference, ReferenceCollection, ImmortalReference, dispose } from 'vs/base/common/lifecycle';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ResourceEditorModel } from 'vs/workbench/common/editor/resourceEditorModel';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import network = require('vs/base/common/network');
import { ITextModelService, ITextModelContentProvider, ITextEditorModel, ITextModelSaveOptions, ITextModelSaver, ITextModelStateChangeEvent } from 'vs/editor/common/services/resolverService';
import { IUntitledEditorService, UNTITLED_SCHEMA } from 'vs/workbench/services/untitled/common/untitledEditorService';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';

class ResourceModelCollection extends ReferenceCollection<TPromise<ITextEditorModel>> {

	private providers: { [scheme: string]: ITextModelContentProvider[] } = Object.create(null);

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@ITextFileService private textFileService: ITextFileService
	) {
		super();
	}

	public createReferencedObject(key: string): TPromise<ITextEditorModel> {
		const resource = URI.parse(key);

		if (resource.scheme === network.Schemas.file) {
			return this.textFileService.models.loadOrCreate(resource);
		}

		return this.resolveTextModelContent(key).then(() => this.instantiationService.createInstance(ResourceEditorModel, resource));
	}

	public destroyReferencedObject(modelPromise: TPromise<ITextEditorModel>): void {
		modelPromise.done(model => {
			if (model instanceof TextFileEditorModel) {
				this.textFileService.models.disposeModel(model);
			} else {
				model.dispose();
			}
		});
	}

	public registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable {
		const registry = this.providers;
		const providers = registry[scheme] || (registry[scheme] = []);

		providers.unshift(provider);

		return toDisposable(() => {
			const array = registry[scheme];

			if (!array) {
				return;
			}

			const index = array.indexOf(provider);

			if (index === -1) {
				return;
			}

			array.splice(index, 1);

			if (array.length === 0) {
				delete registry[scheme];
			}
		});
	}

	private resolveTextModelContent(key: string): TPromise<IModel> {
		const resource = URI.parse(key);
		const providers = this.providers[resource.scheme] || [];
		const factories = providers.map(p => () => p.provideTextContent(resource));

		return first(factories).then(model => {
			if (!model) {
				console.error(`Unable to open '${resource}' resource is not available.`); // TODO PII
				return TPromise.wrapError<IModel>('resource is not available');
			}

			return model;
		});
	}
}

class ModelChangeEventEmitter {

	private readonly _toDispose: IDisposable[] = [];
	private readonly _modelListener = new Map<IModel, IDisposable>();
	private readonly _onDidChangeContent = new Emitter<IModel>();

	readonly onDidChangeContent: Event<IModel> = this._onDidChangeContent.event;

	constructor(
		private readonly _modelService: IModelService
	) {
		this._modelService.onModelAdded(this._onModelAdded, this, this._toDispose);
		this._modelService.onModelRemoved(this._onModelRemoved, this, this._toDispose);
	}

	dispose(): void {
		dispose(this._toDispose);
		this._modelListener.forEach(value => value.dispose());
		this._onDidChangeContent.dispose();
	}

	private _onModelAdded(m: IModel): void {
		const subscription = m.onDidChangeContent(e => this._onDidChangeContent.fire(m));
		this._modelListener.set(m, subscription);
	}

	private _onModelRemoved(m: IModel): void {
		dispose(this._modelListener.get(m));
		this._modelListener.delete(m);
	}
}

export class TextModelResolverService implements ITextModelService {

	_serviceBrand: any;

	private readonly _resourceModelCollection: ResourceModelCollection;
	private readonly _onDidChangeModelContent: ModelChangeEventEmitter;

	private readonly _modelSaver = new Map<string, ITextModelSaver>();
	private readonly _onDidChangeState = new Emitter<ITextModelStateChangeEvent>();

	readonly onDidChangeState: Event<ITextModelStateChangeEvent> = this._onDidChangeState.event;

	constructor(
		@ITextFileService private textFileService: ITextFileService,
		@IUntitledEditorService private untitledEditorService: IUntitledEditorService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IModelService private modelService: IModelService
	) {
		this._resourceModelCollection = instantiationService.createInstance(ResourceModelCollection);
		this._onDidChangeModelContent = new ModelChangeEventEmitter(modelService);

		this._onDidChangeModelContent.onDidChangeContent(model => {
			if (this._modelSaver.has(model.uri.scheme)) {
				this._onDidChangeState.fire({ type: 'dirty', resource: model.uri });
			}
		});
	}

	dispose(): void {
		this._onDidChangeModelContent.dispose();
	}

	createModelReference(resource: URI): TPromise<IReference<ITextEditorModel>> {

		// Untitled Schema: go through cached input
		// TODO ImmortalReference is a hack
		if (resource.scheme === UNTITLED_SCHEMA) {
			return this.untitledEditorService.loadOrCreate({ resource }).then(model => new ImmortalReference(model));
		}

		// InMemory Schema: go through model service cache
		// TODO ImmortalReference is a hack
		if (resource.scheme === 'inmemory') {
			const cachedModel = this.modelService.getModel(resource);

			if (!cachedModel) {
				return TPromise.wrapError<IReference<ITextEditorModel>>('Cant resolve inmemory resource');
			}

			return TPromise.as(new ImmortalReference(this.instantiationService.createInstance(ResourceEditorModel, resource)));
		}

		const ref = this._resourceModelCollection.acquire(resource.toString());

		return ref.object.then(
			model => ({ object: model, dispose: () => ref.dispose() }),
			err => {
				ref.dispose();

				return TPromise.wrapError<IReference<ITextEditorModel>>(err);
			}
		);
	}

	registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable {
		return this._resourceModelCollection.registerTextModelContentProvider(scheme, provider);
	}

	registerTextModelSaver(scheme: string, saver: ITextModelSaver): IDisposable {
		if (this._modelSaver.has(scheme)) {
			throw new Error(`there can only be one saver for the scheme '${scheme}'`);
		}
		this._modelSaver.set(scheme, saver);
		return {
			dispose: () => {
				this._modelSaver.delete(scheme);
			}
		};
	}

	save(resource: URI, options?: ITextModelSaveOptions): TPromise<void> {
		const model = this.modelService.getModel(resource);
		if (!model) {
			return TPromise.wrapError<void>('MISSING_MODEL');
		}
		const saver = this._modelSaver.get(resource.scheme);
		if (!saver) {
			return TPromise.wrapError<void>('MISSING_SAVER');
		}

		this._onDidChangeState.fire({ type: 'saving', resource });
		return saver.saveTextContent(resource, model, options).then(() => {
			this._onDidChangeState.fire({ type: 'saved', resource });
		});
	}

	supportsSave(resource: URI): boolean {
		return this._modelSaver.has(resource.scheme);
	}
}
