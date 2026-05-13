export const GET_VIEWER_PROJECTS = `
  query($first: Int!, $after: String) {
    viewer {
      login
      projectsV2(first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title number url closed shortDescription createdAt updatedAt
        }
      }
    }
  }
`;

export const GET_PROJECT_DETAIL = `
  query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2 {
        id title number url closed shortDescription createdAt updatedAt
        fields(first: 30) {
          nodes {
            ... on ProjectV2Field { __typename id name dataType }
            ... on ProjectV2SingleSelectField {
              __typename id name
              options { id name color }
            }
            ... on ProjectV2IterationField {
              __typename id name
              configuration {
                iterations { id title startDate duration }
              }
            }
          }
        }
        views(first: 20) {
          nodes { id name layout filter }
        }
      }
    }
  }
`;

export const GET_PROJECT_ITEMS = `
  query($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id type
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldTextValue {
                  __typename text
                  field { ... on ProjectV2FieldCommon { id name } }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  __typename number
                  field { ... on ProjectV2FieldCommon { id name } }
                }
                ... on ProjectV2ItemFieldDateValue {
                  __typename date
                  field { ... on ProjectV2FieldCommon { id name } }
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  __typename name optionId
                  field { ... on ProjectV2FieldCommon { id name } }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  __typename title iterationId startDate duration
                  field { ... on ProjectV2FieldCommon { id name } }
                }
              }
            }
            content {
              ... on DraftIssue { __typename id title body }
              ... on Issue {
                __typename id title number state url body createdAt updatedAt
                assignees(first: 10) { nodes { login avatarUrl } }
                labels(first: 10) { nodes { name color } }
                milestone { title dueOn }
                repository { nameWithOwner name owner { login } }
                parent { id }
                subIssues(first: 50) { nodes { id } }
                subIssuesSummary { total completed percentCompleted }
              }
              ... on PullRequest {
                __typename id title number state url
                assignees(first: 10) { nodes { login } }
                repository { nameWithOwner }
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_ISSUE_DETAIL = `
  query($id: ID!) {
    node(id: $id) {
      ... on Issue {
        id title number state url body createdAt updatedAt
        assignees(first: 20) { nodes { login avatarUrl } }
        labels(first: 20) { nodes { name color } }
        milestone { title dueOn }
        repository {
          nameWithOwner name
          owner { login }
          labels(first: 50) { nodes { id name color } }
          assignableUsers(first: 50) { nodes { login avatarUrl } }
        }
      }
    }
  }
`;

export const GET_VIEWER_REPOS = `
  query($first: Int!, $after: String) {
    viewer {
      repositories(first: $first, after: $after, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id nameWithOwner name
          owner { login }
        }
      }
    }
  }
`;
