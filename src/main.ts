import * as core from '@actions/core'
import * as github from '@actions/github'
import { Octokit } from '@octokit/rest'

export async function run() {
  core.info('Running actions/first-interaction!')

  // Skip if this is not an issue, PR, or discussion event.
  if (
    github.context.eventName !== 'issues' &&
    github.context.eventName !== 'pull_request' &&
    github.context.eventName !== 'discussion'
  )
    return core.info('Skipping...Not an Issue/PR/Discussion Event')

  // Skip if this is not an issue/PR open event or discussion created event.
  if (
    (github.context.eventName === 'discussion' &&
      github.context.action !== 'created') ||
    ((github.context.eventName === 'issues' ||
      github.context.eventName === 'pull_request') &&
      github.context.action !== 'opened')
  )
    return core.info('Skipping...Not an Opened/Created Event')

  // Confirm the sender data is present.
  if (!github.context.payload.sender)
    return core.setFailed('Internal Error...No Sender Provided by GitHub')

  // Check if this is an issue, PR, or discussion event.
  const isIssue = github.context.payload.issue !== undefined
  const isPullRequest = github.context.payload.pull_request !== undefined
  const isDiscussion = github.context.payload.discussion !== undefined

  // Confirm that exactly one of the three is present.
  const eventCount = [isIssue, isPullRequest, isDiscussion].filter(
    Boolean
  ).length
  if (eventCount === 0)
    return core.setFailed(
      'Internal Error...No Issue, PR, or Discussion Provided by GitHub'
    )
  if (eventCount > 1)
    return core.setFailed(
      'Internal Error...Multiple Event Types Provided by GitHub'
    )

  // Get the action inputs.
  const issueMessage: string = core.getInput('issue_message', {
    required: !isDiscussion && !isPullRequest
  })
  const prMessage: string = core.getInput('pr_message', {
    required: !isDiscussion && !isIssue
  })
  const discussionMessage: string = core.getInput('discussion_message', {
    required: !isIssue && !isPullRequest
  })

  const octokit = new Octokit({
    auth: core.getInput('repo_token', { required: true })
  })

  // Check if this is the user's first contribution.
  const isFirstContribution =
    (isIssue && (await isFirstIssue(octokit))) ||
    (isPullRequest && (await isFirstPullRequest(octokit))) ||
    (isDiscussion && (await isFirstDiscussion(octokit)))

  if (!isFirstContribution)
    return core.info('Skipping...Not First Contribution')

  // Get the appropriate message and target number for comment
  let message: string
  let targetNumber: number

  if (isIssue) {
    message = issueMessage
    targetNumber = github.context.issue.number
  } else if (isPullRequest) {
    message = prMessage
    targetNumber = github.context.issue.number
  } else {
    message = discussionMessage
    targetNumber = github.context.payload.discussion!.number
  }

  core.info(`Adding Message to #${targetNumber}`)

  if (isDiscussion) {
    // For discussions, we need to use the GraphQL API
    await createDiscussionComment(octokit, targetNumber, message)
  } else {
    // For issues and PRs, use the existing REST API
    await octokit.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: targetNumber,
      body: message
    })
  }
}

/**
 * Checks if this is the user's first issue.
 *
 * @param octokit Octokit instance
 * @returns true if this is the user's first issue
 */
export async function isFirstIssue(octokit: Octokit): Promise<boolean> {
  try {
    const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      creator: github.context.payload.sender!.login,
      state: 'all'
    })

    return (
      issues
        // Filter out PRs.
        .filter((issue) => issue.pull_request === undefined)
        // Filter out any issue that are newer than the current issue.
        .filter((issue) => issue.number < github.context.issue.number)
        .length === 0
    )
  } catch (error) {
    core.setFailed((error as any).message)
    return false
  }
}

/**
 * Checks if this is the user's first pull request.
 *
 * @param octokit Octokit instance
 * @returns true if this is the user's first pull request
 */
export async function isFirstPullRequest(octokit: Octokit): Promise<boolean> {
  try {
    const pulls = await octokit.paginate(octokit.rest.pulls.list, {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      state: 'all'
    })

    return (
      // Filter out any PRs that are newer than the current one.
      pulls.filter((pull) => pull.number < github.context.issue.number)
        .length === 0
    )
  } catch (error) {
    core.setFailed((error as any).message)
    return false
  }
}

/**
 * Checks if this is the user's first discussion.
 *
 * @param octokit Octokit instance
 * @returns true if this is the user's first discussion
 */
export async function isFirstDiscussion(octokit: Octokit): Promise<boolean> {
  try {
    const currentDiscussionNumber = github.context.payload.discussion!.number
    const authorLogin = github.context.payload.sender!.login

    // Use GraphQL to fetch discussions created by this user in this repository
    const query = `
      query($owner: String!, $repo: String!, $author: String!, $first: Int!) {
        repository(owner: $owner, name: $repo) {
          discussions(first: $first, filterBy: { createdBy: $author }) {
            nodes {
              number
            }
          }
        }
      }
    `

    const variables = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      author: authorLogin,
      first: 100 // Fetch up to 100 discussions to check
    }

    const response: any = await octokit.graphql(query, variables)
    const discussions = response.repository.discussions.nodes

    // Check if there are any discussions by this user with a lower number
    const olderDiscussions = discussions.filter(
      (discussion: any) => discussion.number < currentDiscussionNumber
    )

    return olderDiscussions.length === 0
  } catch (error) {
    core.setFailed((error as any).message)
    return false
  }
}

/**
 * Creates a comment on a discussion using GraphQL API.
 *
 * @param octokit Octokit instance
 * @param discussionNumber Discussion number
 * @param body Comment body
 */
export async function createDiscussionComment(
  octokit: Octokit,
  discussionNumber: number,
  body: string
): Promise<void> {
  try {
    // First, get the discussion ID using the discussion number
    const getDiscussionQuery = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            id
          }
        }
      }
    `

    const getDiscussionVariables = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      number: discussionNumber
    }

    const discussionResponse: any = await octokit.graphql(
      getDiscussionQuery,
      getDiscussionVariables
    )
    const discussionId = discussionResponse.repository.discussion.id

    // Now create the comment
    const addCommentMutation = `
      mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment {
            id
          }
        }
      }
    `

    const addCommentVariables = {
      discussionId,
      body
    }

    await octokit.graphql(addCommentMutation, addCommentVariables)
  } catch (error) {
    core.setFailed((error as any).message)
  }
}
