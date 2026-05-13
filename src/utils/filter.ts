import {
    ProjectItem, IssueContent, ProjectSingleSelectField,
    SingleSelectFieldValue,
} from '../api/types';
import { ProjectModel } from '../models/project-model';

interface FilterPredicate {
    field: string;
    value: string;
    negate: boolean;
}

export function parseFilterQuery(query: string): FilterPredicate[] {
    const predicates: FilterPredicate[] = [];
    const tokens = query.match(/(-?\w[\w.]*):("[^"]*"|\S+)/g) || [];
    for (const token of tokens) {
        const negate = token.startsWith('-');
        const clean = negate ? token.slice(1) : token;
        const colonIdx = clean.indexOf(':');
        const field = clean.slice(0, colonIdx).toLowerCase();
        let value = clean.slice(colonIdx + 1);
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        predicates.push({ field, value, negate });
    }
    return predicates;
}

export function applyFilter(
    items: ProjectItem[],
    query: string,
    model: ProjectModel,
    projectId: string,
): ProjectItem[] {
    const predicates = parseFilterQuery(query);
    if (predicates.length === 0) { return items; }

    const detail = model.getProjectDetail(projectId);
    const singleSelectFields = (detail?.fields.nodes ?? []).filter(
        (f): f is ProjectSingleSelectField => f.__typename === 'ProjectV2SingleSelectField'
    );
    const fieldNameToId = new Map<string, string>();
    for (const f of singleSelectFields) {
        fieldNameToId.set(f.name.toLowerCase(), f.id);
    }

    return items.filter(item => {
        return predicates.every(pred => {
            const result = matchPredicate(item, pred, fieldNameToId);
            return pred.negate ? !result : result;
        });
    });
}

function matchPredicate(
    item: ProjectItem,
    pred: FilterPredicate,
    fieldNameToId: Map<string, string>,
): boolean {
    const content = item.content;
    if (!content) { return false; }
    const val = pred.value.toLowerCase();

    switch (pred.field) {
        case 'label': {
            if (content.__typename !== 'Issue') { return false; }
            const labels = (content as IssueContent).labels?.nodes ?? [];
            return labels.some(l => l.name.toLowerCase() === val);
        }
        case 'assignee': {
            if (!('assignees' in content)) { return false; }
            const assignees = (content as any).assignees?.nodes ?? [];
            return assignees.some((a: { login: string }) => a.login.toLowerCase() === val.replace('@', ''));
        }
        case 'is': {
            if (val === 'open') { return 'state' in content && (content as any).state === 'OPEN'; }
            if (val === 'closed') { return 'state' in content && (content as any).state === 'CLOSED'; }
            if (val === 'draft') { return content.__typename === 'DraftIssue'; }
            if (val === 'pr') { return content.__typename === 'PullRequest'; }
            if (val === 'issue') { return content.__typename === 'Issue'; }
            if (val === 'blocked') {
                if (content.__typename !== 'Issue') { return false; }
                return ((content as IssueContent).blockedBy?.nodes ?? []).some(b => b.state === 'OPEN');
            }
            if (val === 'blocking') {
                if (content.__typename !== 'Issue') { return false; }
                return ((content as IssueContent).blocking?.nodes ?? []).some(b => b.state === 'OPEN');
            }
            return false;
        }
        case 'milestone': {
            if (content.__typename === 'Issue' && (content as IssueContent).milestone?.title?.toLowerCase() === val) {
                return true;
            }
            const msFv = item.fieldValues?.nodes?.find(
                (fv: any) => fv.__typename === 'ProjectV2ItemFieldMilestoneValue'
            ) as any;
            return msFv?.milestone?.title?.toLowerCase() === val;
        }
        case 'repo':
        case 'repository': {
            if (!('repository' in content)) { return false; }
            const repo = (content as any).repository;
            return repo?.nameWithOwner?.toLowerCase() === val || repo?.name?.toLowerCase() === val;
        }
        case 'no': {
            if (content.__typename !== 'Issue') { return false; }
            const issue = content as IssueContent;
            if (val === 'label') { return !(issue.labels?.nodes?.length); }
            if (val === 'assignee') { return !(issue.assignees?.nodes?.length); }
            if (val === 'milestone') { return !issue.milestone; }
            return false;
        }
        default: {
            const fieldId = fieldNameToId.get(pred.field);
            if (fieldId) {
                const fv = item.fieldValues?.nodes?.find(
                    (fv): fv is SingleSelectFieldValue =>
                        fv.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
                        fv.field?.id === fieldId
                );
                return fv?.name?.toLowerCase() === val;
            }
            return content.title?.toLowerCase().includes(val) ?? false;
        }
    }
}
