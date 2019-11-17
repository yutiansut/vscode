/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./codelensWidget';
import * as dom from 'vs/base/browser/dom';
import { renderCodicons } from 'vs/base/browser/ui/codiconLabel/codiconLabel';
import * as editorBrowser from 'vs/editor/browser/editorBrowser';
import { Range } from 'vs/editor/common/core/range';
import { IModelDecorationsChangeAccessor, IModelDeltaDecoration, ITextModel } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { Command, CodeLens } from 'vs/editor/common/modes';
import { editorCodeLensForeground } from 'vs/editor/common/view/editorColorRegistry';
import { CodeLensItem } from 'vs/editor/contrib/codelens/codelens';
import { editorActiveLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';

class CodeLensViewZone implements editorBrowser.IViewZone {

	readonly heightInLines: number;
	readonly suppressMouseDown: boolean;
	readonly domNode: HTMLElement;

	afterLineNumber: number;

	private _lastHeight?: number;
	private readonly _onHeight: Function;

	constructor(afterLineNumber: number, onHeight: Function) {
		this.afterLineNumber = afterLineNumber;
		this._onHeight = onHeight;

		this.heightInLines = 1;
		this.suppressMouseDown = true;
		this.domNode = document.createElement('div');
	}

	onComputedHeight(height: number): void {
		if (this._lastHeight === undefined) {
			this._lastHeight = height;
		} else if (this._lastHeight !== height) {
			this._lastHeight = height;
			this._onHeight();
		}
	}
}

class CodeLensContentWidget implements editorBrowser.IContentWidget {

	private static _idPool: number = 0;

	// Editor.IContentWidget.allowEditorOverflow
	readonly allowEditorOverflow: boolean = false;
	readonly suppressMouseDown: boolean = true;

	private readonly _id: string;
	private readonly _domNode: HTMLElement;
	private readonly _editor: editorBrowser.ICodeEditor;
	private readonly _commands = new Map<string, Command>();

	private _widgetPosition?: editorBrowser.IContentWidgetPosition;
	private _isEmpty: boolean = true;

	constructor(
		editor: editorBrowser.ICodeEditor,
		className: string,
		symbolRange: Range,
		lenses: Array<CodeLens | undefined | null>
	) {
		this._editor = editor;
		this._id = (CodeLensContentWidget._idPool++).toString();

		this.setSymbolRange(symbolRange);

		this._domNode = document.createElement('span');
		this._domNode.className = `codelens-decoration ${className}`;
		this.withCommands(lenses, false);
	}

	withCommands(lenses: Array<CodeLens | undefined | null>, animate: boolean): void {
		this._commands.clear();

		let innerHtml = '';
		let hasSymbol = false;
		for (let i = 0; i < lenses.length; i++) {
			const lens = lenses[i];
			if (!lens) {
				continue;
			}
			hasSymbol = true;
			if (lens.command) {
				const title = renderCodicons(lens.command.title);
				if (lens.command.id) {
					innerHtml += `<a id=${i}>${title}</a>`;
					this._commands.set(String(i), lens.command);
				} else {
					innerHtml += `<span>${title}</span>`;
				}
				if (i + 1 < lenses.length) {
					innerHtml += '<span>&nbsp;|&nbsp;</span>';
				}
			}
		}

		if (!hasSymbol) {
			// symbols but no commands
			this._domNode.innerHTML = '<span>no commands</span>';

		} else {
			// symbols and commands
			if (!innerHtml) {
				innerHtml = '&nbsp;';
			}
			this._domNode.innerHTML = innerHtml;
			this._editor.layoutContentWidget(this);
			if (this._isEmpty && animate) {
				dom.addClass(this._domNode, 'fadein');
			}
			this._isEmpty = false;
		}
	}

	getCommand(link: HTMLLinkElement): Command | undefined {
		return link.parentElement === this._domNode
			? this._commands.get(link.id)
			: undefined;
	}

	getId(): string {
		return this._id;
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	setSymbolRange(range: Range): void {
		if (!this._editor.hasModel()) {
			return;
		}
		const lineNumber = range.startLineNumber;
		const column = this._editor.getModel().getLineFirstNonWhitespaceColumn(lineNumber);
		this._widgetPosition = {
			position: { lineNumber: lineNumber, column: column },
			preference: [editorBrowser.ContentWidgetPositionPreference.ABOVE]
		};
	}

	getPosition(): editorBrowser.IContentWidgetPosition | null {
		return this._widgetPosition || null;
	}

	isVisible(): boolean {
		return this._domNode.hasAttribute('monaco-visible-content-widget');
	}
}

export interface IDecorationIdCallback {
	(decorationId: string): void;
}

export class CodeLensHelper {

	private readonly _removeDecorations: string[];
	private readonly _addDecorations: IModelDeltaDecoration[];
	private readonly _addDecorationsCallbacks: IDecorationIdCallback[];

	constructor() {
		this._removeDecorations = [];
		this._addDecorations = [];
		this._addDecorationsCallbacks = [];
	}

	addDecoration(decoration: IModelDeltaDecoration, callback: IDecorationIdCallback): void {
		this._addDecorations.push(decoration);
		this._addDecorationsCallbacks.push(callback);
	}

	removeDecoration(decorationId: string): void {
		this._removeDecorations.push(decorationId);
	}

	commit(changeAccessor: IModelDecorationsChangeAccessor): void {
		let resultingDecorations = changeAccessor.deltaDecorations(this._removeDecorations, this._addDecorations);
		for (let i = 0, len = resultingDecorations.length; i < len; i++) {
			this._addDecorationsCallbacks[i](resultingDecorations[i]);
		}
	}
}

export class CodeLensWidget {

	private readonly _editor: editorBrowser.ICodeEditor;
	private readonly _viewZone!: CodeLensViewZone;
	private readonly _viewZoneId!: string;
	private readonly _contentWidget!: CodeLensContentWidget;
	private _decorationIds: string[];
	private _data: CodeLensItem[];

	constructor(
		data: CodeLensItem[],
		editor: editorBrowser.ICodeEditor,
		className: string,
		helper: CodeLensHelper,
		viewZoneChangeAccessor: editorBrowser.IViewZoneChangeAccessor,
		updateCallback: Function
	) {
		this._editor = editor;
		this._data = data;
		this._decorationIds = new Array<string>(this._data.length);

		let range: Range | undefined;
		let lenses: CodeLens[] = [];
		this._data.forEach((codeLensData, i) => {

			lenses.push(codeLensData.symbol);

			helper.addDecoration({
				range: codeLensData.symbol.range,
				options: ModelDecorationOptions.EMPTY
			}, id => this._decorationIds[i] = id);

			// the range contains all lenses on this line
			if (!range) {
				range = Range.lift(codeLensData.symbol.range);
			} else {
				range = Range.plusRange(range, codeLensData.symbol.range);
			}
		});

		if (range) {
			this._contentWidget = new CodeLensContentWidget(editor, className, range, lenses);
			this._viewZone = new CodeLensViewZone(range.startLineNumber - 1, updateCallback);

			this._viewZoneId = viewZoneChangeAccessor.addZone(this._viewZone);
			this._editor.addContentWidget(this._contentWidget);
		}
	}

	dispose(helper: CodeLensHelper, viewZoneChangeAccessor?: editorBrowser.IViewZoneChangeAccessor): void {
		while (this._decorationIds.length) {
			helper.removeDecoration(this._decorationIds.pop()!);
		}
		if (viewZoneChangeAccessor) {
			viewZoneChangeAccessor.removeZone(this._viewZoneId);
		}
		this._editor.removeContentWidget(this._contentWidget);
	}

	isValid(): boolean {
		if (!this._editor.hasModel()) {
			return false;
		}
		const model = this._editor.getModel();
		return this._decorationIds.some((id, i) => {
			const range = model.getDecorationRange(id);
			const symbol = this._data[i].symbol;
			return !!(range && Range.isEmpty(symbol.range) === range.isEmpty());
		});
	}

	updateCodeLensSymbols(data: CodeLensItem[], helper: CodeLensHelper): void {
		while (this._decorationIds.length) {
			helper.removeDecoration(this._decorationIds.pop()!);
		}
		this._data = data;
		this._decorationIds = new Array<string>(this._data.length);
		this._data.forEach((codeLensData, i) => {
			helper.addDecoration({
				range: codeLensData.symbol.range,
				options: ModelDecorationOptions.EMPTY
			}, id => this._decorationIds[i] = id);
		});
	}

	computeIfNecessary(model: ITextModel): CodeLensItem[] | null {
		if (!this._contentWidget.isVisible()) {
			return null;
		}

		// Read editor current state
		for (let i = 0; i < this._decorationIds.length; i++) {
			const range = model.getDecorationRange(this._decorationIds[i]);
			if (range) {
				this._data[i].symbol.range = range;
			}
		}
		return this._data;
	}

	updateCommands(symbols: Array<CodeLens | undefined | null>): void {
		this._contentWidget.withCommands(symbols, true);
		for (let i = 0; i < this._data.length; i++) {
			const resolved = symbols[i];
			if (resolved) {
				const { symbol } = this._data[i];
				symbol.command = resolved.command || symbol.command;
			}
		}
	}

	getCommand(link: HTMLLinkElement): Command | undefined {
		return this._contentWidget.getCommand(link);
	}

	getLineNumber(): number {
		if (this._editor.hasModel()) {
			const range = this._editor.getModel().getDecorationRange(this._decorationIds[0]);
			if (range) {
				return range.startLineNumber;
			}
		}
		return -1;
	}

	update(viewZoneChangeAccessor: editorBrowser.IViewZoneChangeAccessor): void {
		if (this.isValid() && this._editor.hasModel()) {
			const range = this._editor.getModel().getDecorationRange(this._decorationIds[0]);
			if (range) {
				this._viewZone.afterLineNumber = range.startLineNumber - 1;
				viewZoneChangeAccessor.layoutZone(this._viewZoneId);

				this._contentWidget.setSymbolRange(range);
				this._editor.layoutContentWidget(this._contentWidget);
			}
		}
	}
}

registerThemingParticipant((theme, collector) => {
	const codeLensForeground = theme.getColor(editorCodeLensForeground);
	if (codeLensForeground) {
		collector.addRule(`.monaco-editor .codelens-decoration { color: ${codeLensForeground}; }`);
	}
	const activeLinkForeground = theme.getColor(editorActiveLinkForeground);
	if (activeLinkForeground) {
		collector.addRule(`.monaco-editor .codelens-decoration > a:hover { color: ${activeLinkForeground} !important; }`);
	}
});
