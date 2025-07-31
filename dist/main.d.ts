import { Octokit } from '@octokit/rest';
export declare function run(): Promise<void>;
/**
 * Checks if this is the user's first issue.
 *
 * @param octokit Octokit instance
 * @returns true if this is the user's first issue
 */
export declare function isFirstIssue(octokit: Octokit): Promise<boolean>;
/**
 * Checks if this is the user's first pull request.
 *
 * @param octokit Octokit instance
 * @returns true if this is the user's first pull request
 */
export declare function isFirstPullRequest(octokit: Octokit): Promise<boolean>;
/**
 * Checks if this is the user's first discussion.
 *
 * @param octokit Octokit instance
 * @returns true if this is the user's first discussion
 */
export declare function isFirstDiscussion(octokit: Octokit): Promise<boolean>;
/**
 * Creates a comment on a discussion using GraphQL API.
 *
 * @param octokit Octokit instance
 * @param discussionNumber Discussion number
 * @param body Comment body
 */
export declare function createDiscussionComment(octokit: Octokit, discussionNumber: number, body: string): Promise<void>;
