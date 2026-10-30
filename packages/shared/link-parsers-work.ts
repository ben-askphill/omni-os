// URL parsers for code hosts and issue trackers. Each returns a LinkRef for its own hosts and nothing otherwise.
import { slugTitle, type Parser } from './link-source-types.ts';

// ---------- code hosts ----------

export const github: Parser = (u, host, p) => {
  if (host === 'gist.github.com' && p.length >= 2) {
    return { source: 'github', kind: 'gist', fallback: 'Gist', context: p[0], params: { id: p[1] } };
  }
  if (host !== 'github.com' && host !== 'www.github.com') return;
  const [owner, repo, kind, ...rest] = p;
  const RESERVED = ['settings', 'notifications', 'login', 'marketplace', 'explore', 'topics', 'search', 'pulls', 'issues', 'features', 'about', 'pricing', 'sponsors', 'orgs', 'apps', 'enterprise', 'new', 'codespaces'];
  if (!owner || RESERVED.includes(owner)) return { source: 'github', kind: 'page', fallback: 'GitHub', params: {}, fetchTitle: true };
  if (!repo) return { source: 'github', kind: 'user', fallback: owner, params: { owner } };
  const context = `${owner}/${repo}`;
  const params = { owner, repo };
  const n = rest[0];
  if ((kind === 'pull' || kind === 'issues') && n && /^\d+$/.test(n)) {
    return { source: 'github', kind: kind === 'pull' ? 'pull' : 'issue', ref: `#${n}`, fallback: kind === 'pull' ? 'Pull request' : 'Issue', context, params: { ...params, number: n } };
  }
  if (kind === 'discussions' && n && /^\d+$/.test(n)) {
    return { source: 'github', kind: 'discussion', ref: `#${n}`, fallback: 'Discussion', context, params: { ...params, number: n } };
  }
  if (kind === 'commit' && n && /^[0-9a-f]{7,40}$/i.test(n)) {
    return { source: 'github', kind: 'commit', ref: n.slice(0, 7), fallback: 'Commit', context, params: { ...params, sha: n } };
  }
  if (kind === 'pull' && rest[1] === 'commits' && rest[2]) {
    return { source: 'github', kind: 'commit', ref: rest[2].slice(0, 7), fallback: 'Commit', context, params: { ...params, sha: rest[2] } };
  }
  if (kind === 'releases' && rest[0] === 'tag' && rest[1]) {
    return { source: 'github', kind: 'release', ref: rest[1], fallback: 'Release', context, params: { ...params, tag: rest[1] } };
  }
  if (kind === 'actions' && rest[0] === 'runs' && rest[1] && /^\d+$/.test(rest[1])) {
    return { source: 'github', kind: 'run', fallback: 'Workflow run', context, params: { ...params, id: rest[1] } };
  }
  if ((kind === 'blob' || kind === 'tree') && rest.length >= 1) {
    const path = rest.slice(1).join('/');
    const line = u.hash.match(/^#L(\d+)/)?.[1];
    return { source: 'github', kind: 'file', title: path ? `${path}${line ? `:${line}` : ''}` : rest[0], fallback: path || rest[0], context: `${context}@${rest[0]}`, params };
  }
  if (kind === 'compare' && n) return { source: 'github', kind: 'compare', title: n, fallback: 'Compare', context, params };
  if (!kind) return { source: 'github', kind: 'repo', title: context, fallback: context, params };
  return { source: 'github', kind: 'page', title: `${context} ${kind}`, fallback: context, params };
};

export const gitlab: Parser = (_u, host, p) => {
  if (host !== 'gitlab.com' && !host.startsWith('gitlab.')) return;
  const dash = p.indexOf('-');
  if (dash < 2) return p.length >= 2 ? { source: 'gitlab', kind: 'repo', title: p.join('/'), fallback: p.join('/'), params: { host } } : undefined;
  const project = p.slice(0, dash).join('/');
  const [kind, n] = p.slice(dash + 1);
  if ((kind === 'issues' || kind === 'merge_requests') && n && /^\d+$/.test(n)) {
    return {
      source: 'gitlab', kind: kind === 'issues' ? 'issue' : 'merge-request', ref: kind === 'issues' ? `#${n}` : `!${n}`,
      fallback: kind === 'issues' ? 'Issue' : 'Merge request', context: project, params: { host, project, number: n },
    };
  }
  if (kind === 'commit' && n) return { source: 'gitlab', kind: 'commit', ref: n.slice(0, 7), fallback: 'Commit', context: project, params: { host, project } };
  return { source: 'gitlab', kind: 'page', fallback: project, context: project, params: { host } };
};

export const bitbucket: Parser = (_u, host, p) => {
  if (host !== 'bitbucket.org') return;
  const [ws, repo, kind, n] = p;
  if (!ws || !repo) return { source: 'bitbucket', kind: 'page', fallback: 'Bitbucket', params: {} };
  const context = `${ws}/${repo}`;
  if (kind === 'pull-requests' && n && /^\d+$/.test(n)) {
    return { source: 'bitbucket', kind: 'pull', ref: `#${n}`, fallback: 'Pull request', context, params: { ws, repo, number: n } };
  }
  if (kind === 'commits' && n) return { source: 'bitbucket', kind: 'commit', ref: n.slice(0, 7), fallback: 'Commit', context, params: {} };
  return { source: 'bitbucket', kind: 'repo', title: context, fallback: context, params: {} };
};

// ---------- trackers ----------

/** dev.azure.com/{org}/{project}/... and the older {org}.visualstudio.com/{project}/... */
export const azureDevops: Parser = (u, host, p) => {
  let org: string | undefined;
  let rest: string[];
  if (host === 'dev.azure.com') [org, ...rest] = p;
  else if (host.endsWith('.visualstudio.com')) {
    org = host.slice(0, -'.visualstudio.com'.length);
    rest = p.filter((x) => x !== 'DefaultCollection');
  } else return;
  if (!org) return { source: 'azure-devops', kind: 'page', fallback: 'Azure DevOps', params: {} };
  const base = { source: 'azure-devops' as const, params: { org } };
  const wi = rest.indexOf('_workitems');
  if (wi >= 0) {
    const id = (rest[wi + 1] === 'edit' ? rest[wi + 2] : undefined) ?? u.searchParams.get('workitem') ?? u.searchParams.get('id') ?? undefined;
    const project = wi > 0 ? rest[0] : undefined;
    if (id && /^\d+$/.test(id)) return { ...base, kind: 'work-item', ref: id, fallback: 'Work item', context: project ?? org, params: { org, id, ...(project && { project }) } };
  }
  const workitem = u.searchParams.get('workitem');
  if (workitem && /^\d+$/.test(workitem)) {
    return { ...base, kind: 'work-item', ref: workitem, fallback: 'Work item', context: rest[0] ?? org, params: { org, id: workitem, ...(rest[0] && { project: rest[0] }) } };
  }
  const git = rest.indexOf('_git');
  if (git >= 1) {
    const project = rest[0];
    const repo = rest[git + 1];
    const pr = rest[git + 2] === 'pullrequest' ? rest[git + 3] : undefined;
    if (repo && pr && /^\d+$/.test(pr)) {
      return { ...base, kind: 'pull', ref: `!${pr}`, fallback: 'Pull request', context: repo, params: { org, project, repo, id: pr } };
    }
    if (repo && rest[git + 2] === 'commit' && rest[git + 3]) {
      return { ...base, kind: 'commit', ref: rest[git + 3].slice(0, 7), fallback: 'Commit', context: repo, params: { org, project, repo, sha: rest[git + 3] } };
    }
    if (repo) {
      const path = u.searchParams.get('path');
      return { ...base, kind: 'repo', title: path ? `${repo}${path}` : repo, fallback: repo, context: project, params: { org, project, repo } };
    }
  }
  const build = u.searchParams.get('buildId');
  if (rest.includes('_build') && build && /^\d+$/.test(build)) {
    return { ...base, kind: 'build', ref: build, fallback: 'Build', context: rest[0], params: { org, project: rest[0], id: build } };
  }
  const wiki = rest.indexOf('_wiki');
  if (wiki >= 0) {
    const last = rest[rest.length - 1];
    return { ...base, kind: 'wiki', title: slugTitle(last !== 'wikis' ? last : undefined), fallback: 'Wiki page', context: rest[0], params: { org } };
  }
  const board = rest.find((x) => x === '_boards' || x === '_backlogs' || x === '_sprints');
  if (board) return { ...base, kind: 'board', fallback: 'Board', context: rest[0] ?? org, params: { org } };
  return { ...base, kind: 'page', fallback: rest[0] ?? org, context: org, params: { org } };
};

export const atlassian: Parser = (u, host, p) => {
  if (!host.endsWith('.atlassian.net') && !host.endsWith('.jira.com')) return;
  const site = host;
  if (p[0] === 'wiki') {
    const pages = p.indexOf('pages');
    const id = pages >= 0 ? p[pages + 1] : u.searchParams.get('pageId') ?? undefined;
    const space = p[1] === 'spaces' ? p[2] : undefined;
    if (id && /^\d+$/.test(id)) {
      return { source: 'confluence', kind: 'page', title: slugTitle(p[pages + 2]), fallback: 'Page', context: space, params: { site, id } };
    }
    return { source: 'confluence', kind: 'space', fallback: space ? `Space ${space}` : 'Confluence', params: { site } };
  }
  const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
  const key = (p[0] === 'browse' && KEY.test(p[1] ?? '') ? p[1] : undefined)
    ?? (u.searchParams.get('selectedIssue') && KEY.test(u.searchParams.get('selectedIssue')!) ? u.searchParams.get('selectedIssue')! : undefined)
    ?? p.find((x) => KEY.test(x));
  if (key) return { source: 'jira', kind: 'issue', ref: key, fallback: 'Issue', context: site.split('.')[0], params: { site, key } };
  const project = p[0] === 'jira' && p.includes('projects') ? p[p.indexOf('projects') + 1] : undefined;
  return { source: 'jira', kind: 'board', fallback: project ? `Project ${project}` : 'Jira', context: site.split('.')[0], params: { site } };
};

export const linear: Parser = (_u, host, p) => {
  if (host !== 'linear.app') return;
  const [ws, kind, id, slug] = p;
  if (kind === 'issue' && id) return { source: 'linear', kind: 'issue', ref: id.toUpperCase(), title: slugTitle(slug), fallback: 'Issue', context: ws, params: { id } };
  if (kind === 'project' && id) {
    const words = id.replace(/-[0-9a-f]{8,}$/i, '');
    return { source: 'linear', kind: 'project', title: slugTitle(words), fallback: 'Project', context: ws, params: {} };
  }
  return { source: 'linear', kind: 'page', fallback: ws ?? 'Linear', params: {} };
};

export const trello: Parser = (_u, host, p) => {
  if (host !== 'trello.com') return;
  const [kind, id, slug] = p;
  if (kind === 'c' && id) return { source: 'trello', kind: 'card', title: slugTitle(slug?.replace(/^\d+-/, '')), fallback: 'Card', params: { id } };
  if (kind === 'b' && id) return { source: 'trello', kind: 'board', title: slugTitle(slug), fallback: 'Board', params: { id } };
  return { source: 'trello', kind: 'page', fallback: 'Trello', params: {} };
};

export const asana: Parser = (_u, host, p) => {
  if (host !== 'app.asana.com') return;
  // /0/{project}/{task}[/f] and the newer /1/{workspace}/project/{project}/task/{task}
  const task = p[0] === '0' ? p[2] : p[p.indexOf('task') + 1];
  if (task && /^\d+$/.test(task) && task !== '0') return { source: 'asana', kind: 'task', fallback: 'Task', params: { id: task } };
  return { source: 'asana', kind: 'page', fallback: 'Asana', params: {} };
};

export const clickup: Parser = (_u, host, p) => {
  if (host !== 'app.clickup.com' && host !== 'sharing.clickup.com') return;
  const t = p.indexOf('t');
  const id = t >= 0 ? p[p.length - 1] : undefined;
  if (id && t < p.length - 1) return { source: 'clickup', kind: 'task', ref: id, fallback: 'Task', params: { id } };
  return { source: 'clickup', kind: 'page', fallback: 'ClickUp', params: {} };
};

/** app.productive.io/{orgId}-{slug}/... : tasks, projects, deals, docs. */
export const productive: Parser = (_u, host, p) => {
  if (host !== 'app.productive.io') return;
  const org = p[0]?.match(/^(\d+)-/)?.[1];
  const after = (word: string) => {
    const i = p.lastIndexOf(word);
    return i >= 0 && /^\d+$/.test(p[i + 1] ?? '') ? p[i + 1] : undefined;
  };
  const params = org ? { org } : {};
  const task = after('task') ?? after('tasks');
  if (task) return { source: 'productive', kind: 'task', fallback: `Task ${task}`, params: { ...params, id: task } };
  const project = after('projects');
  if (project) return { source: 'productive', kind: 'project', fallback: `Project ${project}`, params: { ...params, id: project } };
  const deal = after('deals') ?? after('budgets');
  if (deal) return { source: 'productive', kind: 'deal', fallback: `Budget ${deal}`, params: { ...params, id: deal } };
  const doc = after('docs') ?? after('pages');
  if (doc) return { source: 'productive', kind: 'page', fallback: `Doc ${doc}`, params: { ...params, id: doc } };
  return { source: 'productive', kind: 'page', fallback: 'Productive', params };
};

export const sentry: Parser = (_u, host, p) => {
  if (host !== 'sentry.io' && !host.endsWith('.sentry.io')) return;
  const i = p.indexOf('issues');
  const id = i >= 0 ? p[i + 1] : undefined;
  if (id && /^\d+$/.test(id)) return { source: 'sentry', kind: 'issue', ref: id, fallback: 'Issue', params: { id } };
  return { source: 'sentry', kind: 'page', fallback: 'Sentry', params: {} };
};
