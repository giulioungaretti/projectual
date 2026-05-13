import * as vscode from 'vscode';
import { TreeElement, ProjectNode, StatusGroupNode, ItemNode, MessageNode } from './tree-types';
import { createTreeItem } from './tree-items';
import { ProjectModel } from '../models/project-model';
import { GitHubAuth } from '../auth/github-auth';
import { ProjectItem, SingleSelectFieldValue } from '../api/types';

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private model: ProjectModel,
        private auth: GitHubAuth,
    ) {
        model.onDidChange(() => this._onDidChangeTreeData.fire());
        auth.onDidChangeAuth(() => this._onDidChangeTreeData.fire());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeElement): vscode.TreeItem {
        return createTreeItem(element);
    }

    async getChildren(element?: TreeElement): Promise<TreeElement[]> {
        if (!element) {
            return this.getRootChildren();
        }
        switch (element.type) {
            case 'project':
                return this.getProjectChildren(element);
            case 'statusGroup':
                return this.getStatusGroupChildren(element);
            default:
                return [];
        }
    }

    private async getRootChildren(): Promise<TreeElement[]> {
        if (!this.auth.isAuthenticated) {
            const token = await this.auth.getToken();
            if (!token) {
                return [{
                    type: 'message',
                    label: '$(sign-in) Sign in to GitHub',
                    command: { command: 'ghProjects.signIn', title: 'Sign In' },
                }];
            }
        }

        if (this.model.projects.length === 0 && !this._loading) {
            this._loading = true;
            try {
                await this.model.loadProjects();
            } finally {
                this._loading = false;
            }
        }

        if (this.model.projects.length === 0) {
            return [{ type: 'message', label: 'No projects found' }];
        }

        return this.model.projects.map(
            (project): ProjectNode => ({ type: 'project', project })
        );
    }

    private async getProjectChildren(element: ProjectNode): Promise<TreeElement[]> {
        const projectId = element.project.id;

        let detail = this.model.getProjectDetail(projectId);
        if (!detail) {
            detail = await this.model.loadProjectDetail(projectId);
        }

        let items = this.model.getProjectItems(projectId);
        if (items.length === 0) {
            items = await this.model.loadProjectItems(projectId);
        }

        const statusField = this.model.getStatusField(projectId);
        if (!statusField) {
            // No Status field — show flat list
            return items.map((item): ItemNode => ({
                type: 'item', projectId, item,
            }));
        }

        // Group by status
        const groups: StatusGroupNode[] = [];
        const itemsByStatus = new Map<string, ProjectItem[]>();
        const noStatusItems: ProjectItem[] = [];

        for (const item of items) {
            if (item.type === 'REDACTED') { continue; }
            const status = this.model.getItemStatus(item);
            if (status) {
                const bucket = itemsByStatus.get(status.optionId) ?? [];
                bucket.push(item);
                itemsByStatus.set(status.optionId, bucket);
            } else {
                noStatusItems.push(item);
            }
        }

        for (const option of statusField.options) {
            groups.push({
                type: 'statusGroup',
                projectId,
                status: option,
                items: itemsByStatus.get(option.id) ?? [],
            });
        }

        if (noStatusItems.length > 0) {
            groups.push({
                type: 'statusGroup',
                projectId,
                status: null,
                items: noStatusItems,
            });
        }

        return groups;
    }

    private getStatusGroupChildren(element: StatusGroupNode): TreeElement[] {
        return element.items.map((item): ItemNode => ({
            type: 'item',
            projectId: element.projectId,
            item,
        }));
    }
}
