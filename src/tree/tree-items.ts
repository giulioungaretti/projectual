import * as vscode from 'vscode';
import { TreeElement } from './tree-types';
import {
    IssueContent, PullRequestContent, DraftIssueContent,
    SingleSelectFieldValue,
} from '../api/types';

export function createTreeItem(element: TreeElement): vscode.TreeItem {
    switch (element.type) {
        case 'project':
            return createProjectTreeItem(element);
        case 'statusGroup':
            return createStatusGroupTreeItem(element);
        case 'item':
            return createItemTreeItem(element);
        case 'message':
            return createMessageTreeItem(element);
    }
}

function createProjectTreeItem(element: Extract<TreeElement, { type: 'project' }>): vscode.TreeItem {
    const item = new vscode.TreeItem(
        element.project.title,
        vscode.TreeItemCollapsibleState.Collapsed
    );
    item.contextValue = 'project';
    item.description = `#${element.project.number}`;
    item.tooltip = new vscode.MarkdownString(
        `**${element.project.title}** #${element.project.number}\n\n${element.project.shortDescription ?? ''}`
    );
    item.iconPath = new vscode.ThemeIcon('project');
    return item;
}

function createStatusGroupTreeItem(element: Extract<TreeElement, { type: 'statusGroup' }>): vscode.TreeItem {
    const label = element.status?.name ?? 'No Status';
    const item = new vscode.TreeItem(
        `${label} (${element.items.length})`,
        vscode.TreeItemCollapsibleState.Collapsed
    );
    item.contextValue = 'statusGroup';
    item.iconPath = new vscode.ThemeIcon('circle-outline');
    return item;
}

function createItemTreeItem(element: Extract<TreeElement, { type: 'item' }>): vscode.TreeItem {
    const content = element.item.content;
    if (!content) {
        const item = new vscode.TreeItem('(Redacted)');
        item.iconPath = new vscode.ThemeIcon('lock');
        return item;
    }

    const title = content.title;
    const treeItem = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    treeItem.contextValue = 'projectItem';

    if (content.__typename === 'Issue') {
        const issue = content as IssueContent;
        treeItem.iconPath = new vscode.ThemeIcon(
            issue.state === 'OPEN' ? 'issues' : 'issue-closed',
            issue.state === 'OPEN'
                ? new vscode.ThemeColor('charts.green')
                : new vscode.ThemeColor('charts.purple')
        );
        treeItem.description = `${issue.repository.nameWithOwner}#${issue.number}`;

        const assignees = issue.assignees.nodes.map(a => a.login).join(', ');
        const labels = issue.labels.nodes.map(l => l.name).join(', ');
        const parts = [
            `**${issue.title}** #${issue.number}`,
            `Repo: ${issue.repository.nameWithOwner}`,
            assignees ? `Assignees: ${assignees}` : null,
            labels ? `Labels: ${labels}` : null,
        ].filter(Boolean);
        treeItem.tooltip = new vscode.MarkdownString(parts.join('\n\n'));

        treeItem.command = {
            command: 'ghProjects.openItem',
            title: 'Open Issue',
            arguments: [element.projectId, element.item],
        };
    } else if (content.__typename === 'PullRequest') {
        const pr = content as PullRequestContent;
        treeItem.iconPath = new vscode.ThemeIcon('git-pull-request');
        treeItem.description = `${pr.repository.nameWithOwner}#${pr.number}`;
        treeItem.command = {
            command: 'ghProjects.openInGitHub',
            title: 'Open PR',
            arguments: [pr.url],
        };
    } else if (content.__typename === 'DraftIssue') {
        treeItem.iconPath = new vscode.ThemeIcon('note');
        treeItem.description = 'Draft';
    }

    return treeItem;
}

function createMessageTreeItem(element: Extract<TreeElement, { type: 'message' }>): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    if (element.command) {
        item.command = {
            command: element.command.command,
            title: element.command.title,
        };
    }
    return item;
}
