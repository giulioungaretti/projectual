// --- Project types ---

export interface ProjectV2 {
    id: string;
    title: string;
    number: number;
    url: string;
    closed: boolean;
    shortDescription: string | null;
    createdAt: string;
    updatedAt: string;
}

// --- Field types ---

export type ProjectField =
    | ProjectTextField
    | ProjectNumberField
    | ProjectDateField
    | ProjectSingleSelectField
    | ProjectIterationField;

interface ProjectFieldBase {
    id: string;
    name: string;
}

export interface ProjectTextField extends ProjectFieldBase {
    __typename: 'ProjectV2Field';
    dataType: 'TEXT' | 'TITLE';
}

export interface ProjectNumberField extends ProjectFieldBase {
    __typename: 'ProjectV2Field';
    dataType: 'NUMBER';
}

export interface ProjectDateField extends ProjectFieldBase {
    __typename: 'ProjectV2Field';
    dataType: 'DATE';
}

export interface ProjectSingleSelectField extends ProjectFieldBase {
    __typename: 'ProjectV2SingleSelectField';
    options: SingleSelectOption[];
}

export interface SingleSelectOption {
    id: string;
    name: string;
    color?: string;
}

export interface ProjectIterationField extends ProjectFieldBase {
    __typename: 'ProjectV2IterationField';
    configuration: {
        iterations: IterationOption[];
    };
}

export interface IterationOption {
    id: string;
    title: string;
    startDate: string;
    duration?: number;
}

// --- Project View ---

export interface ProjectView {
    id: string;
    name: string;
    layout: 'BOARD_LAYOUT' | 'TABLE_LAYOUT' | 'ROADMAP_LAYOUT';
    filter: string | null;
}

// --- Field values ---

export type FieldValue =
    | TextFieldValue
    | NumberFieldValue
    | DateFieldValue
    | SingleSelectFieldValue
    | IterationFieldValue;

export interface TextFieldValue {
    __typename: 'ProjectV2ItemFieldTextValue';
    text: string;
    field: { id: string; name: string };
}

export interface NumberFieldValue {
    __typename: 'ProjectV2ItemFieldNumberValue';
    number: number;
    field: { id: string; name: string };
}

export interface DateFieldValue {
    __typename: 'ProjectV2ItemFieldDateValue';
    date: string;
    field: { id: string; name: string };
}

export interface SingleSelectFieldValue {
    __typename: 'ProjectV2ItemFieldSingleSelectValue';
    name: string;
    optionId: string;
    field: { id: string; name: string };
}

export interface IterationFieldValue {
    __typename: 'ProjectV2ItemFieldIterationValue';
    title: string;
    iterationId: string;
    startDate: string;
    duration: number;
    field: { id: string; name: string };
}

// --- Item content ---

export interface IssueContent {
    __typename: 'Issue';
    id: string;
    title: string;
    number: number;
    state: 'OPEN' | 'CLOSED';
    url: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    assignees: { nodes: Assignee[] };
    labels: { nodes: Label[] };
    milestone: { title: string; dueOn: string | null } | null;
    repository: { nameWithOwner: string; name: string; owner: { login: string } };
    parent: { id: string } | null;
    subIssues: { nodes: SubIssueRef[] };
    subIssuesSummary: { total: number; completed: number; percentCompleted: number };
}

export interface PullRequestContent {
    __typename: 'PullRequest';
    id: string;
    title: string;
    number: number;
    state: string;
    url: string;
    assignees: { nodes: Assignee[] };
    repository: { nameWithOwner: string };
}

export interface DraftIssueContent {
    __typename: 'DraftIssue';
    id: string;
    title: string;
    body: string;
}

export type ItemContent = IssueContent | PullRequestContent | DraftIssueContent;

// --- Project Item ---

export interface ProjectItem {
    id: string;
    type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE' | 'REDACTED';
    fieldValues: { nodes: FieldValue[] };
    content: ItemContent | null;
}

// --- Shared types ---

export interface SubIssueRef {
    id: string;
    title: string;
    number: number;
    state: 'OPEN' | 'CLOSED';
    url: string;
}

export interface Assignee {
    login: string;
    avatarUrl?: string;
}

export interface Label {
    name: string;
    color: string;
}

// --- Detailed project with items ---

export interface ProjectDetail extends ProjectV2 {
    fields: { nodes: ProjectField[] };
    views: { nodes: ProjectView[] };
}

// --- API response wrappers ---

export interface PageInfo {
    hasNextPage: boolean;
    endCursor: string | null;
}

export interface ProjectItemsPage {
    items: ProjectItem[];
    pageInfo: PageInfo;
}
