'use strict';
import { Enum } from './utils.js';
// X-Github-Next-Global-ID: 1

const QUERY_REPO = `
fragment queryRepo on Repository {
  nameWithOwner
  description
  isPrivate
  primaryLanguage {
    name
  }
  updatedAt
  stargazerCount
  pullRequests(states: OPEN) {
    totalCount
  }
  issues(states: OPEN) {
    totalCount
  }
  releases {
    totalCount
  }
  owner {
    id
  }
  parent {
    nameWithOwner
    id
    url
  }
  hasWikiEnabled
  homepageUrl
  viewerHasStarred
  viewerSubscription
  url
  sshUrl
  id
}
`;

const USER_REPOS = [
  `
  query UserRepos($name: String!, $cursor: String) {
    repositoryOwner(login: $name) {
      ...getRepos
    }
  }
  ${QUERY_REPO}
  fragment getRepos on RepositoryOwner {
    repositories(first: 50, after: $cursor, orderBy: {field: STARGAZERS, direction: DESC}) {
      nodes {
        ...queryRepo
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  `,
  {
    name: '',
    cursor: null,
  },
];

const QUERY_USER = `
fragment queryUser on User {
  login
  name
  bio
  followers {
    totalCount
  }
  viewerIsFollowing
  isViewer
  websiteUrl
  repositories {
    totalCount
  }
  url
  id
}
`;

const QUERY_ORG = `
fragment queryOrg on Organization {
  login
  name
  description
  viewerIsFollowing
  isVerified
  websiteUrl
  repositories {
    totalCount
  }
  url
  id
  }
`;

const QUERY_ISSUE = `
fragment queryIssue on Issue {
  author {
    login
  }
  title
  bodyText
  state
  comments {
    totalCount
  }
  updatedAt
  number
  repository {
    ...queryRepo
  }
  viewerSubscription
  labels(first: 5) {
    nodes {
      name
    }
  }
  url
  id
}
`;

const REPO_ISSUES = [
  `
  query RepoIssues($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(states: [OPEN], first: 50, orderBy: {field: CREATED_AT, direction: DESC}, after: $cursor) {
        nodes {
          ...queryIssue
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_ISSUE}
  ${QUERY_REPO}
  `,
  {
    owner: '',
    name: '',
    cursor: null,
  },
];

const QUERY_PR = `
fragment queryPR on PullRequest {
  author {
    login
  }
  title
  bodyText
  state
  comments {
    totalCount
  }
  updatedAt
  mergedAt
  number
  repository {
    ...queryRepo
  }
  viewerSubscription
  labels(first: 5) {
    nodes {
      name
    }
  }
  url
  id
}
`;

const REPO_PRS = [
  `
  query RepoPRs($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: 50
        states: [OPEN]
        orderBy: {field: CREATED_AT, direction: DESC}
        after: $cursor
      ) {
        nodes {
          ...queryPR
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_PR}
  ${QUERY_REPO}
  `,
  {
    owner: '',
    name: '',
    cursor: null,
  },
];

const REPO_RELEASES = [
  `
  query RepoReleases($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      releases(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          name
          publishedAt
          description
          isPrerelease
          tagName
          releaseAssets {
            totalCount
          }
          url
          id
        }
      }
    }
  }
  `,
  {
    owner: '',
    name: '',
  },
];

const RELEASE_ASSETS = [
  `
  query ReleaseAssets($id: ID!) {
    node(id: $id) {
      ... on Release {
        releaseAssets(first: 50) {
          nodes {
            name
            size
            downloadCount
            downloadUrl
            id
          }
        }
      }
    }
  }
  `,
  {
    id: '',
  },
];

const REPO_TREE = [
  `
  query RepositoryFileTree($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      url
      defaultBranchRef {
        name
        target {
          ... on Commit {
            tree {
              oid
            }
          }
        }
      }
    }
  }
  `,
  {
    owner: '',
    name: '',
  },
];

const QUERY_ANY_TYPE = `
  fragment queryAnyType on Node {
    ... on Repository {
      ...queryRepo
    }
    ... on Issue {
      ...queryIssue
    }
    ... on PullRequest {
      ...queryPR
    }
    ... on User {
      ...queryUser
    }
    ... on Organization {
      ...queryOrg
    }
  }
  ${QUERY_REPO}
  ${QUERY_ISSUE}
  ${QUERY_PR}
  ${QUERY_USER}
  ${QUERY_ORG}
`;

const NODES = [
  `
  query Nodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ...queryAnyType
    }
  }
  ${QUERY_ANY_TYPE}
  `,
  {
    ids: [],
    cursor: null,
  },
];

const ME = [
  `
  query Me {
    viewer {
      login
      name
      id
      avatarUrl
    }
  }
  `,
  {},
];

const MY_REPOS = [
  `
  query UserRepos($cursor: String) {
    viewer {
      ...getRepos
    }
  }
  ${QUERY_REPO}
  fragment getRepos on RepositoryOwner {
    repositories(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        ...queryRepo
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  `,
  {
    cursor: null,
  },
];

const MY_WATCHING = [
  `
  query MyWatching($cursor: String) {
    viewer {
      watching(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          ...queryRepo
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_REPO}
  `,
  {
    cursor: null,
  },
];

const MY_STARS = [
  `
  query MyStars($cursor: String) {
    viewer {
      starredRepositories(first: 50, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
        nodes {
          ...queryRepo
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_REPO}
  `,
  {
    cursor: null,
  },
];

const QUERY_LIST = [
  `
  fragment queryList on UserList {
    name
    description
    id
    isPrivate
    updatedAt
    user {
      login
    }
    items(first: 50, after: $cursor) {
      totalCount
      nodes {
        ... on Repository {
          id
        }
      }
    }
  }`,
  {
    cursor: null,
  },
];

const MY_LISTS = [
  `
  query MyLists($cursor: String) {
    viewer {
      lists(first: 50) {
        nodes {
          ...queryList
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_LIST}
  `,
  {
    cursor: null,
  },
];

// const QUERY_GIST = `
// fragment queryGist on Gist {
//   name
//   description
//   isPublic
//   updatedAt
//   stargazerCount
//   files {
//     name
//     size
//     language {
//       id
//     }
//   }
//   viewerHasStarred
//   url
//   id
// }
// `;

// const MY_GISTS = [
//   `
//   query UserGists($cursor: String) {
//     viewer {
//       ...getGists
//     }
//   }
//   ${QUERY_GIST}
//   fragment getGists on User {
//     gists(privacy: ALL, orderBy: {field: UPDATED_AT, direction: DESC}, first: 50, after: $cursor) {
//       nodes {
//         ...queryGist
//       }
//       pageInfo {
//         hasNextPage
//         endCursor
//       }
//     }
//   }
//   `,
//   {
//     cursor: null,
//   }
// ];

const MY_FOLLOWING = [
  `
  query MyFollowing($cursor: String) {
    viewer {
      following(first: 50, after: $cursor) {
        nodes {
          ...queryUser
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_USER}
  `,
  {
    cursor: null,
  },
];

const MY_ISSUES = [
  `
  query MyIssues($states: [IssueState!] = OPEN, $cursor: String) {
    viewer {
      issues(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}, filterBy: {viewerSubscribed: true, states: $states}, after: $cursor) {
        nodes {
          ...queryIssue
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_ISSUE}
  ${QUERY_REPO}
  `,
  {
    states: new Enum('OPEN', null),
    cursor: null,
  },
];

const MY_PRS = [
  `
  query MyPRs($cursor: String) {
    viewer {
      pullRequests(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}, states: OPEN, after: $cursor) {
        nodes {
          ...queryPR
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${QUERY_PR}
  ${QUERY_REPO}
  `,
  {
    cursor: null,
  },
];

const MY_PROJECTS = [
  `
  query MyProjects($cursor: String) {
    viewer {
      projectsV2(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          id
          title
          url
          shortDescription
          public
          createdAt
          updatedAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }`,
  {
    cursor: null,
  },
];

const SEARCH = `
  query SearchRepos($q: String!, $type: SearchType = REPOSITORY, $cursor: String) {
    search(query: $q, type: $type, first: 12, after: $cursor) {
      nodes {
        ...queryAnyType
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  ${QUERY_ANY_TYPE}
`;

const SEARCH_USER = [
  SEARCH,
  {
    q: '',
    type: 'USER',
    cursor: null,
  },
];

const SEARCH_REPO = [
  SEARCH,
  {
    q: '',
    type: 'REPOSITORY',
    cursor: null,
  },
];

const SEARCH_ISSUE = [
  SEARCH,
  {
    q: '',
    type: 'ISSUE',
    cursor: null,
  },
];

const STAR = [
  `
  mutation Star($id: ID!, $unstar: Boolean = false) {
    addStar(input: {starrableId: $id}) @skip(if: $unstar) {
      starrable {
        viewerHasStarred
        ... on Repository {
          nameWithOwner
        }
        ... on Topic {
          name
        }
      }
    }
    removeStar(input: {starrableId: $id}) @include(if: $unstar) {
      starrable {
        viewerHasStarred
        ... on Repository {
          nameWithOwner
        }
        ... on Topic {
          name
        }
      }
    }
  }
  `,
  {
    id: '',
    unstar: false,
  },
];

const SUBSCRIBE = [
  `
  mutation Subscribe($id: ID!, $state: SubscriptionState = SUBSCRIBED) {
    updateSubscription(input: {subscribableId: $id, state: $state}) {
      subscribable {
        viewerSubscription
        ... on Repository {
          nameWithOwner
        }
        ... on Issue {
          repository {
            nameWithOwner
          }
          number
        }
        ... on PullRequest {
          repository {
            nameWithOwner
          }
          number
        }
      }
    }
  }
  `,
  {
    id: '',
    state: new Enum('SUBSCRIBED', 'UNSUBSCRIBED'),
  },
];

const FOLLOW = [
  `
  mutation Follow($org: Boolean = false, $id: ID!) {
    followUser(input: {userId: $id}) @skip(if: $org) {
      user {
        login
        viewerIsFollowing
      }
    }
    followOrganization(input: {organizationId: $id}) @include(if: $org) {
      organization {
        login
        viewerIsFollowing
      }
    }
  }
  `,
  {
    org: false,
    id: '',
  },
];

const UNFOLLOW = [
  `
  mutation Unfollow($org: Boolean = false, $id: ID!) {
    unfollowUser(input: {userId: $id}) @skip(if: $org) {
      user {
        login
        viewerIsFollowing
      }
    }
    unfollowOrganization(input: {organizationId: $id}) @include(if: $org) {
      organization {
        login
        viewerIsFollowing
      }
    }
  }
  `,
  {
    org: false,
    id: '',
  },
];

const CREATE_REPO = [
  `
  mutation CreateRepo($name: String!, $visibility: RepositoryVisibility!) {
    createRepository(input: {name: $name, visibility: $visibility}) {
      repository {
        ...queryRepo
      }
    }
  }
  ${QUERY_REPO}
  `,
  {
    name: '',
    visibility: 'PUBLIC',
  },
];

export {
    CREATE_REPO, FOLLOW, ME,
    // MY_GISTS,
    MY_FOLLOWING,
    MY_ISSUES, MY_LISTS, MY_PROJECTS, MY_PRS, MY_REPOS, MY_STARS, MY_WATCHING, NODES, RELEASE_ASSETS, REPO_ISSUES,
    REPO_PRS,
    REPO_RELEASES, REPO_TREE, SEARCH_ISSUE, SEARCH_REPO, SEARCH_USER, STAR,
    SUBSCRIBE, UNFOLLOW, USER_REPOS
};
