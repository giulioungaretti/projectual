import * as vscode from 'vscode';
import { TreeElement, ProjectNode, StatusGroupNode, ItemNode, MessageNode } from './tree-types';
import { createTreeItem } from './tree-items';
import { ProjectModel } from '../models/project-model';
import { GitHubAuth } from '../auth/github-auth';
import { ProjectItem, IssueContent, SingleSelectFieldValue } from '../api/types';
import { applyFilter } from '../utils/filter';

export type GroupByMode = 'none' | 'status';

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeElement> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;
    private _focusedProjectId: string | undefined;
    private _groupBy: GroupByMode = 'none';
    private _filterQuery: string = '';

    constructor(
        private model: ProjectModel,
        private auth: GitHubAuth,
    ) {
        model.onDidChange(() => this._onDidChangeTreeData.fire());
        auth.onDidChangeAuth(() => this._onDidChangeTreeData.fire());
    }

    get focusedProjectId(): string | undefined {
        return this._focusedProjectId;
    }

    get groupBy(): GroupByMode {
        return this._groupBy;
    }

    get filterQuery(): string {
        return this._filterQuery;
    }

    setFilter(query: string): void {
        this._filterQuery = query;
        vscode.commands.executeCommand('setContext', 'ghProjects.hasTreeFilter', query.length > 0);
        this._onDidChangeTreeData.fire();
    }

    setGroupBy(mode: GroupByMode): void {
        this._groupBy = mode;
        vscode.commands.executeCommand('setContext', 'ghProjects.groupBy', mode);
        this._onDidChangeTreeData.fire();
    }

    focusProject(projectId: string): void {
        this._focusedProjectId = projectId;
        vscode.commands.executeCommand('setContext', 'ghProjects.hasFocusedProject', true);
        this._onDidChangeTreeData.fire();
    }

    clearFocus(): void {
        this._focusedProjectId = undefined;
        vscode.commands.executeCommand('setContext', 'ghProjects.hasFocusedProject', false);
        this._onDidChangeTreeData.fire();
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
            case 'item':
                return this.getItemChildren(element);
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

        let projects = this.model.projects;
        if (this._focusedProjectId) {
            projects = projects.filter(p => p.id === this._focusedProjectId);
        }

        return projects.map(
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

        // Build a set of all issue IDs that are sub-issues (have a parent in this project)
        const childIssueIds = this.model.getChildIssueIds(projectId);

        // Filter to only top-level items (not sub-issues of another item in the project)
        let topLevelItems = items.filter(item => {
            if (item.type === 'REDACTED') { return false; }
            if (item.content?.__typename === 'Issue') {
                const issue = item.content as IssueContent;
                return !childIssueIds.has(issue.id);
            }
            return true;
        });

        // Apply text filter if active
        if (this._filterQuery) {
            topLevelItems = applyFilter(topLevelItems, this._filterQuery, this.model, projectId);
        }

        const statusField = this.model.getStatusField(projectId);

        // No grouping (default) — flat list with sub-issue nesting only
        if (this._groupBy === 'none' || !statusField) {
            return topLevelItems.map((item): ItemNode => ({
                type: 'item', projectId, item,
            }));
        }

        // Group by status
        const groups: StatusGroupNode[] = [];
        const itemsByStatus = new Map<string, ProjectItem[]>();
        const noStatusItems: ProjectItem[] = [];

        for (const item of topLevelItems) {
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

    private getItemChildren(element: ItemNode): TreeElement[] {
        const content = element.item.content;
        if (!content || content.__typename !== 'Issue') { return []; }

        const issue = content as IssueContent;
        const subIssueIds = issue.subIssues?.nodes?.map(n => n.id) ?? [];
        if (subIssueIds.length === 0) { return []; }

        // Find the project items whose content matches these sub-issue IDs
        const allItems = this.model.getProjectItems(element.projectId);
        const subItems: ItemNode[] = [];

        for (const subId of subIssueIds) {
            const match = allItems.find(
                i => i.content && 'id' in i.content && i.content.id === subId
            );
            if (match) {
                subItems.push({
                    type: 'item',
                    projectId: element.projectId,
                    item: match,
                });
            }
        }

        return subItems;
    }
}
