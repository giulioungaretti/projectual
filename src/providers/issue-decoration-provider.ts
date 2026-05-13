import * as vscode from 'vscode';
import { ISSUE_SCHEME } from '../webview/issue-document-provider';

const FRONTMATTER_DECORATION = vscode.window.createTextEditorDecorationType({
    opacity: '0.7',
    isWholeLine: true,
    light: { backgroundColor: 'rgba(0,0,0,0.03)' },
    dark: { backgroundColor: 'rgba(255,255,255,0.03)' },
});

const FRONTMATTER_DELIMITER = vscode.window.createTextEditorDecorationType({
    opacity: '0.4',
    isWholeLine: true,
});

/**
 * Applies visual decorations to the YAML frontmatter section,
 * dimming it to signal that constrained fields should be changed
 * via CodeLens rather than direct editing.
 */
export function activateIssueDecorations(context: vscode.ExtensionContext): void {
    const applyDecorations = (editor: vscode.TextEditor | undefined) => {
        if (!editor || editor.document.uri.scheme !== ISSUE_SCHEME) { return; }

        const text = editor.document.getText();
        const lines = text.split('\n');

        let fmStart = -1;
        let fmEnd = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                if (fmStart === -1) { fmStart = i; }
                else { fmEnd = i; break; }
            }
        }
        if (fmStart === -1 || fmEnd === -1) { return; }

        // Dim the delimiter lines
        const delimiterRanges = [
            new vscode.Range(fmStart, 0, fmStart, lines[fmStart].length),
            new vscode.Range(fmEnd, 0, fmEnd, lines[fmEnd].length),
        ];
        editor.setDecorations(FRONTMATTER_DELIMITER, delimiterRanges);

        // Dim the frontmatter content lines
        const contentRanges: vscode.Range[] = [];
        for (let i = fmStart + 1; i < fmEnd; i++) {
            contentRanges.push(new vscode.Range(i, 0, i, lines[i].length));
        }
        editor.setDecorations(FRONTMATTER_DECORATION, contentRanges);
    };

    // Apply on open and on change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(applyDecorations),
        vscode.workspace.onDidChangeTextDocument(e => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === e.document) {
                applyDecorations(editor);
            }
        }),
    );

    // Apply to currently active editor
    applyDecorations(vscode.window.activeTextEditor);
}
