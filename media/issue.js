(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const root = document.getElementById('issue-root');

    let currentData = { item: null, projectFields: [], statusField: null };
    let editMode = false;

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'update-issue') {
            currentData = msg;
            render();
        }
    });

    function render() {
        const { item, projectFields, statusField } = currentData;
        if (!item || !item.content) {
            root.innerHTML = '<div class="loading">No issue data.</div>';
            return;
        }

        const content = item.content;
        const isIssue = content.__typename === 'Issue';
        const isDraft = content.__typename === 'DraftIssue';

        let html = '<div class="issue-container">';

        // Header
        html += '<div class="issue-header">';
        html += '<div class="issue-title-row">';
        if (editMode && (isIssue || isDraft)) {
            html += `<input class="issue-title-input" id="title-input" value="${escapeAttr(content.title)}">`;
        } else {
            html += `<span class="issue-title">${escapeHtml(content.title)}</span>`;
        }
        if (isIssue) {
            html += `<span class="issue-number">#${content.number}</span>`;
        }
        html += '</div>';

        if (isIssue) {
            html += '<div class="issue-meta">';
            html += `<span class="state-badge ${content.state === 'OPEN' ? 'open' : 'closed'}">${content.state}</span>`;
            html += `<span>${escapeHtml(content.repository?.nameWithOwner || '')}</span>`;
            html += '</div>';
        }
        html += '</div>';

        // Actions
        html += '<div class="issue-actions">';
        if (editMode) {
            html += '<button onclick="handleSave()">Save</button>';
            html += '<button class="secondary" onclick="handleCancel()">Cancel</button>';
        } else {
            if (isIssue || isDraft) {
                html += '<button onclick="handleEdit()">Edit</button>';
            }
            if (isIssue) {
                html += '<button class="secondary" onclick="handleOpenInGitHub()">Open in GitHub</button>';
            }
        }
        html += '</div>';

        // Sidebar fields
        html += '<div class="issue-sidebar">';

        // Status
        if (statusField) {
            const statusFv = (item.fieldValues?.nodes || []).find(
                fv => fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.field?.name === 'Status'
            );
            html += '<div class="field-group">';
            html += '<span class="field-label">Status</span>';
            html += '<div class="field-value">';
            html += `<select onchange="handleStatusChange(this.value)">`;
            (statusField.options || []).forEach(opt => {
                const selected = statusFv && statusFv.optionId === opt.id ? ' selected' : '';
                html += `<option value="${escapeAttr(opt.id)}"${selected}>${escapeHtml(opt.name)}</option>`;
            });
            html += '</select></div></div>';
        }

        // Assignees
        if (isIssue && content.assignees?.nodes) {
            html += '<div class="field-group">';
            html += '<span class="field-label">Assignees</span>';
            html += '<div class="field-value"><div class="assignees-list">';
            if (content.assignees.nodes.length === 0) {
                html += '<span style="color:var(--vscode-descriptionForeground)">None</span>';
            } else {
                content.assignees.nodes.forEach(a => {
                    html += `<span class="assignee-tag">`;
                    if (a.avatarUrl) {
                        html += `<img class="assignee-avatar" src="${escapeAttr(a.avatarUrl)}&s=40">`;
                    }
                    html += `@${escapeHtml(a.login)}</span>`;
                });
            }
            html += '</div></div></div>';
        }

        // Labels
        if (isIssue && content.labels?.nodes) {
            html += '<div class="field-group">';
            html += '<span class="field-label">Labels</span>';
            html += '<div class="field-value"><div class="labels-list">';
            if (content.labels.nodes.length === 0) {
                html += '<span style="color:var(--vscode-descriptionForeground)">None</span>';
            } else {
                content.labels.nodes.forEach(l => {
                    html += `<span class="label-badge" style="background:#${l.color};color:${getContrastColor(l.color)}">${escapeHtml(l.name)}</span>`;
                });
            }
            html += '</div></div></div>';
        }

        // Custom project fields
        const customFields = (item.fieldValues?.nodes || []).filter(
            fv => fv.field?.name !== 'Status' && fv.field?.name !== 'Title'
        );
        customFields.forEach(fv => {
            html += '<div class="field-group">';
            html += `<span class="field-label">${escapeHtml(fv.field?.name || 'Field')}</span>`;
            html += '<div class="field-value">';
            html += formatFieldValue(fv);
            html += '</div></div>';
        });

        html += '</div>';

        // Body
        if (isIssue || isDraft) {
            html += '<h3 style="margin-bottom:8px;">Description</h3>';
            if (editMode) {
                html += `<textarea class="issue-body-edit" id="body-input">${escapeHtml(content.body || '')}</textarea>`;
            } else {
                html += `<div class="issue-body">${escapeHtml(content.body || 'No description.')}</div>`;
            }
        }

        html += '</div>';
        root.innerHTML = html;
    }

    function formatFieldValue(fv) {
        switch (fv.__typename) {
            case 'ProjectV2ItemFieldTextValue':
                return escapeHtml(fv.text || '');
            case 'ProjectV2ItemFieldNumberValue':
                return String(fv.number ?? '');
            case 'ProjectV2ItemFieldDateValue':
                return escapeHtml(fv.date || '');
            case 'ProjectV2ItemFieldSingleSelectValue':
                return escapeHtml(fv.name || '');
            case 'ProjectV2ItemFieldIterationValue':
                return escapeHtml(fv.title || '');
            default:
                return '';
        }
    }

    // Globals
    window.handleEdit = function () {
        editMode = true;
        render();
    };

    window.handleCancel = function () {
        editMode = false;
        render();
    };

    window.handleSave = function () {
        const content = currentData.item?.content;
        if (!content) return;

        const titleInput = document.getElementById('title-input');
        const bodyInput = document.getElementById('body-input');

        const msg = { type: 'save-issue' };
        if (content.__typename === 'Issue') {
            msg.issueId = content.id;
        }
        if (titleInput) msg.title = titleInput.value;
        if (bodyInput) msg.body = bodyInput.value;

        vscode.postMessage(msg);
        editMode = false;
    };

    window.handleStatusChange = function (optionId) {
        const { item, statusField } = currentData;
        if (!item || !statusField) return;
        vscode.postMessage({
            type: 'update-field',
            itemId: item.id,
            fieldId: statusField.id,
            value: { singleSelectOptionId: optionId },
        });
    };

    window.handleOpenInGitHub = function () {
        vscode.postMessage({ type: 'open-in-github' });
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        return escapeHtml(str);
    }

    function getContrastColor(hexColor) {
        if (!hexColor) return '#000';
        const r = parseInt(hexColor.substr(0, 2), 16);
        const g = parseInt(hexColor.substr(2, 2), 16);
        const b = parseInt(hexColor.substr(4, 2), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }
})();
