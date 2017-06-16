/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { Action } from 'vs/base/common/actions';
import URI from 'vs/base/common/uri';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMessageService } from 'vs/platform/message/common/message';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ITextModelService, ITextModelContentProvider, ITextModelSaver, ITextModelSaveOptions } from 'vs/editor/common/services/resolverService';
import { IModel } from 'vs/editor/common/editorCommon';
import { IEditorGroupService } from 'vs/workbench/services/group/common/groupService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

export const EXTENSION_RESOLUTION_SCHEME = 'extension';

let value = 'This is my custom resource saver';

// TODO@Ben temporary
export class ExtensionResourceSaver implements IWorkbenchContribution, ITextModelContentProvider, ITextModelSaver {
	private toUnbind: IDisposable[];

	constructor(
		@IMessageService private messageService: IMessageService,
		@ITextFileService private textFileService: ITextFileService,
		@ITextModelService private textModelResolverService: ITextModelService,
		@IModelService private modelService: IModelService,
		@IModeService private modeService: IModeService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IEditorGroupService private editorGroupService: IEditorGroupService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService
	) {
		this.toUnbind = [];

		this.textModelResolverService.registerTextModelContentProvider(EXTENSION_RESOLUTION_SCHEME, this);
		this.textModelResolverService.registerTextModelSaver(EXTENSION_RESOLUTION_SCHEME, this);

		this.registerListeners();
	}

	private registerListeners(): void {

	}

	public provideTextContent(resource: URI): TPromise<IModel> {
		let codeEditorModel = this.modelService.getModel(resource);
		if (!codeEditorModel) {
			codeEditorModel = this.modelService.createModel(value, this.modeService.getOrCreateModeByFilenameOrFirstLine(resource.fsPath), resource);
		} else {
			this.modelService.updateModel(codeEditorModel, value);
		}

		return TPromise.as(codeEditorModel);
	}

	public saveTextContent(model: IModel, options?: ITextModelSaveOptions): TPromise<void> {
		value = model.getValue();

		return TPromise.as(null);
	}

	public revertTextContent(model: IModel): TPromise<void> {
		this.modelService.updateModel(model, value);

		return TPromise.as(null);
	}

	public getId(): string {
		return 'vs.files.extensionsaver';
	}

	public dispose(): void {
		this.toUnbind = dispose(this.toUnbind);
	}
}

export class OpenExtensionResourceAction extends Action {

	constructor(
		id: string,
		label: string,
		@IWorkbenchEditorService private editorService: IWorkbenchEditorService
	) {
		super(id, label);
	}

	public run(): TPromise<any> {
		return this.editorService.openEditor({ resource: URI.parse('extension://path/myFile.js') });
	}
}