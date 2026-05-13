import * as vscode from 'vscode';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { ProjectModel } from '../models/project-model';
import {
    ProjectItem, IssueContent, DraftIssueContent, PullRequestContent, FieldValue,
} from '../api/types';

export const ISSUE_SCHEME = 'gh-issue';
const NO_DESCRIPTION_PLACEHOLDER = '*No description provided.*';

export interface IssueDocumentInfo {
    projectId: string;
    item: ProjectItem;
    uri: vscode.Uri;
    content: Uint8Array;
    mtime: number;
    size: number;
}

export interface ParsedIssueDocument {
    frontmatter: Record<string, unknown>;
    body: string;
}

export class IssueDocumentProvider implements vscode.FileSystemProvider {
    private readonly encoder = new TextEncoder();
    private readonly decoder = new TextDecoder();
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    private documents = new Map<string, IssueDocumentInfo>();
    private disposables: vscode.Disposable[] = [];

    constructor(private model: ProjectModel) {
        this.disposables.push(
            model.onDidChange(() => {
                for (const info of this.documents.values()) {
                    const updated = model.getProjectItems(info.projectId).find(i => i.id === info.item.id);
                    if (updated) {
                        const isDirty = vscode.workspace.textDocuments.some(
                            doc => doc.uri.toString() === info.uri.toString() && doc.isDirty
                        );
                        info.item = updated;
                        if (isDirty) { continue; }

                        const rendered = this.renderDocument(info);
                        if (rendered !== this.decoder.decode(info.content)) {
                            this.updateStoredContent(info, rendered);
                            this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: info.uri }]);
                        }
                    }
                }
            })
        );
    }

    // --- Public API ---

    registerDocument(projectId: string, item: ProjectItem): vscode.Uri {
        const uri = this.buildUri(projectId, item);
        const key = uri.toString();
        const existing = this.documents.get(key);
        if (existing) {
            existing.item = item;
            existing.projectId = projectId;
            return uri;
        }

        const markdown = this.renderDocument({
            projectId, item, uri,
            content: new Uint8Array(), mtime: 0, size: 0,
        });
        const contentBytes = this.encoder.encode(markdown);
        this.documents.set(key, {
            projectId, item, uri,
            content: contentBytes,
            mtime: Date.now(),
            size: contentBytes.byteLength,
        });
        return uri;
    }

    getDocumentInfo(uri: vscode.Uri): IssueDocumentInfo | undefined {
        return this.documents.get(uri.toString());
    }

    /** Parse a document's text into frontmatter object + body string. */
    static parseDocument(text: string): ParsedIssueDocument {
        const normalized = text.replace(/\r\n/g, '\n');
        const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!match) {
            return { frontmatter: {}, body: normalized };
        }
        let frontmatter: Record<string, unknown> = {};
        try {
            frontmatter = yamlParse(match[1]) ?? {};
        } catch {
            frontmatter = {};
        }
        return { frontmatter, body: match[2] };
    }

    /** Convert a field display name to a YAML-safe key. */
    static fieldNameToKey(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    // --- FileSystemProvider ---

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const info = this.requireDocument(uri);
        return {
            type: vscode.FileType.File,
            ctime: info.mtime,
            mtime: info.mtime,
            size: info.size,
        };
    }

    readDirectory(): [string, vscode.FileType][] { return []; }
    createDirectory(): void { throw vscode.FileSystemError.NoPermissions(); }

    readFile(uri: vscode.Uri): Uint8Array {
        return this.requireDocument(uri).content;
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
        const info = this.documents.get(uri.toString());
        if (!info) {
            if (!options.create) { throw vscode.FileSystemError.FileNotFound(uri); }
            throw vscode.FileSystemError.NoPermissions('New issue documents cannot be created directly.');
        }

        const text = this.decoder.decode(content);
        const { frontmatter, body } = IssueDocumentProvider.parseDocument(text);
        const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
            ? frontmatter.title.trim()
            : (info.item.content?.title ?? 'Issue');

        let cleanBody = body.trim();
        if (cleanBody === NO_DESCRIPTION_PLACEHOLDER) { cleanBody = ''; }

        // Save title + body via issue/draft mutation
        if (info.item.content?.__typename === 'Issue') {
            await this.model.updateIssue(info.item.content.id, title, cleanBody || undefined);
        } else if (info.item.content?.__typename === 'DraftIssue') {
            await this.model.updateDraftIssue(info.item.content.id, title, cleanBody || undefined);
        } else {
            throw vscode.FileSystemError.NoPermissions('Only issues and draft issues can be saved.');
        }

        // Save free-form project field changes (text, number, date)
        await this.saveFreeFormFields(info, frontmatter);

        // Reload and refresh
        await this.model.loadProjectItems(info.projectId);
        const updated = this.model.getProjectItems(info.projectId).find(i => i.id === info.item.id);
        if (updated) {
            info.item = updated;
            this.updateStoredContent(info, this.renderDocument(info));
        } else {
            this.updateStoredContent(info, text);
        }
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(): void { throw vscode.FileSystemError.NoPermissions(); }
    rename(): void { throw vscode.FileSystemError.NoPermissions(); }

    // --- Rendering ---

    private renderDocument(info: IssueDocumentInfo): string {
        const { item } = info;
        const content = item.content;
        if (!content) { return '---\ntitle: (Redacted item)\n---\n'; }

        const fm: Record<string, unknown> = {};
        let body = '';

        if (content.__typename === 'Issue') {
            const issue = content as IssueContent;
            fm.title = issue.title;
            fm.repository = issue.repository.nameWithOwner;
            fm.number = issue.number;
            fm.state = issue.state;
            fm.url = issue.url;
            if (issue.assignees?.nodes?.length) {
                fm.assignees = issue.assignees.nodes.map(a => a.login);
            }
            if (issue.labels?.nodes?.length) {
                fm.labels = issue.labels.nodes.map(l => l.name);
            }
            if (issue.milestone) {
                fm.milestone = issue.milestone.title;
            }
            if (issue.subIssuesSummary && issue.subIssuesSummary.total > 0) {
                fm.sub_issues = `${issue.subIssuesSummary.completed}/${issue.subIssuesSummary.total} (${issue.subIssuesSummary.percentCompleted}%)`;
            }
            this.addFieldValuesToFrontmatter(fm, item);
            body = issue.body || NO_DESCRIPTION_PLACEHOLDER;

        } else if (content.__typename === 'DraftIssue') {
            const draft = content as DraftIssueContent;
            fm.title = draft.title;
            fm.type = 'Draft Issue';
            this.addFieldValuesToFrontmatter(fm, item);
            body = draft.body || NO_DESCRIPTION_PLACEHOLDER;

        } else if (content.__typename === 'PullRequest') {
            const pr = content as PullRequestContent;
            fm.title = pr.title;
            fm.repository = pr.repository.nameWithOwner;
            fm.number = pr.number;
            fm.state = pr.state;
            fm.url = pr.url;
            if (pr.assignees?.nodes?.length) {
                fm.assignees = pr.assignees.nodes.map(a => a.login);
            }
            this.addFieldValuesToFrontmatter(fm, item);
        }

        const yamlBlock = yamlStringify(fm, { lineWidth: 0 }).trimEnd();
        const parts = ['---', yamlBlock, '---', ''];
        if (body) { parts.push(body, ''); }
        return parts.join('\n');
    }

    private addFieldValuesToFrontmatter(fm: Record<string, unknown>, item: ProjectItem): void {
        for (const fv of item.fieldValues?.nodes ?? []) {
            if (fv.field?.name === 'Title') { continue; }
            const key = IssueDocumentProvider.fieldNameToKey(fv.field?.name ?? '');
            if (!key) { continue; }
            const val = this.formatFieldValue(fv);
            if (val !== undefined && val !== '') { fm[key] = val; }
        }
    }

    private formatFieldValue(fv: FieldValue): string | number | undefined {
        switch (fv.__typename) {
            case 'ProjectV2ItemFieldTextValue': return fv.text || undefined;
            case 'ProjectV2ItemFieldNumberValue': return fv.number ?? undefined;
            case 'ProjectV2ItemFieldDateValue': return fv.date || undefined;
            case 'ProjectV2ItemFieldSingleSelectValue': return fv.name || undefined;
            case 'ProjectV2ItemFieldIterationValue': return fv.title || undefined;
            default: return undefined;
        }
    }

    // --- Free-form field save ---

    private async saveFreeFormFields(info: IssueDocumentInfo, frontmatter: Record<string, unknown>): Promise<void> {
        const detail = this.model.getProjectDetail(info.projectId);
        if (!detail) { return; }

        for (const field of detail.fields.nodes) {
            if (field.__typename !== 'ProjectV2Field') { continue; }
            if (field.dataType === 'TITLE') { continue; }

            const key = IssueDocumentProvider.fieldNameToKey(field.name);
            if (!(key in frontmatter)) { continue; }

            const newValue = frontmatter[key];
            const currentFv = info.item.fieldValues.nodes.find(fv => fv.field?.name === field.name);
            let mutationValue: Record<string, unknown> | undefined;

            if (field.dataType === 'TEXT') {
                const newText = String(newValue ?? '');
                const curText = currentFv?.__typename === 'ProjectV2ItemFieldTextValue' ? currentFv.text : '';
                if (newText !== curText) { mutationValue = { text: newText }; }
            } else if (field.dataType === 'NUMBER') {
                const newNum = typeof newValue === 'number' ? newValue : parseFloat(String(newValue));
                const curNum = currentFv?.__typename === 'ProjectV2ItemFieldNumberValue' ? currentFv.number : NaN;
                if (!isNaN(newNum) && newNum !== curNum) { mutationValue = { number: newNum }; }
            } else if (field.dataType === 'DATE') {
                const newDate = String(newValue ?? '');
                const curDate = currentFv?.__typename === 'ProjectV2ItemFieldDateValue' ? currentFv.date : '';
                if (newDate && newDate !== curDate) { mutationValue = { date: newDate }; }
            }

            if (mutationValue) {
                try {
                    await this.model.updateItemField(info.projectId, info.item.id, field.id, mutationValue);
                } catch (err) {
                    vscode.window.showWarningMessage(`Failed to update field "${field.name}": ${err}`);
                }
            }
        }
    }

    // --- Internal helpers ---

    private buildUri(projectId: string, item: ProjectItem): vscode.Uri {
        const content = item.content;
        let name = 'item';
        if (content) {
            if (content.__typename === 'Issue') {
                name = `${(content as IssueContent).repository.nameWithOwner}#${(content as IssueContent).number}`;
            } else if (content.__typename === 'DraftIssue') {
                name = `draft-${item.id.slice(0, 8)}`;
            } else if (content.__typename === 'PullRequest') {
                name = `${(content as PullRequestContent).repository.nameWithOwner}#${(content as PullRequestContent).number}`;
            }
        }
        return vscode.Uri.from({
            scheme: ISSUE_SCHEME,
            path: `/${name.replace(/\//g, '-')}.md`,
            query: `projectId=${encodeURIComponent(projectId)}&itemId=${encodeURIComponent(item.id)}`,
        });
    }

    private requireDocument(uri: vscode.Uri): IssueDocumentInfo {
        const info = this.documents.get(uri.toString());
        if (!info) { throw vscode.FileSystemError.FileNotFound(uri); }
        return info;
    }

    private updateStoredContent(info: IssueDocumentInfo, markdown: string): void {
        const bytes = this.encoder.encode(markdown);
        info.content = bytes;
        info.mtime = Date.now();
        info.size = bytes.byteLength;
    }

    dispose(): void {
        this._onDidChangeFile.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
