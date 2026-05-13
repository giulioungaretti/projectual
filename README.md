# GitHub Projects v2 for VS Code

View and manage GitHub Projects v2 boards, issues, and fields directly in VS Code.

## Features

- **TreeView Sidebar** — Browse your GitHub Projects, grouped by status columns
- **Kanban Board** — Full board view with drag-and-drop to change issue status
- **Issue Detail Panel** — View and edit issue title, body, status, and custom fields
- **Quick Actions** — Change status, assignees, and labels from context menus
- **Create Issues & Drafts** — Create new issues or draft issues without leaving VS Code
- **Open in GitHub** — Quick link to open any item in your browser

## Getting Started

1. Install the extension
2. Click the **GitHub Projects** icon in the Activity Bar (sidebar)
3. Sign in to GitHub when prompted (uses VS Code's built-in GitHub auth)
4. Your projects will appear in the sidebar

## Commands

| Command | Description |
|---------|-------------|
| `GitHub Projects: Sign In to GitHub` | Authenticate with GitHub |
| `GitHub Projects: Refresh` | Refresh all project data |
| `GitHub Projects: Open Project Board` | Open a Kanban board for a project |
| `GitHub Projects: Create Issue` | Create a new issue and add to a project |
| `GitHub Projects: Create Draft Issue` | Create a draft issue in a project |
| `GitHub Projects: Change Status` | Change an item's status |
| `GitHub Projects: Change Assignees` | Modify issue assignees |
| `GitHub Projects: Change Labels` | Modify issue labels |
| `GitHub Projects: Edit Issue` | Open issue detail panel for editing |
| `GitHub Projects: Open in GitHub` | Open item in browser |

## Required GitHub Permissions

The extension requests these OAuth scopes:

- `project` — Read and write GitHub Projects v2
- `repo` — Access issue details, labels, assignees

## Development

```bash
# Install dependencies
npm install

# Compile (with sourcemaps)
npm run compile

# Watch mode
npm run watch

# Build (minified)
npm run build

# Type check
npm run lint

# Package as .vsix
npm run package
```

### Running in VS Code

1. Open this folder in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension will activate in the new window

## Architecture

```
src/
├── extension.ts              # Entry point, wiring
├── auth/github-auth.ts       # GitHub OAuth via VS Code auth API
├── api/
│   ├── graphql-client.ts     # Authenticated GraphQL client
│   ├── queries.ts            # GraphQL queries
│   ├── mutations.ts          # GraphQL mutations
│   └── types.ts              # TypeScript interfaces
├── tree/
│   ├── project-tree-provider.ts  # TreeView data provider
│   ├── tree-items.ts         # TreeItem rendering
│   └── tree-types.ts         # Tree node types
├── webview/
│   ├── board-panel.ts        # Kanban board WebviewPanel
│   ├── issue-panel.ts        # Issue detail WebviewPanel
│   └── webview-utils.ts      # HTML, CSP, messaging helpers
├── commands/
│   ├── project-commands.ts   # Project-level commands
│   ├── issue-commands.ts     # Issue CRUD commands
│   └── field-commands.ts     # Field editing commands
└── models/
    └── project-model.ts      # Data cache with optimistic updates
```

## License

MIT
