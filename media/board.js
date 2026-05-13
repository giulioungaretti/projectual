(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const root = document.getElementById('board-root');

    let currentData = { project: null, items: [], statusField: null };

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'update-board') {
            currentData = msg;
            render();
        }
    });

    // Event delegation — handles all clicks via data attributes
    root.addEventListener('click', function (e) {
        const actionTarget = e.target.closest('[data-action]');
        if (actionTarget) {
            switch (actionTarget.dataset.action) {
                case 'refresh':
                    vscode.postMessage({ type: 'refresh' });
                    return;
                case 'open-item': {
                    const itemId = actionTarget.dataset.itemId;
                    if (itemId) {
                        vscode.postMessage({ type: 'open-item', itemId });
                    }
                    return;
                }
            }
        }
    });

    function render() {
        const { project, items, statusField } = currentData;
        if (!project || !statusField) {
            root.innerHTML = '<div class="loading">No project data yet.</div>';
            return;
        }

        const options = statusField.options || [];
        const grouped = {};
        const noStatus = [];

        options.forEach(opt => { grouped[opt.id] = []; });

        (items || []).forEach(item => {
            const statusFv = (item.fieldValues?.nodes || []).find(
                fv => fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.field?.name === 'Status'
            );
            if (statusFv && grouped[statusFv.optionId]) {
                grouped[statusFv.optionId].push(item);
            } else {
                noStatus.push(item);
            }
        });

        let html = `
            <div class="board-toolbar">
                <h2>${escapeHtml(project.title)}</h2>
                <button data-action="refresh">↻ Refresh</button>
            </div>
            <div class="board">
        `;

        for (const opt of options) {
            const colItems = grouped[opt.id] || [];
            html += renderColumn(opt.name, opt.id, colItems);
        }

        if (noStatus.length > 0) {
            html += renderColumn('No Status', '__none__', noStatus);
        }

        html += '</div>';
        root.innerHTML = html;

        // Set up drag listeners after render
        setupDragAndDrop();
    }

    function renderColumn(name, optionId, items) {
        let cardsHtml = '';
        if (items.length === 0) {
            cardsHtml = '<div class="empty-column">No items</div>';
        } else {
            cardsHtml = items.map(item => renderCard(item)).join('');
        }

        return `
            <div class="column" data-status-id="${escapeHtml(optionId)}">
                <div class="column-header">
                    <span>${escapeHtml(name)}</span>
                    <span class="count">${items.length}</span>
                </div>
                <div class="column-body" data-status-id="${escapeHtml(optionId)}">
                    ${cardsHtml}
                </div>
            </div>
        `;
    }

    function renderCard(item) {
        const content = item.content;
        if (!content) return '';

        const title = content.title || '(Untitled)';
        let metaHtml = '';
        let labelsHtml = '';
        let assigneesHtml = '';

        if (content.__typename === 'Issue' || content.__typename === 'PullRequest') {
            const repo = content.repository?.nameWithOwner || '';
            const num = content.number || '';
            metaHtml = `
                <span class="card-repo">${escapeHtml(repo)}</span>
                <span class="card-number">#${num}</span>
            `;

            if (content.labels?.nodes?.length) {
                labelsHtml = '<div class="card-labels">' +
                    content.labels.nodes.map(l =>
                        `<span class="label-badge" style="background:#${l.color}; color:${getContrastColor(l.color)}">${escapeHtml(l.name)}</span>`
                    ).join('') +
                    '</div>';
            }

            if (content.assignees?.nodes?.length) {
                assigneesHtml = '<div class="card-assignees">' +
                    content.assignees.nodes.map(a =>
                        a.avatarUrl
                            ? `<img class="assignee-avatar" src="${escapeHtml(a.avatarUrl)}&s=40" title="${escapeHtml(a.login)}">`
                            : `<span class="assignee-text" title="${escapeHtml(a.login)}">@${escapeHtml(a.login)}</span>`
                    ).join('') +
                    '</div>';
            }
        } else if (content.__typename === 'DraftIssue') {
            metaHtml = '<span class="card-repo">Draft</span>';
        }

        return `
            <div class="card" draggable="true" data-item-id="${escapeHtml(item.id)}"
                 data-action="open-item">
                <div class="card-title">${escapeHtml(title)}</div>
                <div class="card-meta">${metaHtml}</div>
                ${labelsHtml}
                ${assigneesHtml}
            </div>
        `;
    }

    function setupDragAndDrop() {
        const cards = document.querySelectorAll('.card');
        const columns = document.querySelectorAll('.column-body');

        cards.forEach(card => {
            card.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', card.dataset.itemId);
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                columns.forEach(col => col.classList.remove('drag-over'));
            });
        });

        columns.forEach(col => {
            col.addEventListener('dragover', e => {
                e.preventDefault();
                col.classList.add('drag-over');
            });
            col.addEventListener('dragleave', () => {
                col.classList.remove('drag-over');
            });
            col.addEventListener('drop', e => {
                e.preventDefault();
                col.classList.remove('drag-over');
                const itemId = e.dataTransfer.getData('text/plain');
                const newStatusId = col.dataset.statusId;
                if (itemId && newStatusId && newStatusId !== '__none__') {
                    vscode.postMessage({
                        type: 'move-item',
                        itemId,
                        newStatusOptionId: newStatusId,
                    });
                }
            });
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getContrastColor(hexColor) {
        if (!hexColor) return '#000';
        const r = parseInt(hexColor.substr(0, 2), 16);
        const g = parseInt(hexColor.substr(2, 2), 16);
        const b = parseInt(hexColor.substr(4, 2), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    // Signal to extension that we're ready to receive data
    vscode.postMessage({ type: 'ready' });
})();
