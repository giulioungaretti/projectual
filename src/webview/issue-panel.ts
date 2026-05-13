import * as vscode from 'vscode';
import { getWebviewContent, SaveIssueMessage, UpdateFieldMessage } from './webview-utils';
import { ProjectModel } from '../models/project-model';
import { ProjectItem, IssueContent } from '../api/types';

export class IssuePanel {
    public static currentPanels = new Map<string, IssuePanel>();

    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    static createOrShow(
        extensionUri: vscode.Uri,
        model: ProjectModel,
        projectId: string,
        item: ProjectItem,
    ): IssuePanel {
        const key = `${projectId}:${item.id}`;
        const existing = IssuePanel.currentPanels.get(key);
        if (existing) {
            existing.panel.reveal(vscode.ViewColumn.Two);
            existing.update();
            return existing;
        }
        const instance = new IssuePanel(extensionUri, model, projectId, item);
        IssuePanel.currentPanels.set(key, instance);
        return instance;
    }

    private constructor(
        private extensionUri: vscode.Uri,
        private model: ProjectModel,
        private projectId: string,
        private item: ProjectItem,
    ) {
        const title = item.content?.title ?? 'Issue';

        this.panel = vscode.window.createWebviewPanel(
            'ghProjects.issue',
            title,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );

        this.panel.iconPath = new vscode.ThemeIcon('issues');
        this.panel.webview.html = getWebviewContent(
            this.panel.webview, extensionUri,
            'issue.css', 'issue.js',
            '<div id="issue-root"><div class="loading">Loading issue...</div></div>'
        );

        this.panel.webview.onDidReceiveMessage(
            msg => this.handleMessage(msg),
            null, this.disposables
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.model.onDidChange(() => this.refreshItem(), null, this.disposables);
    }

    private refreshItem(): void {
        const items = this.model.getProjectItems(this.projectId);
        const updated = items.find(i => i.id === this.item.id);
        if (updated) {
            this.item = updated;
            this.update();
        }
    }

    async update(): Promise<void> {
        const detail = this.model.getProjectDetail(this.projectId);
        this.panel.webview.postMessage({
            type: 'update-issue',
            item: this.item,
            projectFields: detail?.fields.nodes ?? [],
            statusField: this.model.getStatusField(this.projectId),
        });
    }

    private async handleMessage(msg: SaveIssueMessage | UpdateFieldMessage | { type: string; [key: string]: unknown }): Promise<void> {
        switch (msg.type) {
            case 'save-issue': {
                const m = msg as SaveIssueMessage;
                try {
                    await this.model.updateIssue(m.issueId, m.title, m.body);
                    vscode.window.showInformationMessage('Issue updated.');
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to save issue: ${err}`);
                }
                break;
            }
            case 'update-field': {
                const m = msg as UpdateFieldMessage;
                try {
                    await this.model.updateItemField(m.projectId, m.itemId, m.fieldId, m.value);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to update field: ${err}`);
                }
                break;
            }
            case 'open-in-github': {
                const content = this.item.content;
                if (content && 'url' in content) {
                    vscode.env.openExternal(vscode.Uri.parse((content as { url: string }).url));
                }
                break;
            }
            case 'ready':
                await this.update();
                break;
        }
    }

    dispose(): void {
        const key = `${this.projectId}:${this.item.id}`;
        IssuePanel.currentPanels.delete(key);
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
