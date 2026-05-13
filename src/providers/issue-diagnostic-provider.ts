import * as vscode from 'vscode';
import { ISSUE_SCHEME, IssueDocumentProvider } from '../webview/issue-document-provider';
import { ProjectModel } from '../models/project-model';
import { ProjectSingleSelectField, ProjectIterationField } from '../api/types';

/**
 * Validates the YAML frontmatter and shows diagnostics when
 * a constrained field has been manually changed to an invalid value.
 */
export class IssueDiagnosticProvider {
    private collection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private model: ProjectModel,
        private docProvider: IssueDocumentProvider,
    ) {
        this.collection = vscode.languages.createDiagnosticCollection('ghProjects');

        this.disposables.push(
            this.collection,
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.scheme === ISSUE_SCHEME) {
                    this.validate(e.document);
                }
            }),
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.uri.scheme === ISSUE_SCHEME) {
                    this.validate(doc);
                }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                if (doc.uri.scheme === ISSUE_SCHEME) {
                    this.collection.delete(doc.uri);
                }
            }),
        );
    }

    private validate(document: vscode.TextDocument): void {
        const info = this.docProvider.getDocumentInfo(document.uri);
        if (!info) { return; }

        const detail = this.model.getProjectDetail(info.projectId);
        if (!detail) { return; }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Find frontmatter
        let fmStart = -1;
        let fmEnd = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                if (fmStart === -1) { fmStart = i; }
                else { fmEnd = i; break; }
            }
        }
        if (fmStart === -1 || fmEnd === -1) { return; }

        const parsed = IssueDocumentProvider.parseDocument(text);

        for (const field of detail.fields.nodes) {
            const key = IssueDocumentProvider.fieldNameToKey(field.name);
            if (!(key in parsed.frontmatter)) { continue; }

            const userValue = String(parsed.frontmatter[key] ?? '');

            if (field.__typename === 'ProjectV2SingleSelectField') {
                const ssField = field as ProjectSingleSelectField;
                const validNames = ssField.options.map(o => o.name);
                if (userValue && !validNames.includes(userValue)) {
                    const lineIdx = this.findKeyLine(lines, fmStart, fmEnd, key);
                    if (lineIdx >= 0) {
                        const range = new vscode.Range(lineIdx, 0, lineIdx, lines[lineIdx].length);
                        const diag = new vscode.Diagnostic(
                            range,
                            `Invalid value "${userValue}" for ${field.name}. Valid: ${validNames.join(', ')}. Use the CodeLens "Change" action instead.`,
                            vscode.DiagnosticSeverity.Warning,
                        );
                        diag.source = 'GitHub Projects';
                        diagnostics.push(diag);
                    }
                }
            } else if (field.__typename === 'ProjectV2IterationField') {
                const itField = field as ProjectIterationField;
                const validTitles = itField.configuration.iterations.map(i => i.title);
                if (userValue && !validTitles.includes(userValue)) {
                    const lineIdx = this.findKeyLine(lines, fmStart, fmEnd, key);
                    if (lineIdx >= 0) {
                        const range = new vscode.Range(lineIdx, 0, lineIdx, lines[lineIdx].length);
                        const diag = new vscode.Diagnostic(
                            range,
                            `Invalid value "${userValue}" for ${field.name}. Valid: ${validTitles.join(', ')}. Use the CodeLens "Change" action instead.`,
                            vscode.DiagnosticSeverity.Warning,
                        );
                        diag.source = 'GitHub Projects';
                        diagnostics.push(diag);
                    }
                }
            }
        }

        // Warn about read-only fields edited
        const readOnlyKeys = ['repository', 'number', 'state', 'sub_issues', 'type'];
        for (const roKey of readOnlyKeys) {
            if (!(roKey in parsed.frontmatter)) { continue; }
            // Check if value differs from rendered
            const original = IssueDocumentProvider.parseDocument(
                this.docProvider.getDocumentInfo(document.uri)
                    ? new TextDecoder().decode(this.docProvider.getDocumentInfo(document.uri)!.content)
                    : ''
            );
            const origVal = String(original.frontmatter[roKey] ?? '');
            const curVal = String(parsed.frontmatter[roKey] ?? '');
            if (origVal && curVal !== origVal) {
                const lineIdx = this.findKeyLine(lines, fmStart, fmEnd, roKey);
                if (lineIdx >= 0) {
                    const range = new vscode.Range(lineIdx, 0, lineIdx, lines[lineIdx].length);
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        `"${roKey}" is read-only and changes will be ignored on save.`,
                        vscode.DiagnosticSeverity.Information,
                    ));
                }
            }
        }

        this.collection.set(document.uri, diagnostics);
    }

    private findKeyLine(lines: string[], fmStart: number, fmEnd: number, key: string): number {
        for (let i = fmStart + 1; i < fmEnd; i++) {
            const colonIdx = lines[i].indexOf(':');
            if (colonIdx > 0 && lines[i].substring(0, colonIdx).trim() === key) {
                return i;
            }
        }
        return -1;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
