import { ProjectV2, ProjectItem, SingleSelectOption } from '../api/types';

export type TreeElement = ProjectNode | StatusGroupNode | ItemNode | MessageNode;

export interface ProjectNode {
    type: 'project';
    project: ProjectV2;
}

export interface StatusGroupNode {
    type: 'statusGroup';
    projectId: string;
    status: SingleSelectOption | null; // null = "No Status"
    items: ProjectItem[];
}

export interface ItemNode {
    type: 'item';
    projectId: string;
    item: ProjectItem;
}

export interface MessageNode {
    type: 'message';
    label: string;
    command?: { command: string; title: string };
}
