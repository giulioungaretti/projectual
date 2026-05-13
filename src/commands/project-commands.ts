import * as vscode from 'vscode';
import { ProjectModel } from '../models/project-model';
import { ProjectTreeProvider } from '../tree/project-tree-provider';
import { BoardPanel } from '../webview/board-panel';
import { ProjectV2 } from '../api/types';
import { GitHubAuth } from '../auth/github-auth';

export function registerProjectCommands(
    context: vscode.ExtensionContext,
    model: ProjectModel,
    auth: GitHubAuth,
    treeProvider: ProjectTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('ghProjects.signIn', async () => {
            const token = await auth.signIn();
            if (token) {
                vscode.window.showInformationMessage('Signed in to GitHub.');
                await model.loadProjects();
            }
        }),

        vscode.commands.registerCommand('ghProjects.refresh', async () => {
            await model.loadProjects();
            // Reload details for any open projects
            for (const p of model.projects) {
                const detail = model.getProjectDetail(p.id);
                if (detail) {
                    await model.loadProjectDetail(p.id);
                    await model.loadProjectItems(p.id);
                }
            }
            treeProvider.refresh();
            vscode.window.showInformationMessage('Projects refreshed.');
        }),

        vscode.commands.registerCommand('ghProjects.openBoard', async (projectNodeOrId?: unknown) => {
            let projectId: string;

            if (typeof projectNodeOrId === 'object' && projectNodeOrId !== null && 'type' in projectNodeOrId) {
                const node = projectNodeOrId as { type: string; project: ProjectV2 };
                projectId = node.project.id;
            } else {
                // QuickPick to select project
                const projects = model.projects;
                if (projects.length === 0) {
                    await model.loadProjects();
                }
                if (model.projects.length === 0) {
                    vscode.window.showWarningMessage('No projects found.');
                    return;
                }

                const pick = await vscode.window.showQuickPick(
                    model.projects.map(p => ({
                        label: p.title,
                        description: `#${p.number}`,
                        projectId: p.id,
                    })),
                    { placeHolder: 'Select a project' }
                );
                if (!pick) { return; }
                projectId = pick.projectId;
            }

            // Ensure data is loaded
            if (!model.getProjectDetail(projectId)) {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Loading project...' },
                    async () => {
                        await model.loadProjectDetail(projectId);
                        await model.loadProjectItems(projectId);
                    }
                );
            }

            BoardPanel.createOrShow(context.extensionUri, model, projectId);
        }),

        vscode.commands.registerCommand('ghProjects.openInGitHub', (urlOrNode?: unknown) => {
            let url: string | undefined;
            if (typeof urlOrNode === 'string') {
                url = urlOrNode;
            } else if (typeof urlOrNode === 'object' && urlOrNode !== null) {
                const node = urlOrNode as Record<string, unknown>;
                if (node.type === 'project') {
                    url = (node as { project: ProjectV2 }).project.url;
                } else if (node.type === 'item') {
                    const item = (node as { item: { content?: { url?: string } } }).item;
                    url = item.content?.url;
                }
            }
            if (url) {
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),

        vscode.commands.registerCommand('ghProjects.focusProject', async (nodeOrUndef?: unknown) => {
            let projectId: string | undefined;

            if (typeof nodeOrUndef === 'object' && nodeOrUndef !== null && 'type' in nodeOrUndef) {
                const node = nodeOrUndef as { type: string; project?: ProjectV2 };
                if (node.type === 'project' && node.project) {
                    projectId = node.project.id;
                }
            }

            if (!projectId) {
                // QuickPick fallback
                if (model.projects.length === 0) { await model.loadProjects(); }
                const pick = await vscode.window.showQuickPick(
                    model.projects.map(p => ({
                        label: p.title,
                        description: `#${p.number}`,
                        projectId: p.id,
                    })),
                    { placeHolder: 'Select project to focus' }
                );
                if (!pick) { return; }
                projectId = pick.projectId;
            }

            treeProvider.focusProject(projectId);
        }),

        vscode.commands.registerCommand('ghProjects.clearFocus', () => {
            treeProvider.clearFocus();
        }),
    );
}
