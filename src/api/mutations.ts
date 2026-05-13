export const UPDATE_ITEM_FIELD_VALUE = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: $value
    }) {
      projectV2Item { id }
    }
  }
`;

export const ADD_ITEM_TO_PROJECT = `
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

export const ADD_DRAFT_ISSUE = `
  mutation($projectId: ID!, $title: String!, $body: String) {
    addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
      projectItem { id }
    }
  }
`;

export const DELETE_PROJECT_ITEM = `
  mutation($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      deletedItemId
    }
  }
`;

export const ADD_LABELS = `
  mutation($labelableId: ID!, $labelIds: [ID!]!) {
    addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
      labelable {
        ... on Issue { id labels(first: 20) { nodes { name color } } }
      }
    }
  }
`;

export const REMOVE_LABELS = `
  mutation($labelableId: ID!, $labelIds: [ID!]!) {
    removeLabelsFromLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
      labelable {
        ... on Issue { id labels(first: 20) { nodes { name color } } }
      }
    }
  }
`;

export const ADD_ASSIGNEES = `
  mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
    addAssigneesToAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
      assignable {
        ... on Issue { id assignees(first: 20) { nodes { login } } }
      }
    }
  }
`;

export const REMOVE_ASSIGNEES = `
  mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
    removeAssigneesFromAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
      assignable {
        ... on Issue { id assignees(first: 20) { nodes { login } } }
      }
    }
  }
`;

export const CREATE_ISSUE = `
  mutation($repositoryId: ID!, $title: String!, $body: String, $labelIds: [ID!], $assigneeIds: [ID!]) {
    createIssue(input: {
      repositoryId: $repositoryId
      title: $title
      body: $body
      labelIds: $labelIds
      assigneeIds: $assigneeIds
    }) {
      issue { id number title url }
    }
  }
`;

export const UPDATE_ISSUE = `
  mutation($id: ID!, $title: String, $body: String) {
    updateIssue(input: { id: $id, title: $title, body: $body }) {
      issue { id title body }
    }
  }
`;

export const UPDATE_DRAFT_ISSUE = `
  mutation($draftIssueId: ID!, $title: String, $body: String) {
    updateProjectV2DraftIssue(input: { draftIssueId: $draftIssueId, title: $title, body: $body }) {
      draftIssue { id title body }
    }
  }
`;
