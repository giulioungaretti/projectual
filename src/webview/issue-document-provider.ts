import * as vscode from 'vscode';
import { ProjectModel } from '../models/project-model';
import { ProjectItem, IssueContent, DraftIssueContent, PullRequestContent, FieldValue } from '../api/types';

export const ISSUE_SCHEME = 'gh-issue';

interface IssueDocumentInfo {
    projectId: string;
    item: ProjectItem;
}

export class IssueDocumentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    private documents = new Map<string, IssueDocumentInfo>();
    private disposables: vscode.Disposable[] = [];

    constructor(private model: ProjectModel) {
        this.disposables.push(
            model.onDidChange(() => {
                for (const [key, info] of this.documents) {
                    const updated = model.getProjectItems(info.projectId).find(i => i.id === info.item.id);
                    if (updated) {
                        info.item = updated;
                        this._onDidChange.fire(this.buildUri(info.projectId, updated));
                    }
                }
            })
        );
    }

    registerDocument(projectId: string, item: ProjectItem): vscode.Uri {
        const uri = this.buildUri(projectId, item);
        this.documents.set(uri.toString(), { projectId, item });
        return uri;
    }

    getDocumentInfo(uri: vscode.Uri): IssueDocumentInfo | undefined {
        return this.documents.get(uri.toString());
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const info = this.documents.get(uri.toString());
        if (!info) {
            return '# Issue not found';
        }
        return this.renderMarkdown(info);
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
            lines.push(issue.body || '*No description provided.*');
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
            lines.push('');
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
        this._onDidChange.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
