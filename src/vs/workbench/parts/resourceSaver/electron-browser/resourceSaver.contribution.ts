/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Registry } from "vs/platform/registry/common/platform";
import { ExtensionResourceSaver, OpenExtensionResourceAction } from "vs/workbench/parts/resourceSaver/electron-browser/extensionResourceSaver";
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from "vs/workbench/common/contributions";
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from "vs/workbench/common/actionRegistry";
import { SyncActionDescriptor } from "vs/platform/actions/common/actions";
import product from 'vs/platform/node/product';

if (!product.quality) {

	// TODO@Ben temporary
	Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
		ExtensionResourceSaver
	);

	const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
	registry.registerWorkbenchAction(
		new SyncActionDescriptor(OpenExtensionResourceAction, 'OpenExtensionResourceAction', 'Open Extensions Resource'),
		'Open Extensions Resource'
	);
}
