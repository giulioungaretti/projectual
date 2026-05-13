import * as vscode from 'vscode';
import { ISSUE_SCHEME, IssueDocumentProvider } from '../webview/issue-document-provider';
import { ProjectModel } from '../models/project-model';
import {
    ProjectField, ProjectSingleSelectField, ProjectIterationField,
} from '../api/types';

/**
 * Provides CodeLens actions on constrained fields in the YAML frontmatter.
 * Single-select and iteration fields get a "Change" lens that opens a QuickPick.
 * Assignees and labels get lenses that trigger existing commands.
 */
export class IssueCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    constructor(
        private model: ProjectModel,
        private docProvider: IssueDocumentProvider,
    ) {
        model.onDidChange(() => this._onDidChange.fire());
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (document.uri.scheme !== ISSUE_SCHEME) { return []; }

        const info = this.docProvider.getDocumentInfo(document.uri);
        if (!info) { return []; }

        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Find frontmatter boundaries
        let fmStart = -1;
        let fmEnd = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                if (fmStart === -1) { fmStart = i; }
                else { fmEnd = i; break; }
            }
        }
        if (fmStart === -1 || fmEnd === -1) { return []; }

        const detail = this.model.getProjectDetail(info.projectId);
        const fields = detail?.fields.nodes ?? [];

        for (let i = fmStart + 1; i < fmEnd; i++) {
            const line = lines[i];
            const colonIdx = line.indexOf(':');
            if (colonIdx <= 0) { continue; }

            const key = line.substring(0, colonIdx).trim();
            const range = new vscode.Range(i, 0, i, line.length);

            // Constrained project fields (single-select, iteration)
            const matchedField = fields.find(
                f => IssueDocumentProvider.fieldNameToKey(f.name) === key
            );
            if (matchedField) {
                if (matchedField.__typename === 'ProjectV2SingleSelectField') {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(edit) Change',
                        command: 'ghProjects.changeFieldFromDocument',
                        arguments: [document.uri, matchedField.name],
                    }));
                    continue;
                }
                if (matchedField.__typename === 'ProjectV2IterationField') {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(edit) Change',
                        command: 'ghProjects.changeFieldFromDocument',
                        arguments: [document.uri, matchedField.name],
                    }));
                    continue;
                }
            }

            // Built-in constrained fields
            if (key === 'assignees') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(person-add) Change Assignees',
                    command: 'ghProjects.changeAssigneesFromDocument',
                    arguments: [document.uri],
                }));
            } else if (key === 'labels') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(tag) Change Labels',
                    command: 'ghProjects.changeLabelsFromDocument',
                    arguments: [document.uri],
                }));
            } else if (key === 'url') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(link-external) Open in GitHub',
                    command: 'ghProjects.openInGitHubFromDocument',
                    arguments: [document.uri],
                }));
            }
        }

        return lenses;
    }
}
