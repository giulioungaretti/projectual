import { graphql } from '@octokit/graphql';
import * as vscode from 'vscode';
import { GitHubAuth } from '../auth/github-auth';

export class GraphQLClient {
    constructor(private auth: GitHubAuth) {}

    async query<T>(queryStr: string, variables?: Record<string, unknown>): Promise<T> {
        const token = await this.auth.getToken();
        if (!token) {
            const signedIn = await this.auth.signIn();
            if (!signedIn) {
                throw new Error('GitHub authentication required. Please sign in.');
            }
        }

        const finalToken = await this.auth.getToken();
        if (!finalToken) {
            throw new Error('Failed to obtain GitHub token.');
        }

        try {
            const gql = graphql.defaults({
                headers: { authorization: `token ${finalToken}` },
            });
            return await gql<T>(queryStr, variables ?? {});
        } catch (err: unknown) {
            this.handleError(err);
            throw err;
        }
    }

    private handleError(err: unknown): void {
        if (err instanceof Error) {
            const msg = err.message;
            if (msg.includes('401') || msg.includes('Bad credentials')) {
                vscode.window.showErrorMessage(
                    'GitHub authentication failed. Please sign in again.',
                    'Sign In'
                ).then(choice => {
                    if (choice === 'Sign In') {
                        this.auth.signIn();
                    }
                });
            } else if (msg.includes('rate limit') || msg.includes('403')) {
                vscode.window.showWarningMessage(
                    'GitHub API rate limit reached. Please wait a moment and try again.'
                );
            } else if (msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
                vscode.window.showErrorMessage(
                    'Unable to reach GitHub. Please check your internet connection.'
                );
            } else {
                vscode.window.showErrorMessage(`GitHub API error: ${msg}`);
            }
        }
    }
}
