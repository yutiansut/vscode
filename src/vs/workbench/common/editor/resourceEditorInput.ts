/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { EditorInput, ITextEditorModel, ConfirmResult } from 'vs/workbench/common/editor';
import URI from 'vs/base/common/uri';
import { IReference, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { telemetryURIDescriptor } from 'vs/platform/telemetry/common/telemetryUtils';
import { ITextModelService, ITextModelStateChangeEvent } from 'vs/editor/common/services/resolverService';
import { ResourceEditorModel } from 'vs/workbench/common/editor/resourceEditorModel';
import { IMessageService } from "vs/platform/message/common/message";
import { IEnvironmentService } from "vs/platform/environment/common/environment";
import { localize } from "vs/nls";
import { basename } from "vs/base/common/paths";
import { isWindows, isLinux } from "vs/base/common/platform";

/**
 * A read-only text editor input whos contents are made of the provided resource that points to an existing
 * code editor model.
 */
export class ResourceEditorInput extends EditorInput {

	static ID: string = 'workbench.editors.resourceEditorInput';

	private modelReference: TPromise<IReference<ITextEditorModel>>;
	private resource: URI;
	private name: string;
	private description: string;
	private toUnbind: IDisposable[];
	private dirty: boolean;

	constructor(
		name: string,
		description: string,
		resource: URI,
		@ITextModelService private textModelResolverService: ITextModelService,
		@IEnvironmentService private environmentService: IEnvironmentService,
		@IMessageService private messageService: IMessageService
	) {
		super();

		this.name = name;
		this.description = description;
		this.resource = resource;
		this.toUnbind = [];

		this.registerListeners();
	}

	private registerListeners(): void {

		// Model changes
		this.toUnbind.push(this.textModelResolverService.onDidChangeState(e => this.onDirtyStateChange(e)));
	}

	private onDirtyStateChange(e: ITextModelStateChangeEvent): void {
		if (e.resource.toString() === this.resource.toString()) {
			const isDirty = (e.type === 'dirty');
			if (isDirty !== this.dirty) {
				this._onDidChangeDirty.fire();
			}

			this.dirty = isDirty;
		}
	}

	public isDirty(): boolean {
		return this.dirty;
	}

	public confirmSave(): ConfirmResult {
		const save = this.mnemonicLabel(localize({ key: 'save', comment: ['&& denotes a mnemonic'] }, "&&Save"));
		const dontSave = this.mnemonicLabel(localize({ key: 'dontSave', comment: ['&& denotes a mnemonic'] }, "Do&&n't Save"));

		const result = this.messageService.confirm({
			title: this.environmentService.appNameLong,
			message: localize('saveChangesMessage', "Do you want to save the changes you made to {0}?", basename(this.resource.fsPath)),
			type: 'warning',
			detail: localize('saveChangesDetail', "Your changes will be lost if you don't save them."),
			primaryButton: isLinux ? dontSave : save,
			secondaryButton: isLinux ? save : dontSave
		});

		return result ? ConfirmResult.SAVE : ConfirmResult.DONT_SAVE;
	}

	private mnemonicLabel(label: string): string {
		if (!isWindows) {
			return label.replace(/\(&&\w\)|&&/g, ''); // no mnemonic support on mac/linux
		}

		return label.replace(/&&/g, '&');
	}

	public save(): TPromise<boolean> {
		return this.textModelResolverService.save(this.resource).then(() => true, () => false);
	}

	public revert(): TPromise<boolean> {
		return this.textModelResolverService.revert(this.resource).then(() => true, () => false);
	}

	public getResource(): URI {
		return this.resource;
	}

	public getTypeId(): string {
		return ResourceEditorInput.ID;
	}

	public getName(): string {
		return this.name;
	}

	public setName(name: string): void {
		if (this.name !== name) {
			this.name = name;
			this._onDidChangeLabel.fire();
		}
	}

	public getDescription(): string {
		return this.description;
	}

	public setDescription(description: string): void {
		if (this.description !== description) {
			this.description = description;
			this._onDidChangeLabel.fire();
		}
	}

	public getTelemetryDescriptor(): object {
		const descriptor = super.getTelemetryDescriptor();
		descriptor['resource'] = telemetryURIDescriptor(this.resource);

		return descriptor;
	}

	public resolve(refresh?: boolean): TPromise<ITextEditorModel> {
		if (!this.modelReference) {
			this.modelReference = this.textModelResolverService.createModelReference(this.resource);
		}

		return this.modelReference.then(ref => {
			const model = ref.object;

			if (!(model instanceof ResourceEditorModel)) {
				ref.dispose();
				this.modelReference = null;
				return TPromise.wrapError<ITextEditorModel>(`Unexpected model for ResourceInput: ${this.resource}`); // TODO@Ben eventually also files should be supported, but we guard due to the dangerous dispose of the model in dispose()
			}

			return model;
		});
	}

	public matches(otherInput: any): boolean {
		if (super.matches(otherInput) === true) {
			return true;
		}

		if (otherInput instanceof ResourceEditorInput) {
			let otherResourceEditorInput = <ResourceEditorInput>otherInput;

			// Compare by properties
			return otherResourceEditorInput.resource.toString() === this.resource.toString();
		}

		return false;
	}

	public dispose(): void {

		// Model reference
		if (this.modelReference) {
			this.modelReference.done(ref => ref.dispose());
			this.modelReference = null;
		}

		// Listeners
		this.toUnbind = dispose(this.toUnbind);

		super.dispose();
	}
}
