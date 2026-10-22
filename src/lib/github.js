/**
 * Minimal GitHub REST client for the off-site backup feature.
 *
 * Only the handful of endpoints needed to keep a binary snapshot in a
 * repository are implemented: read a repository, list/read/write/delete files
 * through the Contents API. `fetch` is global since Node 18, so no dependency
 * is added. The access token is never included in an error message.
 */
const DEFAULT_API_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export class GithubError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.body = body;
  }
}

/** Encodes every path segment but keeps the slashes that separate them. */
export function encodeRepoPath(repoPath) {
  return String(repoPath)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function isNotFound(error) {
  return error instanceof GithubError && error.status === 404;
}

export function createGithubClient({ token = '', apiBaseUrl = DEFAULT_API_BASE_URL, userAgent = 'student-league-backup' } = {}) {
  async function request(method, apiPath, body) {
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': API_VERSION,
      'user-agent': userAgent,
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response;
    try {
      response = await fetch(`${apiBaseUrl}${apiPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A network failure, a DNS problem or a blocked host — never echo the token.
      throw new GithubError(0, `GitHub ${method} ${apiPath} could not be reached: ${String(err?.message || err)}`);
    }

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text.slice(0, 200) };
      }
    }
    if (!response.ok) {
      const detail = parsed?.message || response.statusText || 'request failed';
      throw new GithubError(response.status, `GitHub ${method} ${apiPath} failed (${response.status}): ${detail}`, parsed);
    }
    return parsed;
  }

  return {
    request,
    /** `{ full_name, private, default_branch, ... }`; throws 404 when the token cannot see the repo. */
    getRepo: (repo) => request('GET', `/repos/${repo}`),
    /** A file object (`{ sha, content, encoding }`) or an array of entries for a directory. */
    getContents: (repo, repoPath, ref) => {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return request('GET', `/repos/${repo}/contents/${encodeRepoPath(repoPath)}${query}`);
    },
    /**
     * Raw Git blob (`{ content, encoding: 'base64' }`). The Contents API omits
     * `content` for files over 1 MB, so snapshots must be fetched through this
     * endpoint to make large backups restorable.
     */
    getBlob: (repo, sha) => request('GET', `/repos/${repo}/git/blobs/${encodeURIComponent(sha)}`),
    putFile: (repo, repoPath, { contentBase64, message, sha, branch }) =>
      request('PUT', `/repos/${repo}/contents/${encodeRepoPath(repoPath)}`, {
        message,
        content: contentBase64,
        branch,
        ...(sha ? { sha } : {}),
      }),
    deleteFile: (repo, repoPath, { message, sha, branch }) =>
      request('DELETE', `/repos/${repo}/contents/${encodeRepoPath(repoPath)}`, { message, sha, branch }),
  };
}
