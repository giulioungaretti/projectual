import * as vscode from 'vscode';
import { ProjectModel } from '../models/project-model';
import { ProjectItem, IssueContent, DraftIssueContent, PullRequestContent, FieldValue } from '../api/types';

export const ISSUE_SCHEME = 'gh-issue';
const NO_DESCRIPTION_PLACEHOLDER = '*No description provided.*';

interface IssueDocumentInfo {
    projectId: string;
    item: ProjectItem;
    uri: vscode.Uri;
    content: Uint8Array;
    mtime: number;
    size: number;
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
                        if (isDirty) {
                            continue;
                        }

                        const rendered = this.renderMarkdown({ ...info, item: updated });
                        if (rendered !== this.decoder.decode(info.content)) {
                            this.updateStoredContent(info, rendered);
                            this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: info.uri }]);
                        }
                    }
                }
            })
        );
    }

    registerDocument(projectId: string, item: ProjectItem): vscode.Uri {
        const uri = this.buildUri(projectId, item);
        const key = uri.toString();
        const existing = this.documents.get(key);
        if (existing) {
            existing.item = item;
            existing.projectId = projectId;
            return uri;
        }

        const markdown = this.renderMarkdown({
            projectId,
            item,
            uri,
            content: new Uint8Array(),
            mtime: 0,
            size: 0,
        });
        const contentBytes = this.encoder.encode(markdown);
        this.documents.set(key, {
            projectId,
            item,
            uri,
            content: contentBytes,
            mtime: Date.now(),
            size: contentBytes.byteLength,
        });
        return uri;
    }

    getDocumentInfo(uri: vscode.Uri): IssueDocumentInfo | undefined {
        return this.documents.get(uri.toString());
    }

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

    readDirectory(): [string, vscode.FileType][] {
        return [];
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions('Directories are not supported.');
    }

    readFile(uri: vscode.Uri): Uint8Array {
        return this.requireDocument(uri).content;
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
        const info = this.documents.get(uri.toString());
        if (!info) {
            if (!options.create) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            throw vscode.FileSystemError.NoPermissions('New issue documents cannot be created directly.');
        }

        const text = this.decoder.decode(content);
        const parsed = this.parseEditableContent(info.item, text);

        if (info.item.content?.__typename === 'Issue') {
            await this.model.updateIssue(info.item.content.id, parsed.title, parsed.body || undefined);
        } else if (info.item.content?.__typename === 'DraftIssue') {
            await this.model.updateDraftIssue(info.item.content.id, parsed.title, parsed.body || undefined);
        } else {
            throw vscode.FileSystemError.NoPermissions('Only issues and draft issues can be saved.');
        }

        await this.model.loadProjectItems(info.projectId);
        const updated = this.model.getProjectItems(info.projectId).find(item => item.id === info.item.id);
        if (updated) {
            info.item = updated;
            this.updateStoredContent(info, this.renderMarkdown(info));
        } else {
            this.updateStoredContent(info, text);
        }

        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(): void {
        throw vscode.FileSystemError.NoPermissions('Issue documents cannot be deleted.');
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions('Issue documents cannot be renamed.');
    }

    private buildUri(projectId: string, item: ProjectItem): vscode.Uri {
        const content = item.content;
        let name = 'item';
        if (content) {
            if (content.__typename === 'Issue') {
                const issue = content as IssueContent;
                name = `${issue.repository.nameWithOwner}#${issue.number}`;
            } else if (content.__typename === 'DraftIssue') {
                name = `draft-${item.id.slice(0, 8)}`;
            } else if (content.__typename === 'PullRequest') {
                const pr = content as PullRequestContent;
                name = `${pr.repository.nameWithOwner}#${pr.number}`;
            }
        }
        // Encode projectId and itemId in the query so we can look them up
        return vscode.Uri.from({
            scheme: ISSUE_SCHEME,
            path: `/${name.replace(/\//g, '-')}.md`,
            query: `projectId=${encodeURIComponent(projectId)}&itemId=${encodeURIComponent(item.id)}`,
        });
    }

    private requireDocument(uri: vscode.Uri): IssueDocumentInfo {
        const info = this.documents.get(uri.toString());
        if (!info) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return info;
    }

    private updateStoredContent(info: IssueDocumentInfo, markdown: string): void {
        const bytes = this.encoder.encode(markdown);
        info.content = bytes;
        info.mtime = Date.now();
        info.size = bytes.byteLength;
    }

    private renderMarkdown(info: IssueDocumentInfo): string {
        const { item } = info;
        const content = item.content;
        if (!content) {
            return '# (Redacted item)';
        }

        const lines: string[] = [];

        if (content.__typename === 'Issue') {
            const issue = content as IssueContent;
            lines.push(`# ${issue.title}`);
            lines.push('');
            lines.push(`> **Repository:** ${issue.repository.nameWithOwner} · **#${issue.number}** · **State:** ${issue.state} · [Open in GitHub](${issue.url})`);
            lines.push('');

            // Metadata section
            const meta: string[] = [];
            if (issue.assignees?.nodes?.length) {
                meta.push(`**Assignees:** ${issue.assignees.nodes.map(a => `@${a.login}`).join(', ')}`);
            }
            if (issue.labels?.nodes?.length) {
                meta.push(`**Labels:** ${issue.labels.nodes.map(l => `\`${l.name}\``).join(', ')}`);
            }
            if (issue.milestone) {
                meta.push(`**Milestone:** ${issue.milestone.title}`);
            }
            if (issue.subIssuesSummary && issue.subIssuesSummary.total > 0) {
                meta.push(`**Sub-issues:** ${issue.subIssuesSummary.completed}/${issue.subIssuesSummary.total} (${issue.subIssuesSummary.percentCompleted}%)`);
            }

            // Project field values
            const fieldValues = item.fieldValues?.nodes ?? [];
            for (const fv of fieldValues) {
                if (fv.field?.name === 'Title') { continue; }
                const val = this.formatFieldValue(fv);
                if (val) {
                    meta.push(`**${fv.field?.name}:** ${val}`);
                }
            }

            if (meta.length > 0) {
                lines.push(...meta);
                lines.push('');
            }

            lines.push('---');
            lines.push('');
            lines.push(issue.body || NO_DESCRIPTION_PLACEHOLDER);
        } else if (content.__typename === 'DraftIssue') {
            const draft = content as DraftIssueContent;
            lines.push(`# ${draft.title}`);
            lines.push('');
            lines.push('> **Draft Issue**');
            lines.push('');

            const fieldValues = item.fieldValues?.nodes ?? [];
            for (const fv of fieldValues) {
                if (fv.field?.name === 'Title') { continue; }
                const val = this.formatFieldValue(fv);
                if (val) {
                    lines.push(`**${fv.field?.name}:** ${val}`);
                }
            }

            lines.push('');
            lines.push('---');
            lines.push(draft.body || NO_DESCRIPTION_PLACEHOLDER);
            lines.push(draft.body || '*No description provided.*');
        } else if (content.__typename === 'PullRequest') {
            const pr = content as PullRequestContent;
            lines.push(`# ${pr.title}`);
            lines.push('');
            lines.push(`> **Pull Request:** ${pr.repository.nameWithOwner}#${pr.number} · **State:** ${pr.state} · [Open in GitHub](${pr.url})`);
            lines.push('');

            if (pr.assignees?.nodes?.length) {
                lines.push(`**Assignees:** ${pr.assignees.nodes.map(a => `@${a.login}`).join(', ')}`);
            }

            const fieldValues = item.fieldValues?.nodes ?? [];
            for (const fv of fieldValues) {
                if (fv.field?.name === 'Title') { continue; }
                const val = this.formatFieldValue(fv);
                if (val) {
                    lines.push(`**${fv.field?.name}:** ${val}`);
                }
            }
        }

        lines.push('');
        return lines.join('\n');
    }

    private parseEditableContent(item: ProjectItem, text: string): { title: string; body: string } {
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        const existingTitle = item.content?.title ?? 'Issue';
        const titleLine = lines.find(line => line.startsWith('# '));
        const title = titleLine ? titleLine.slice(2).trim() || existingTitle : existingTitle;

        const separatorIndex = lines.findIndex(line => line.trim() === '---');
        let bodyLines = separatorIndex >= 0 ? lines.slice(separatorIndex + 1) : [];
        while (bodyLines.length > 0 && bodyLines[0].trim() === '') {
            bodyLines = bodyLines.slice(1);
        }
        while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
            bodyLines = bodyLines.slice(0, -1);
        }

        let body = bodyLines.join('\n');
        if (body === NO_DESCRIPTION_PLACEHOLDER) {
            body = '';
        }

        return { title, body };
    }

    private formatFieldValue(fv: FieldValue): string {
        switch (fv.__typename) {
            case 'ProjectV2ItemFieldTextValue':
                return fv.text || '';
            case 'ProjectV2ItemFieldNumberValue':
                return String(fv.number ?? '');
            case 'ProjectV2ItemFieldDateValue':
                return fv.date || '';
            case 'ProjectV2ItemFieldSingleSelectValue':
                return fv.name || '';
            case 'ProjectV2ItemFieldIterationValue':
                return fv.title || '';
            default:
                return '';
        }
    }

    dispose(): void {
        this._onDidChangeFile.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
