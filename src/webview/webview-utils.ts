import * as vscode from 'vscode';

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    cssFile: string,
    jsFile: string,
    bodyContent: string
): string {
    const cssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', cssFile)
    );
    const jsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', jsFile)
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
    <link href="${cssUri}" rel="stylesheet">
    <title>GitHub Projects</title>
</head>
<body>
    ${bodyContent}
    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

// Message types for extension ↔ webview communication
export interface WebviewMessage {
    type: string;
    [key: string]: unknown;
}

export interface BoardUpdateMessage extends WebviewMessage {
    type: 'update-board';
    project: unknown;
    items: unknown[];
    statusField: unknown;
}

export interface MoveItemMessage extends WebviewMessage {
    type: 'move-item';
    itemId: string;
    newStatusOptionId: string;
}

export interface OpenItemMessage extends WebviewMessage {
    type: 'open-item';
    projectId: string;
    itemId: string;
}

export interface IssueUpdateMessage extends WebviewMessage {
    type: 'update-issue';
    issue: unknown;
    projectFields: unknown[];
    fieldValues: unknown[];
}

export interface SaveIssueMessage extends WebviewMessage {
    type: 'save-issue';
    issueId: string;
    title?: string;
    body?: string;
}

export interface UpdateFieldMessage extends WebviewMessage {
    type: 'update-field';
    projectId: string;
    itemId: string;
    fieldId: string;
    value: Record<string, unknown>;
}
