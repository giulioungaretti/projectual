import * as vscode from 'vscode';
import { ProjectModel } from '../models/project-model';
import { ProjectItem, IssueContent, ProjectSingleSelectField, ProjectIterationField } from '../api/types';
import { GraphQLClient } from '../api/graphql-client';
import { IssueDocumentProvider, ISSUE_SCHEME } from '../webview/issue-document-provider';
import * as queries from '../api/queries';

export function registerFieldCommands(
    context: vscode.ExtensionContext,
    model: ProjectModel,
    client: GraphQLClient,
    docProvider: IssueDocumentProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.changeAssignees', async (node?: unknown) => {
            if (!node || typeof node !== 'object') { return; }
            const itemNode = node as { type: string; projectId: string; item: ProjectItem };
            if (itemNode.type !== 'item') { return; }

            const content = itemNode.item.content;
            if (!content || content.__typename !== 'Issue') {
                vscode.window.showWarningMessage('Can only change assignees on issues.');
                return;
            }

            const issue = content as IssueContent;

            // Fetch assignable users from the repo
            let assignableUsers: { login: string; id?: string }[] = [];
            try {
                const data = await client.query<{
                    node: { assignees: { nodes: { login: string }[] }; repository: { assignableUsers: { nodes: { id: string; login: string }[] } } };
                }>(queries.GET_ISSUE_DETAIL, { id: issue.id });
                assignableUsers = data.node.repository?.assignableUsers?.nodes ?? [];
            } catch {
                // Fallback: just show current assignees
            }

            const currentLogins = new Set(issue.assignees.nodes.map(a => a.login));

            const picks = await vscode.window.showQuickPick(
                assignableUsers.map(u => ({
                    label: u.login,
                    picked: currentLogins.has(u.login),
                    userId: u.id,
                })),
                { canPickMany: true, placeHolder: 'Select assignees' }
            );
            if (!picks) { return; }

            const pickedLogins = new Set(picks.map(p => p.label));
            const toAdd = picks.filter(p => !currentLogins.has(p.label)).map(p => p.userId).filter(Boolean) as string[];
            const toRemove = [...currentLogins].filter(l => !pickedLogins.has(l));

            try {
                if (toAdd.length > 0) {
                    await model.addAssignees(issue.id, toAdd);
                }
                if (toRemove.length > 0) {
                    // Would need user IDs for removal — simplified for now
                    vscode.window.showInformationMessage(
                        `Added ${toAdd.length} assignees. Removing assignees requires user IDs (use GitHub web UI for removal).`
                    );
                    return;
                }
                vscode.window.showInformationMessage('Assignees updated.');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to update assignees: ${err}`);
            }
        }),

        vscode.commands.registerCommand('ghProjects.changeLabels', async (node?: unknown) => {
            if (!node || typeof node !== 'object') { return; }
            const itemNode = node as { type: string; projectId: string; item: ProjectItem };
            if (itemNode.type !== 'item') { return; }

            const content = itemNode.item.content;
            if (!content || content.__typename !== 'Issue') {
                vscode.window.showWarningMessage('Can only change labels on issues.');
                return;
            }

            const issue = content as IssueContent;

            // Fetch repo labels
            let repoLabels: { id: string; name: string; color: string }[] = [];
            try {
                const data = await client.query<{
                    node: { repository: { labels: { nodes: { id: string; name: string; color: string }[] } } };
                }>(queries.GET_ISSUE_DETAIL, { id: issue.id });
                repoLabels = data.node.repository?.labels?.nodes ?? [];
            } catch {
                // Fallback
            }

            const currentLabels = new Set(issue.labels.nodes.map(l => l.name));

            const picks = await vscode.window.showQuickPick(
                repoLabels.map(l => ({
                    label: l.name,
                    description: `#${l.color}`,
                    picked: currentLabels.has(l.name),
                    labelId: l.id,
                })),
                { canPickMany: true, placeHolder: 'Select labels' }
            );
            if (!picks) { return; }

            const pickedNames = new Set(picks.map(p => p.label));
            const toAdd = picks.filter(p => !currentLabels.has(p.label)).map(p => p.labelId);
            const toRemove = repoLabels
                .filter(l => currentLabels.has(l.name) && !pickedNames.has(l.name))
                .map(l => l.id);

            try {
                if (toAdd.length > 0) {
                    await model.addLabels(issue.id, toAdd);
                }
                if (toRemove.length > 0) {
                    await model.removeLabels(issue.id, toRemove);
                }
                vscode.window.showInformationMessage('Labels updated.');
                // Reload to reflect changes
                await model.loadProjectItems(itemNode.projectId);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to update labels: ${err}`);
            }
        }),

        // --- Document-aware commands (triggered by CodeLens) ---

        vscode.commands.registerCommand('ghProjects.changeFieldFromDocument', async (uri: vscode.Uri, fieldName: string) => {
            const info = docProvider.getDocumentInfo(uri);
            if (!info) { return; }

            const detail = model.getProjectDetail(info.projectId);
            if (!detail) { return; }

            const field = detail.fields.nodes.find(f => f.name === fieldName);
            if (!field) { return; }

            if (field.__typename === 'ProjectV2SingleSelectField') {
                const ssField = field as ProjectSingleSelectField;
                const currentFv = info.item.fieldValues.nodes.find(
                    fv => fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.field?.name === fieldName
                );
                const currentId = currentFv?.__typename === 'ProjectV2ItemFieldSingleSelectValue' ? currentFv.optionId : undefined;

                const pick = await vscode.window.showQuickPick(
                    ssField.options.map(o => ({
                        label: o.name,
                        description: o.id === currentId ? '(current)' : '',
                        optionId: o.id,
                    })),
                    { placeHolder: `Select ${fieldName}` }
                );
                if (!pick) { return; }

                try {
                    if (fieldName === 'Status') {
                        await model.updateItemStatus(info.projectId, info.item.id, field.id, pick.optionId);
                    } else {
                        await model.updateItemField(info.projectId, info.item.id, field.id, { singleSelectOptionId: pick.optionId });
                    }
                    vscode.window.showInformationMessage(`${fieldName} changed to "${pick.label}".`);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to change ${fieldName}: ${err}`);
                }
            } else if (field.__typename === 'ProjectV2IterationField') {
                const itField = field as ProjectIterationField;
                const currentFv = info.item.fieldValues.nodes.find(
                    fv => fv.__typename === 'ProjectV2ItemFieldIterationValue' && fv.field?.name === fieldName
                );
                const currentId = currentFv?.__typename === 'ProjectV2ItemFieldIterationValue' ? currentFv.iterationId : undefined;

                const pick = await vscode.window.showQuickPick(
                    itField.configuration.iterations.map(it => ({
                        label: it.title,
                        description: it.id === currentId ? '(current)' : `starts ${it.startDate}`,
                        iterationId: it.id,
                    })),
                    { placeHolder: `Select ${fieldName}` }
                );
                if (!pick) { return; }

                try {
                    await model.updateItemField(info.projectId, info.item.id, field.id, { iterationId: pick.iterationId });
                    vscode.window.showInformationMessage(`${fieldName} changed to "${pick.label}".`);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to change ${fieldName}: ${err}`);
                }
            }
        }),

        vscode.commands.registerCommand('ghProjects.changeAssigneesFromDocument', async (uri: vscode.Uri) => {
            const info = docProvider.getDocumentInfo(uri);
            if (!info) { return; }
            // Reuse the tree-node command shape
            await vscode.commands.executeCommand('ghProjects.changeAssignees', {
                type: 'item', projectId: info.projectId, item: info.item,
            });
        }),

        vscode.commands.registerCommand('ghProjects.changeLabelsFromDocument', async (uri: vscode.Uri) => {
            const info = docProvider.getDocumentInfo(uri);
            if (!info) { return; }
            await vscode.commands.executeCommand('ghProjects.changeLabels', {
                type: 'item', projectId: info.projectId, item: info.item,
            });
        }),

        vscode.commands.registerCommand('ghProjects.openInGitHubFromDocument', async (uri: vscode.Uri) => {
            const info = docProvider.getDocumentInfo(uri);
            if (!info) { return; }
            const content = info.item.content;
            if (content && 'url' in content) {
                vscode.env.openExternal(vscode.Uri.parse((content as { url: string }).url));
            }
        }),
    );
}
