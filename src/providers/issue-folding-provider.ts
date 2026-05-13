import * as vscode from 'vscode';
import { ISSUE_SCHEME } from '../webview/issue-document-provider';

/**
 * Makes the YAML frontmatter section collapsible so the user
 * can focus on the body.
 */
export class IssueFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        if (document.uri.scheme !== ISSUE_SCHEME) { return []; }

        const ranges: vscode.FoldingRange[] = [];
        const lineCount = document.lineCount;

        let fmStart = -1;
        let fmEnd = -1;
        for (let i = 0; i < lineCount; i++) {
            const text = document.lineAt(i).text.trim();
            if (text === '---') {
                if (fmStart === -1) { fmStart = i; }
                else { fmEnd = i; break; }
            }
        }

        if (fmStart >= 0 && fmEnd > fmStart) {
            ranges.push(new vscode.FoldingRange(fmStart, fmEnd, vscode.FoldingRangeKind.Region));
        }

        return ranges;
    }
}
