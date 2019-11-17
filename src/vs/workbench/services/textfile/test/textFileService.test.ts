/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { ILifecycleService, BeforeShutdownEvent, ShutdownReason } from 'vs/platform/lifecycle/common/lifecycle';
import { workbenchInstantiationService, TestLifecycleService, TestTextFileService, TestContextService, TestFileService, TestElectronService, TestFilesConfigurationService, TestFileDialogService } from 'vs/workbench/test/workbenchTestServices';
import { toResource } from 'vs/base/test/common/utils';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { HotExitConfiguration, IFileService } from 'vs/platform/files/common/files';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { IWorkspaceContextService, Workspace } from 'vs/platform/workspace/common/workspace';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { Schemas } from 'vs/base/common/network';
import { IElectronService } from 'vs/platform/electron/node/electron';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IFileDialogService, ConfirmResult } from 'vs/platform/dialogs/common/dialogs';

class ServiceAccessor {
	constructor(
		@ILifecycleService public lifecycleService: TestLifecycleService,
		@ITextFileService public textFileService: TestTextFileService,
		@IFilesConfigurationService public filesConfigurationService: TestFilesConfigurationService,
		@IUntitledTextEditorService public untitledTextEditorService: IUntitledTextEditorService,
		@IWorkspaceContextService public contextService: TestContextService,
		@IModelService public modelService: ModelServiceImpl,
		@IFileService public fileService: TestFileService,
		@IElectronService public electronService: TestElectronService,
		@IFileDialogService public fileDialogService: TestFileDialogService
	) {
	}
}

class BeforeShutdownEventImpl implements BeforeShutdownEvent {

	public value: boolean | Promise<boolean> | undefined;
	public reason = ShutdownReason.CLOSE;

	veto(value: boolean | Promise<boolean>): void {
		this.value = value;
	}
}

suite('Files - TextFileService', () => {

	let instantiationService: IInstantiationService;
	let model: TextFileEditorModel;
	let accessor: ServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(ServiceAccessor);
	});

	teardown(() => {
		if (model) {
			model.dispose();
		}
		(<TextFileEditorModelManager>accessor.textFileService.models).clear();
		(<TextFileEditorModelManager>accessor.textFileService.models).dispose();
		accessor.untitledTextEditorService.revertAll();
	});

	test('confirm onWillShutdown - no veto', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = event.value;
		if (typeof veto === 'boolean') {
			assert.ok(!veto);
		} else {
			assert.ok(!(await veto));
		}
	});

	test('confirm onWillShutdown - veto if user cancels', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;
		accessor.fileDialogService.setConfirmResult(ConfirmResult.CANCEL);

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.equal(service.getDirty().length, 1);

		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);
		assert.ok(event.value);
	});

	test('confirm onWillShutdown - no veto and backups cleaned up if user does not want to save (hot.exit: off)', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;
		accessor.fileDialogService.setConfirmResult(ConfirmResult.DONT_SAVE);
		accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: 'off' } });

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.equal(service.getDirty().length, 1);
		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		let veto = event.value;
		if (typeof veto === 'boolean') {
			assert.ok(service.cleanupBackupsBeforeShutdownCalled);
			assert.ok(!veto);
			return;
		}

		veto = await veto;
		assert.ok(service.cleanupBackupsBeforeShutdownCalled);
		assert.ok(!veto);
	});

	test('confirm onWillShutdown - save (hot.exit: off)', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;
		accessor.fileDialogService.setConfirmResult(ConfirmResult.SAVE);
		accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: 'off' } });

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.equal(service.getDirty().length, 1);
		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = await (<Promise<boolean>>event.value);
		assert.ok(!veto);
		assert.ok(!model.isDirty());
	});

	test('isDirty/getDirty - files and untitled', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;

		await model.load();

		assert.ok(!service.isDirty(model.resource));
		model.textEditorModel!.setValue('foo');

		assert.ok(service.isDirty(model.resource));
		assert.equal(service.getDirty().length, 1);
		assert.equal(service.getDirty([model.resource])[0].toString(), model.resource.toString());

		const untitled = accessor.untitledTextEditorService.createOrGet();
		const untitledModel = await untitled.resolve();

		assert.ok(!service.isDirty(untitled.getResource()));
		assert.equal(service.getDirty().length, 1);
		untitledModel.textEditorModel!.setValue('changed');

		assert.ok(service.isDirty(untitled.getResource()));
		assert.equal(service.getDirty().length, 2);
		assert.equal(service.getDirty([untitled.getResource()])[0].toString(), untitled.getResource().toString());
	});

	test('save - file', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(service.isDirty(model.resource));

		const res = await service.save(model.resource);
		assert.ok(res);
		assert.ok(!service.isDirty(model.resource));
	});

	test('save - UNC path', async function () {
		const untitledUncUri = URI.from({ scheme: 'untitled', authority: 'server', path: '/share/path/file.txt' });
		model = instantiationService.createInstance(TextFileEditorModel, untitledUncUri, 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const mockedFileUri = untitledUncUri.with({ scheme: Schemas.file });
		const mockedEditorInput = instantiationService.createInstance(TextFileEditorModel, mockedFileUri, 'utf8', undefined);
		const loadOrCreateStub = sinon.stub(accessor.textFileService.models, 'loadOrCreate', () => Promise.resolve(mockedEditorInput));

		sinon.stub(accessor.untitledTextEditorService, 'exists', () => true);
		sinon.stub(accessor.untitledTextEditorService, 'hasAssociatedFilePath', () => true);
		sinon.stub(accessor.modelService, 'updateModel', () => { });

		await model.load();
		model.textEditorModel!.setValue('foo');

		const res = await accessor.textFileService.saveAll(true);
		assert.ok(loadOrCreateStub.calledOnce);
		assert.equal(res.results.length, 1);
		assert.ok(res.results[0].success);
		assert.equal(res.results[0].target!.scheme, Schemas.file);
		assert.equal(res.results[0].target!.authority, untitledUncUri.authority);
		assert.equal(res.results[0].target!.path, untitledUncUri.path);
	});

	test('saveAll - file', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(service.isDirty(model.resource));

		const res = await service.saveAll([model.resource]);
		assert.ok(res);
		assert.ok(!service.isDirty(model.resource));
		assert.equal(res.results.length, 1);
		assert.equal(res.results[0].source.toString(), model.resource.toString());
	});

	test('saveAs - file', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;
		service.setPromptPath(model.resource);

		await model.load();
		model.textEditorModel!.setValue('foo');
		assert.ok(service.isDirty(model.resource));

		const res = await service.saveAs(model.resource);
		assert.equal(res!.toString(), model.resource.toString());
		assert.ok(!service.isDirty(model.resource));
	});

	test('revert - file', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;
		service.setPromptPath(model.resource);

		await model.load();
		model!.textEditorModel!.setValue('foo');
		assert.ok(service.isDirty(model.resource));

		const res = await service.revert(model.resource);
		assert.ok(res);
		assert.ok(!service.isDirty(model.resource));
	});

	test('delete - dirty file', async function () {
		model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

		const service = accessor.textFileService;

		await model.load();
		model!.textEditorModel!.setValue('foo');
		assert.ok(service.isDirty(model.resource));

		await service.delete(model.resource);
		assert.ok(!service.isDirty(model.resource));
	});

	test('move - dirty file', async function () {
		await testMove(toResource.call(this, '/path/file.txt'), toResource.call(this, '/path/file_target.txt'));
	});

	test('move - dirty file (target exists and is dirty)', async function () {
		await testMove(toResource.call(this, '/path/file.txt'), toResource.call(this, '/path/file_target.txt'), true);
	});

	async function testMove(source: URI, target: URI, targetDirty?: boolean): Promise<void> {
		let sourceModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, source, 'utf8', undefined);
		let targetModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, target, 'utf8', undefined);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(sourceModel.resource, sourceModel);
		(<TextFileEditorModelManager>accessor.textFileService.models).add(targetModel.resource, targetModel);

		const service = accessor.textFileService;

		await sourceModel.load();
		sourceModel.textEditorModel!.setValue('foo');
		assert.ok(service.isDirty(sourceModel.resource));

		if (targetDirty) {
			await targetModel.load();
			targetModel.textEditorModel!.setValue('bar');
			assert.ok(service.isDirty(targetModel.resource));
		}

		await service.move(sourceModel.resource, targetModel.resource, true);

		assert.equal(targetModel.textEditorModel!.getValue(), 'foo');

		assert.ok(!service.isDirty(sourceModel.resource));
		assert.ok(service.isDirty(targetModel.resource));

		sourceModel.dispose();
		targetModel.dispose();
	}

	suite('Hot Exit', () => {
		suite('"onExit" setting', () => {
			test('should hot exit on non-Mac (reason: CLOSE, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, false, true, !!platform.isMacintosh);
			});
			test('should hot exit on non-Mac (reason: CLOSE, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, false, false, !!platform.isMacintosh);
			});
			test('should NOT hot exit (reason: CLOSE, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, true, true, true);
			});
			test('should NOT hot exit (reason: CLOSE, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, true, false, true);
			});
			test('should hot exit (reason: QUIT, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, false, true, false);
			});
			test('should hot exit (reason: QUIT, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, false, false, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, true, true, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, true, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, false, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, false, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, true, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, true, false, false);
			});
			test('should NOT hot exit (reason: LOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, false, true, true);
			});
			test('should NOT hot exit (reason: LOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, false, false, true);
			});
			test('should NOT hot exit (reason: LOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, true, true, true);
			});
			test('should NOT hot exit (reason: LOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, true, false, true);
			});
		});

		suite('"onExitAndWindowClose" setting', () => {
			test('should hot exit (reason: CLOSE, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, false, true, false);
			});
			test('should hot exit (reason: CLOSE, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, false, false, !!platform.isMacintosh);
			});
			test('should hot exit (reason: CLOSE, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, true, true, false);
			});
			test('should NOT hot exit (reason: CLOSE, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, true, false, true);
			});
			test('should hot exit (reason: QUIT, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, false, true, false);
			});
			test('should hot exit (reason: QUIT, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, false, false, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, true, true, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, true, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, false, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, false, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, true, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, true, false, false);
			});
			test('should hot exit (reason: LOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, false, true, false);
			});
			test('should NOT hot exit (reason: LOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, false, false, true);
			});
			test('should hot exit (reason: LOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, true, true, false);
			});
			test('should NOT hot exit (reason: LOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, true, false, true);
			});
		});

		async function hotExitTest(this: any, setting: string, shutdownReason: ShutdownReason, multipleWindows: boolean, workspace: true, shouldVeto: boolean): Promise<void> {
			model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
			(<TextFileEditorModelManager>accessor.textFileService.models).add(model.resource, model);

			const service = accessor.textFileService;
			// Set hot exit config
			accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: setting } });
			// Set empty workspace if required
			if (!workspace) {
				accessor.contextService.setWorkspace(new Workspace('empty:1508317022751'));
			}
			// Set multiple windows if required
			if (multipleWindows) {
				accessor.electronService.windowCount = Promise.resolve(2);
			}
			// Set cancel to force a veto if hot exit does not trigger
			accessor.fileDialogService.setConfirmResult(ConfirmResult.CANCEL);

			await model.load();
			model.textEditorModel!.setValue('foo');
			assert.equal(service.getDirty().length, 1);
			const event = new BeforeShutdownEventImpl();
			event.reason = shutdownReason;
			accessor.lifecycleService.fireWillShutdown(event);

			const veto = await (<Promise<boolean>>event.value);
			assert.ok(!service.cleanupBackupsBeforeShutdownCalled); // When hot exit is set, backups should never be cleaned since the confirm result is cancel
			assert.equal(veto, shouldVeto);
		}
	});
});
