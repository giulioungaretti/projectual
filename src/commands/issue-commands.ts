import * as vscode from 'vscode';
import { ProjectModel } from '../models/project-model';
import { IssuePanel } from '../webview/issue-panel';
import { ProjectItem, ProjectV2, IssueContent } from '../api/types';
import * as queries from '../api/queries';
import { GraphQLClient } from '../api/graphql-client';

export function registerIssueCommands(
    context: vscode.ExtensionContext,
    model: ProjectModel,
    client: GraphQLClient,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.openItem', async (projectId: string, item: ProjectItem | string) => {
            let resolvedItem: ProjectItem | undefined;

            if (typeof item === 'string') {
                // item is an itemId — find it
                resolvedItem = model.getProjectItems(projectId).find(i => i.id === item);
            } else {
                resolvedItem = item;
            }

            if (!resolvedItem) {
                vscode.window.showWarningMessage('Item not found.');
                return;
            }

            IssuePanel.createOrShow(context.extensionUri, model, projectId, resolvedItem);
        }),

        vscode.commands.registerCommand('ghProjects.createIssue', async () => {
            // Pick project
            if (model.projects.length === 0) {
                await model.loadProjects();
            }
            if (model.projects.length === 0) {
                vscode.window.showWarningMessage('No projects found.');
                return;
            }

            const projectPick = await vscode.window.showQuickPick(
                model.projects.map(p => ({
                    label: p.title,
                    description: `#${p.number}`,
                    projectId: p.id,
                })),
                { placeHolder: 'Select project to add issue to' }
            );
            if (!projectPick) { return; }

            // Get repos
            const repoData = await client.query<{
                viewer: { repositories: { nodes: { id: string; nameWithOwner: string }[] } };
            }>(queries.GET_VIEWER_REPOS, { first: 50 });

            const repoPick = await vscode.window.showQuickPick(
                repoData.viewer.repositories.nodes.map(r => ({
                    label: r.nameWithOwner,
                    repoId: r.id,
                })),
                { placeHolder: 'Select repository' }
            );
            if (!repoPick) { return; }

            const title = await vscode.window.showInputBox({
                prompt: 'Issue title',
                placeHolder: 'Enter issue title',
            });
            if (!title) { return; }

            const body = await vscode.window.showInputBox({
                prompt: 'Issue body (optional)',
                placeHolder: 'Enter issue body',
            });

            try {
                const issue = await model.createIssue(repoPick.repoId, title, body || undefined);
                // Add to project
                await model.addItemToProject(projectPick.projectId, issue.id);
                vscode.window.showInformationMessage(`Created issue #${issue.number} and added to project.`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create issue: ${err}`);
            }
        }),

        vscode.commands.registerCommand('ghProjects.createDraft', async () => {
            if (model.projects.length === 0) {
                await model.loadProjects();
            }

            const projectPick = await vscode.window.showQuickPick(
                model.projects.map(p => ({
                    label: p.title,
                    description: `#${p.number}`,
                    projectId: p.id,
                })),
                { placeHolder: 'Select project' }
            );
            if (!projectPick) { return; }

            const title = await vscode.window.showInputBox({
                prompt: 'Draft issue title',
                placeHolder: 'Enter title',
            });
            if (!title) { return; }

            const body = await vscode.window.showInputBox({
                prompt: 'Body (optional)',
                placeHolder: 'Enter body',
            });

            try {
                await model.addDraftIssue(projectPick.projectId, title, body || undefined);
                vscode.window.showInformationMessage('Draft issue created.');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create draft: ${err}`);
            }
        }),

        vscode.commands.registerCommand('ghProjects.changeStatus', async (node?: unknown) => {
            if (!node || typeof node !== 'object') { return; }
            const itemNode = node as { type: string; projectId: string; item: ProjectItem };
            if (itemNode.type !== 'item') { return; }

            const statusField = model.getStatusField(itemNode.projectId);
            if (!statusField) {
                vscode.window.showWarningMessage('No Status field found on this project.');
                return;
            }

            const currentStatus = model.getItemStatus(itemNode.item);
            const pick = await vscode.window.showQuickPick(
                statusField.options.map(o => ({
                    label: o.name,
                    description: currentStatus?.optionId === o.id ? '(current)' : '',
                    optionId: o.id,
                })),
                { placeHolder: 'Select new status' }
            );
            if (!pick) { return; }

            try {
                await model.updateItemStatus(
                    itemNode.projectId, itemNode.item.id,
                    statusField.id, pick.optionId
                );
                vscode.window.showInformationMessage(`Status changed to "${pick.label}".`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to change status: ${err}`);
            }
        }),

        vscode.commands.registerCommand('ghProjects.editIssue', async (node?: unknown) => {
            if (!node || typeof node !== 'object') { return; }
            const itemNode = node as { type: string; projectId: string; item: ProjectItem };
            if (itemNode.type !== 'item') { return; }

            IssuePanel.createOrShow(context.extensionUri, model, itemNode.projectId, itemNode.item);
        }),
    );
}
