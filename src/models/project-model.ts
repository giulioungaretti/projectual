import * as vscode from 'vscode';
import { GraphQLClient } from '../api/graphql-client';
import {
    ProjectV2, ProjectDetail, ProjectItem, ProjectField,
    ProjectSingleSelectField, FieldValue, SingleSelectFieldValue,
    IssueContent, ProjectItemsPage, PageInfo,
} from '../api/types';
import * as queries from '../api/queries';
import * as mutations from '../api/mutations';

export class ProjectModel {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private _projects: ProjectV2[] = [];
    private _projectDetails = new Map<string, ProjectDetail>();
    private _projectItems = new Map<string, ProjectItem[]>();

    constructor(private client: GraphQLClient) {}

    get projects(): ProjectV2[] {
        return this._projects;
    }

    getProjectDetail(projectId: string): ProjectDetail | undefined {
        return this._projectDetails.get(projectId);
    }

    getProjectItems(projectId: string): ProjectItem[] {
        return this._projectItems.get(projectId) ?? [];
    }

    getStatusField(projectId: string): ProjectSingleSelectField | undefined {
        const detail = this._projectDetails.get(projectId);
        if (!detail) { return undefined; }
        return detail.fields.nodes.find(
            (f): f is ProjectSingleSelectField =>
                f.__typename === 'ProjectV2SingleSelectField' && f.name === 'Status'
        );
    }

    getItemStatus(item: ProjectItem): SingleSelectFieldValue | undefined {
        return item.fieldValues.nodes.find(
            (fv): fv is SingleSelectFieldValue =>
                fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
                fv.field.name === 'Status'
        );
    }

    getItemTitle(item: ProjectItem): string {
        if (!item.content) { return '(Redacted)'; }
        return item.content.title;
    }

    /** Returns the set of issue IDs that are sub-issues of another item in this project. */
    getChildIssueIds(projectId: string): Set<string> {
        const items = this._projectItems.get(projectId) ?? [];
        const childIds = new Set<string>();
        for (const item of items) {
            if (item.content?.__typename === 'Issue') {
                const issue = item.content as IssueContent;
                for (const sub of issue.subIssues?.nodes ?? []) {
                    childIds.add(sub.id);
                }
            }
        }
        return childIds;
    }

    /** Returns true if this item has sub-issues in the project. */
    hasSubIssues(item: ProjectItem): boolean {
        if (item.content?.__typename !== 'Issue') { return false; }
        const issue = item.content as IssueContent;
        return (issue.subIssues?.nodes?.length ?? 0) > 0;
    }

    // --- Data fetching ---

    async loadProjects(): Promise<void> {
        const data = await this.client.query<{
            viewer: { projectsV2: { nodes: ProjectV2[]; pageInfo: PageInfo } };
        }>(queries.GET_VIEWER_PROJECTS, { first: 50 });

        this._projects = data.viewer.projectsV2.nodes;
        this._onDidChange.fire();
    }

    async loadProjectDetail(projectId: string): Promise<ProjectDetail> {
        const data = await this.client.query<{ node: ProjectDetail }>(
            queries.GET_PROJECT_DETAIL, { id: projectId }
        );
        this._projectDetails.set(projectId, data.node);
        return data.node;
    }

    async loadProjectItems(projectId: string): Promise<ProjectItem[]> {
        let allItems: ProjectItem[] = [];
        let after: string | null = null;

        for (;;) {
            type ItemsResponse = { node: { items: { nodes: ProjectItem[]; pageInfo: PageInfo } } };
            const vars = { projectId, first: 100, after };
            const data: ItemsResponse = await this.client.query<ItemsResponse>(
                queries.GET_PROJECT_ITEMS, vars
            );

            allItems = allItems.concat(data.node.items.nodes);
            if (!data.node.items.pageInfo.hasNextPage) { break; }
            after = data.node.items.pageInfo.endCursor;
        }

        this._projectItems.set(projectId, allItems);
        this._onDidChange.fire();
        return allItems;
    }

    // --- Mutations with optimistic updates ---

    async updateItemStatus(
        projectId: string, itemId: string, fieldId: string, optionId: string
    ): Promise<void> {
        // Optimistic update
        const items = this._projectItems.get(projectId);
        const item = items?.find(i => i.id === itemId);
        const prevStatus = item ? this.getItemStatus(item) : undefined;

        if (item) {
            const statusFv = item.fieldValues.nodes.find(
                (fv): fv is SingleSelectFieldValue =>
                    fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
                    fv.field.name === 'Status'
            );
            if (statusFv) {
                statusFv.optionId = optionId;
            }
            this._onDidChange.fire();
        }

        try {
            await this.client.query(mutations.UPDATE_ITEM_FIELD_VALUE, {
                projectId, itemId, fieldId,
                value: { singleSelectOptionId: optionId },
            });
        } catch (err) {
            // Rollback
            if (item && prevStatus) {
                const statusFv = item.fieldValues.nodes.find(
                    (fv): fv is SingleSelectFieldValue =>
                        fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
                        fv.field.name === 'Status'
                );
                if (statusFv) {
                    statusFv.optionId = prevStatus.optionId;
                }
                this._onDidChange.fire();
            }
            throw err;
        }
    }

    async updateItemField(
        projectId: string, itemId: string, fieldId: string,
        value: Record<string, unknown>
    ): Promise<void> {
        await this.client.query(mutations.UPDATE_ITEM_FIELD_VALUE, {
            projectId, itemId, fieldId, value,
        });
        // Reload items to get fresh data
        await this.loadProjectItems(projectId);
    }

    async addDraftIssue(projectId: string, title: string, body?: string): Promise<void> {
        await this.client.query(mutations.ADD_DRAFT_ISSUE, { projectId, title, body });
        await this.loadProjectItems(projectId);
    }

    async createIssue(
        repositoryId: string, title: string, body?: string,
        labelIds?: string[], assigneeIds?: string[]
    ): Promise<{ id: string; number: number; url: string }> {
        const data = await this.client.query<{
            createIssue: { issue: { id: string; number: number; title: string; url: string } };
        }>(mutations.CREATE_ISSUE, { repositoryId, title, body, labelIds, assigneeIds });
        return data.createIssue.issue;
    }

    async addItemToProject(projectId: string, contentId: string): Promise<void> {
        await this.client.query(mutations.ADD_ITEM_TO_PROJECT, { projectId, contentId });
        await this.loadProjectItems(projectId);
    }

    async updateIssue(issueId: string, title?: string, body?: string): Promise<void> {
        await this.client.query(mutations.UPDATE_ISSUE, { id: issueId, title, body });
    }

    async addLabels(issueId: string, labelIds: string[]): Promise<void> {
        await this.client.query(mutations.ADD_LABELS, {
            labelableId: issueId, labelIds,
        });
    }

    async removeLabels(issueId: string, labelIds: string[]): Promise<void> {
        await this.client.query(mutations.REMOVE_LABELS, {
            labelableId: issueId, labelIds,
        });
    }

    async addAssignees(issueId: string, assigneeIds: string[]): Promise<void> {
        await this.client.query(mutations.ADD_ASSIGNEES, {
            assignableId: issueId, assigneeIds,
        });
    }

    async removeAssignees(issueId: string, assigneeIds: string[]): Promise<void> {
        await this.client.query(mutations.REMOVE_ASSIGNEES, {
            assignableId: issueId, assigneeIds,
        });
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
