import * as vscode from 'vscode';
import { GitHubAuth } from './auth/github-auth';
import { GraphQLClient } from './api/graphql-client';
import { ProjectModel } from './models/project-model';
import { ProjectTreeProvider } from './tree/project-tree-provider';
import { registerProjectCommands } from './commands/project-commands';
import { registerIssueCommands } from './commands/issue-commands';
import { registerFieldCommands } from './commands/field-commands';
import { IssueDocumentProvider, ISSUE_SCHEME } from './webview/issue-document-provider';
import { IssueCodeLensProvider } from './providers/issue-codelens-provider';
import { IssueDiagnosticProvider } from './providers/issue-diagnostic-provider';
import { IssueFoldingProvider } from './providers/issue-folding-provider';
import { activateIssueDecorations } from './providers/issue-decoration-provider';

export function activate(context: vscode.ExtensionContext): void {
    const auth = new GitHubAuth();
    const client = new GraphQLClient(auth);
    const model = new ProjectModel(client);
    const treeProvider = new ProjectTreeProvider(model, auth);

    // Register tree view
    const treeView = vscode.window.createTreeView('ghProjects.projectList', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Register issue document provider (opens issues as markdown)
    const issueDocProvider = new IssueDocumentProvider(model);
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(ISSUE_SCHEME, issueDocProvider, {
            isReadonly: false,
        }),
        issueDocProvider,
    );

    // Register language features for issue documents
    const issueSelector = { scheme: ISSUE_SCHEME };
    const codeLensProvider = new IssueCodeLensProvider(model, issueDocProvider);
    const diagnosticProvider = new IssueDiagnosticProvider(model, issueDocProvider);
    const foldingProvider = new IssueFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(issueSelector, codeLensProvider),
        vscode.languages.registerFoldingRangeProvider(issueSelector, foldingProvider),
        diagnosticProvider,
    );
    activateIssueDecorations(context);

    // Register all commands
    registerProjectCommands(context, model, auth, treeProvider);
    registerIssueCommands(context, model, client, issueDocProvider);
    registerFieldCommands(context, model, client, issueDocProvider);

    // Set initial context values
    vscode.commands.executeCommand('setContext', 'ghProjects.groupBy', 'none');
    vscode.commands.executeCommand('setContext', 'ghProjects.hasFocusedProject', false);

    // Status bar
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 50
    );
    statusBar.text = '$(project) GitHub Projects';
    statusBar.tooltip = 'Open GitHub Projects Board';
    statusBar.command = 'ghProjects.openBoard';
    statusBar.show();
    context.subscriptions.push(statusBar);

    // Auto-load projects on activation if authenticated
    auth.getToken().then(token => {
        if (token) {
            model.loadProjects().catch(() => {
                // Silent failure on startup — user can manually refresh
            });
        }
    });

    // Cleanup
    context.subscriptions.push({
        dispose: () => {
            auth.dispose();
            model.dispose();
        },
    });
}

export function deactivate(): void {
    // Cleanup handled by disposables
}
