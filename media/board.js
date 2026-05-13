(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const root = document.getElementById('board-root');

    let currentData = { project: null, items: [], statusField: null, allLabels: [], swimlaneFields: [] };
    let swimlaneMode = 'none'; // 'none' | 'label' | 'assignee' | 'parent' | field id
    let activeLabels = new Set(); // selected labels for filtering (empty = show all)
    let collapsedLanes = new Set(); // collapsed swimlane IDs

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'update-board') {
            currentData = msg;
            render();
        }
    });

    // Event delegation
    root.addEventListener('click', function (e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        // Prevent card open-item from firing when clicking nested actions
        e.stopPropagation();

        switch (target.dataset.action) {
            case 'refresh':
                vscode.postMessage({ type: 'refresh' });
                break;
            case 'open-item':
                if (target.dataset.itemId) {
                    vscode.postMessage({ type: 'open-item', itemId: target.dataset.itemId });
                }
                break;
            case 'toggle-label': {
                const label = target.dataset.label;
                if (activeLabels.has(label)) {
                    activeLabels.delete(label);
                } else {
                    activeLabels.add(label);
                }
                render();
                break;
            }
            case 'clear-labels':
                activeLabels.clear();
                render();
                break;
            case 'toggle-lane': {
                const laneId = target.dataset.laneId;
                if (collapsedLanes.has(laneId)) {
                    collapsedLanes.delete(laneId);
                } else {
                    collapsedLanes.add(laneId);
                }
                render();
                break;
            }
        }
    });

    root.addEventListener('change', function (e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        if (target.dataset.action === 'swimlane-select') {
            swimlaneMode = target.value;
            collapsedLanes.clear();
            render();
        }
    });

    function render() {
        const { project, items, statusField, allLabels, swimlaneFields } = currentData;
        if (!project || !statusField) {
            root.innerHTML = '<div class="loading">No project data yet.</div>';
            return;
        }

        // Filter items by selected labels
        let filteredItems = items || [];
        if (activeLabels.size > 0) {
            filteredItems = filteredItems.filter(item => {
                const labels = item.content?.labels?.nodes || [];
                return labels.some(l => activeLabels.has(l.name));
            });
        }

        const options = statusField.options || [];

        // Build toolbar
        let html = renderToolbar(project, allLabels || [], swimlaneFields || []);

        // Render board based on swimlane mode
        if (swimlaneMode === 'none') {
            html += renderFlatBoard(filteredItems, options);
        } else {
            html += renderSwimlanedBoard(filteredItems, options);
        }

        root.innerHTML = html;
        setupDragAndDrop();
    }

    function renderToolbar(project, allLabels, swimlaneFields) {
        let html = '<div class="board-toolbar">';
        html += `<h2>${escapeHtml(project.title)}</h2>`;

        // Swimlane dropdown
        html += '<div class="toolbar-group">';
        html += '<label class="toolbar-label">Swimlanes:</label>';
        html += '<select data-action="swimlane-select" class="toolbar-select">';
        html += `<option value="none"${swimlaneMode === 'none' ? ' selected' : ''}>None</option>`;
        html += `<option value="parent"${swimlaneMode === 'parent' ? ' selected' : ''}>Parent Issue</option>`;
        html += `<option value="label"${swimlaneMode === 'label' ? ' selected' : ''}>Label</option>`;
        html += `<option value="assignee"${swimlaneMode === 'assignee' ? ' selected' : ''}>Assignee</option>`;
        (swimlaneFields || []).forEach(f => {
            html += `<option value="${escapeHtml(f.id)}"${swimlaneMode === f.id ? ' selected' : ''}>${escapeHtml(f.name)}</option>`;
        });
        html += '</select></div>';

        // Label filter chips
        if (allLabels && allLabels.length > 0) {
            html += '<div class="toolbar-group label-filters">';
            html += '<label class="toolbar-label">Labels:</label>';
            allLabels.forEach(l => {
                const isActive = activeLabels.has(l.name);
                html += `<span class="filter-chip${isActive ? ' active' : ''}" `
                    + `data-action="toggle-label" data-label="${escapeHtml(l.name)}" `
                    + `style="--chip-bg:#${l.color};--chip-fg:${getContrastColor(l.color)}">`
                    + `${escapeHtml(l.name)}</span>`;
            });
            if (activeLabels.size > 0) {
                html += '<span class="filter-chip clear-chip" data-action="clear-labels">✕ Clear</span>';
            }
            html += '</div>';
        }

        html += '<button data-action="refresh">↻ Refresh</button>';
        html += '</div>';
        return html;
    }

    function renderFlatBoard(items, statusOptions) {
        const grouped = {};
        const noStatus = [];
        statusOptions.forEach(opt => { grouped[opt.id] = []; });

        items.forEach(item => {
            const statusFv = getStatusFieldValue(item);
            if (statusFv && grouped[statusFv.optionId]) {
                grouped[statusFv.optionId].push(item);
            } else {
                noStatus.push(item);
            }
        });

        let html = '<div class="board">';
        for (const opt of statusOptions) {
            html += renderColumn(opt.name, opt.id, grouped[opt.id] || []);
        }
        if (noStatus.length > 0) {
            html += renderColumn('No Status', '__none__', noStatus);
        }
        html += '</div>';
        return html;
    }

    function renderSwimlanedBoard(items, statusOptions) {
        const lanes = new Map();
        const noLaneItems = [];

        items.forEach(item => {
            const laneKeys = getSwimlaneKeys(item);
            if (laneKeys.length === 0) {
                noLaneItems.push(item);
            } else {
                laneKeys.forEach(key => {
                    if (!lanes.has(key.id)) {
                        lanes.set(key.id, {
                            label: key.label,
                            color: key.color,
                            number: key.number || null,
                            subTotal: key.subTotal || 0,
                            subCompleted: key.subCompleted || 0,
                            items: [],
                        });
                    }
                    lanes.get(key.id).items.push(item);
                });
            }
        });

        let html = '<div class="board-swimlaned">';

        // Header row
        html += '<div class="swimlane-header">';
        html += '<div class="swimlane-label-cell"></div>';
        statusOptions.forEach(opt => {
            html += `<div class="swimlane-col-header">${escapeHtml(opt.name)}</div>`;
        });
        html += '</div>';

        for (const [laneId, lane] of lanes) {
            html += renderSwimlaneRow(laneId, lane, statusOptions);
        }
        if (noLaneItems.length > 0) {
            const noLabel = swimlaneMode === 'label' ? 'No Label'
                : swimlaneMode === 'assignee' ? 'Unassigned'
                : swimlaneMode === 'parent' ? 'No Parent'
                : 'None';
            html += renderSwimlaneRow('__no_lane__', {
                label: noLabel, color: null, number: null,
                subTotal: 0, subCompleted: 0, items: noLaneItems
            }, statusOptions);
        }

        html += '</div>';
        return html;
    }

    function renderSwimlaneRow(laneId, lane, statusOptions) {
        const isCollapsed = collapsedLanes.has(laneId);
        const grouped = {};
        statusOptions.forEach(opt => { grouped[opt.id] = []; });
        lane.items.forEach(item => {
            const statusFv = getStatusFieldValue(item);
            if (statusFv && grouped[statusFv.optionId]) {
                grouped[statusFv.optionId].push(item);
            }
        });

        let html = `<div class="swimlane-row${isCollapsed ? ' collapsed' : ''}">`;

        // Lane header with toggle
        html += `<div class="swimlane-label-cell" data-action="toggle-lane" data-lane-id="${escapeHtml(laneId)}">`;
        html += `<span class="lane-toggle">${isCollapsed ? '▶' : '▼'}</span> `;
        if (lane.color) {
            html += `<span class="swimlane-badge" style="background:#${lane.color};color:${getContrastColor(lane.color)}">${escapeHtml(lane.label)}</span>`;
        } else {
            html += `<span class="swimlane-badge muted">${escapeHtml(lane.label)}</span>`;
        }
        if (lane.number) {
            html += `<span class="lane-number">#${lane.number}</span>`;
        }
        html += `<span class="lane-count">${lane.items.length}</span>`;
        if (lane.subTotal > 0) {
            const pct = lane.subTotal > 0 ? Math.round((lane.subCompleted / lane.subTotal) * 100) : 0;
            html += `<div class="lane-progress"><div class="lane-progress-bar" style="width:${pct}%"></div></div>`;
            html += `<span class="lane-progress-text">${lane.subCompleted}/${lane.subTotal}</span>`;
        }
        html += '</div>';

        if (!isCollapsed) {
            statusOptions.forEach(opt => {
                const colItems = grouped[opt.id] || [];
                html += '<div class="swimlane-cell">';
                html += `<div class="column-body" data-status-id="${escapeHtml(opt.id)}">`;
                if (colItems.length === 0) {
                    html += '<div class="empty-cell"></div>';
                } else {
                    colItems.forEach(item => { html += renderCard(item); });
                }
                html += '</div></div>';
            });
        } else {
            // Collapsed: empty cells
            statusOptions.forEach(() => {
                html += '<div class="swimlane-cell collapsed-cell"></div>';
            });
        }

        html += '</div>';
        return html;
    }

    function getSwimlaneKeys(item) {
        const content = item.content;
        if (!content) return [];

        if (swimlaneMode === 'parent') {
            // Group by parent issue
            if (content.__typename === 'Issue' && content.parent) {
                // Find the parent item in the current data to get its title
                const parentItem = (currentData.items || []).find(i =>
                    i.content && i.content.id === content.parent.id
                );
                if (parentItem && parentItem.content) {
                    const pc = parentItem.content;
                    return [{
                        id: pc.id,
                        label: pc.title,
                        color: null,
                        number: pc.number || null,
                        subTotal: pc.subIssuesSummary?.total || 0,
                        subCompleted: pc.subIssuesSummary?.completed || 0,
                    }];
                }
                return [{ id: content.parent.id, label: 'Parent', color: null }];
            }
            return [];
        }
        if (swimlaneMode === 'label') {
            const labels = content.labels?.nodes || [];
            return labels.map(l => ({ id: l.name, label: l.name, color: l.color }));
        }
        if (swimlaneMode === 'assignee') {
            const assignees = content.assignees?.nodes || [];
            return assignees.map(a => ({ id: a.login, label: a.login, color: null }));
        }
        // Custom single-select field
        const fv = (item.fieldValues?.nodes || []).find(
            fv => fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.field?.id === swimlaneMode
        );
        if (fv) {
            return [{ id: fv.optionId || fv.name, label: fv.name, color: null }];
        }
        return [];
    }

    function getStatusFieldValue(item) {
        return (item.fieldValues?.nodes || []).find(
            fv => fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' && fv.field?.name === 'Status'
        );
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
