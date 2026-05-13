import * as vscode from 'vscode';
import { getWebviewContent, MoveItemMessage, OpenItemMessage } from './webview-utils';
import { ProjectModel } from '../models/project-model';
import { ProjectItem, ProjectDetail, ProjectSingleSelectField } from '../api/types';

export class BoardPanel {
    public static currentPanels = new Map<string, BoardPanel>();

    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    static createOrShow(
        extensionUri: vscode.Uri,
        model: ProjectModel,
        projectId: string,
    ): BoardPanel {
        const existing = BoardPanel.currentPanels.get(projectId);
        if (existing) {
            existing.panel.reveal(vscode.ViewColumn.One);
            existing.update();
            return existing;
        }
        const instance = new BoardPanel(extensionUri, model, projectId);
        BoardPanel.currentPanels.set(projectId, instance);
        return instance;
    }

    private constructor(
        private extensionUri: vscode.Uri,
        private model: ProjectModel,
        private projectId: string,
    ) {
        const detail = model.getProjectDetail(projectId);
        const title = detail?.title ?? 'Project Board';

        this.panel = vscode.window.createWebviewPanel(
            'ghProjects.board',
            `Board: ${title}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            }
        );

        this.panel.iconPath = new vscode.ThemeIcon('project');
        this.panel.webview.html = getWebviewContent(
            this.panel.webview, extensionUri,
            'board.css', 'board.js',
            '<div id="board-root"><div class="loading">Loading board...</div></div>'
        );

        this.panel.webview.onDidReceiveMessage(
            msg => this.handleMessage(msg),
            null, this.disposables
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.model.onDidChange(() => this.update(), null, this.disposables);
    }

    async update(): Promise<void> {
        const detail = this.model.getProjectDetail(this.projectId);
        const items = this.model.getProjectItems(this.projectId);
        const statusField = this.model.getStatusField(this.projectId);

        // Collect all unique labels across items for the filter
        const labelSet = new Map<string, { name: string; color: string }>();
        for (const item of items) {
            if (item.content?.__typename === 'Issue') {
                for (const label of (item.content as any).labels?.nodes ?? []) {
                    if (!labelSet.has(label.name)) {
                        labelSet.set(label.name, { name: label.name, color: label.color });
                    }
                }
            }
        }

        // Collect single-select fields (for swimlane options, excluding Status)
        const swimlaneFields = (detail?.fields.nodes ?? [])
            .filter((f: any) => f.__typename === 'ProjectV2SingleSelectField' && f.name !== 'Status')
            .map((f: any) => ({ id: f.id, name: f.name, options: f.options }));

        this.panel.webview.postMessage({
            type: 'update-board',
            project: detail,
            items: items.filter(i => i.type !== 'REDACTED'),
            statusField,
            allLabels: Array.from(labelSet.values()),
            swimlaneFields,
        });
    }

    private async handleMessage(msg: MoveItemMessage | OpenItemMessage | { type: string }): Promise<void> {
        switch (msg.type) {
            case 'move-item': {
                const m = msg as MoveItemMessage;
                const statusField = this.model.getStatusField(this.projectId);
                if (statusField) {
                    try {
                        await this.model.updateItemStatus(
                            this.projectId, m.itemId, statusField.id, m.newStatusOptionId
                        );
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to update status: ${err}`);
                    }
                }
                break;
            }
            case 'open-item': {
                const m = msg as OpenItemMessage;
                const itemId = m.itemId;
                const item = this.model.getProjectItems(this.projectId).find(i => i.id === itemId);
                if (item) {
                    vscode.commands.executeCommand('ghProjects.openItem', this.projectId, item);
                }
                break;
            }
            case 'refresh':
                await this.model.loadProjectItems(this.projectId);
                break;
            case 'ready':
                await this.update();
                break;
            case 'create-draft': {
                const m = msg as { type: string; title: string };
                await this.model.addDraftIssue(this.projectId, m.title);
                break;
            }
        }
    }

    dispose(): void {
        BoardPanel.currentPanels.delete(this.projectId);
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
