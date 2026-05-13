import * as vscode from 'vscode';

const SCOPES = ['project', 'repo'];

export class GitHubAuth {
    private _onDidChangeAuth = new vscode.EventEmitter<boolean>();
    readonly onDidChangeAuth = this._onDidChangeAuth.event;

    private _session: vscode.AuthenticationSession | undefined;

    async getToken(): Promise<string | null> {
        try {
            const session = await vscode.authentication.getSession('github', SCOPES, {
                createIfNone: false,
            });
            this._session = session;
            return session?.accessToken ?? null;
        } catch {
            return null;
        }
    }

    async signIn(): Promise<string | null> {
        try {
            const session = await vscode.authentication.getSession('github', SCOPES, {
                createIfNone: true,
            });
            this._session = session;
            this._onDidChangeAuth.fire(true);
            return session?.accessToken ?? null;
        } catch {
            this._onDidChangeAuth.fire(false);
            return null;
        }
    }

    get isAuthenticated(): boolean {
        return this._session !== undefined;
    }

    get username(): string | undefined {
        return this._session?.account.label;
    }

    dispose(): void {
        this._onDidChangeAuth.dispose();
    }
}
