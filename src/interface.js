#!/usr/bin/env node
'use strict';
import { spawnSync } from 'child_process';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import Cache from './cache.js';
import {
  convertNum,
  convertSize,
  datetimeFormat,
  matchStr,
  notify,
} from './utils.js';
import Workflow from './workflow.js';

class Interface {
  Workflow;
  #Cache;
  #enterprise = process.env.enterprise === '1';
  #menuPath = [];
  #debug = !!process.env.alfred_debug;

  constructor() {
    this.Workflow = new Workflow();
    this.#Cache = new Cache();
  }

  async run(input = '') {
    if (!this.#Cache.loggedIn) {
      if (!process.env.config)
        this.logIn(input);
    } else {
      this.#Cache.refreshInBackground();
    }
    // All navigation state lives in one variable, `menu_path`, serialized as
    // `id1:nodeId1|id2:nodeId2|...`. Its last frame is the current screen: a
    // bare `id:` is a cached list, `id:nodeId` a node submenu, `main:` the root.
    // `action` (+ `options`/`queryPrefix`) is the only other control — it runs a
    // request and appends the resulting list, because that list's id isn't known
    // until the request returns. Everything else (drilling in, Back, typing)
    // carries no `action` and simply re-renders `menu_path`'s tail frame, so
    // Back is just "drop the last frame" and a submenu is just "append a frame".
    const path = Interface.#parsePath(process.env.menu_path);
    // Request params travel with `action`; clear them so a stale value can't
    // leak onto the next actioned item (Alfred keeps variables until cleared).
    this.Workflow.setVar('options', '');
    this.Workflow.setVar('queryPrefix', '');
    this.Workflow.setVar('execute', '');
    if (process.env.action === 'CREATE_REPO') {
      await this.createRepo(input);
    } else if (process.env.action === 'FORK_REPO') {
      await this.forkRepo();
    } else if (process.env.action?.startsWith('SEARCH_')) {
      if (this.#debug)
        console.error(2, process.env.action);
      if (process.env.queryPrefix)
        input = `${process.env.queryPrefix} ${input}`;
      await this.search(input, process.env.action, path);
    } else if (process.env.action) {
      if (this.#debug)
        console.error(3, process.env.action, process.env.menu_path);
      const action = process.env.action;
      const options = JSON.parse(process.env.options || '{}');
      try {
        const { id, data } = await this.#Cache.request(action, options);
        if (process.env.execute) {
          return this.notifyAction(action, data);
        } else if (!data?.length) {
          this.#menuPath = [...path, ''];
          this.Workflow.warnEmpty('No Results Found.');
        } else {
          this.#menuPath = [...path, `${id}:`];
          this.formatOutput(data, id);
          this.Workflow.filter(input);
        }
      } catch (e) {
        console.error(e.message);
        if (process.env.execute) {
          return notify(`Error: ${e.message}`);
        } else {
          this.#menuPath = [...path, ''];
          this.Workflow.warnEmpty(`Error: ${e.message}`);
        }
      }
    } else if (process.env.command) {
      if (this.#debug)
        console.error(5, process.env.command);
      return this.runCommand(process.env.command, input);
    } else if (process.env.config) {
      if (this.#debug)
        console.error(6, process.env.config);
      this.config(input);
    } else if (this.#Cache.loggedIn) {
      this.#menuPath = path.length ? path : ['main:'];
      await this.#renderFrame(this.#menuPath.at(-1), input);
    }
    if (this.#menuPath.length > 1) {
      this.Workflow.addItem({
        title: 'Go Back',
        icon: { path: 'icons/back.png' },
        // Back = drop the current frame. No `action`, so the parent frame is
        // re-rendered straight from `menu_path`.
        variables: {
          action: '',
          menu_path: Interface.#serializePath(this.#menuPath.slice(0, -1)),
        },
      });
    }
    return this.Workflow.output();
  }

  /** @param {string} str */
  static #parsePath(str) {
    return (str || '').split('|').filter(Boolean);
  }

  /** @param {string[]} frames */
  static #serializePath(frames) {
    return frames.filter(Boolean).join('|');
  }

  /**
   * Split a `id:nodeId` frame. nodeId is '' for a bare list frame.
   * @param {string} frame
   * @returns {[string, string]} the `[id, nodeId]` pair
   */
  static #splitFrame(frame) {
    const i = (frame || '').indexOf(':');
    return i === -1 ? [frame, ''] : [frame.slice(0, i), frame.slice(i + 1)];
  }

  /** `menu_path` value carried by fixed items on the current screen. */
  #pathVar() {
    return Interface.#serializePath(this.#menuPath);
  }

  /**
   * Frames of the screen that owns a node in the cached list `listId`. Usually
   * the current screen *is* that list (its `listId:` frame is already the tail);
   * otherwise (e.g. aggregated results on the main menu) the list frame is
   * appended so Back lands on the list.
   * @param {number|string} listId
   */
  #nodeParentFrames(listId) {
    const frame = `${listId}:`;
    return this.#menuPath.at(-1) === frame
      ? this.#menuPath
      : [...this.#menuPath, frame];
  }

  /** `menu_path` for an item that produces a list from a node in `listId`. */
  #nodeParentPath(listId) {
    return Interface.#serializePath(this.#nodeParentFrames(listId));
  }

  /** `menu_path` for an item that drills into node `nodeId` of list `listId`. */
  #submenuPath(listId, nodeId) {
    return Interface.#serializePath([
      ...this.#nodeParentFrames(listId),
      `${listId}:${nodeId}`,
    ]);
  }

  /** `menu_path` for an item on the current screen that drills into `frame`. */
  #childPath(frame) {
    return Interface.#serializePath([...this.#menuPath, frame]);
  }

  /**
   * Reproduce the screen described by a single `menu_path` frame.
   * @param {string} frame
   * @param {string} input
   */
  async #renderFrame(frame, input) {
    const [id, nodeId] = Interface.#splitFrame(frame);
    if (nodeId) {
      if (this.#debug)
        console.error(4, id, nodeId);
      await this.subMenu(id, nodeId);
    } else if (id === 'main' || !id) {
      if (input.startsWith('.')) {
        if (this.#debug)
          console.error(7);
        this.myMenu();
        this.Workflow.filter(input.slice(1));
      } else {
        if (this.#debug)
          console.error(8);
        await this.mainMenu(input);
      }
    } else {
      if (this.#debug)
        console.error(1, id);
      const row = this.#Cache.requestCacheById(id);
      if (row?.data) {
        this.formatOutput(row.data, row.id);
        this.Workflow.filter(input);
      } else {
        await this.mainMenu(input);
      }
    }
  }

  myMenu() {
    const { baseUrl, gistUrl, username } = this.#Cache;
    this.Workflow.addItem({
      title: 'My Repos',
      icon: { path: 'icons/repo.png' },
      match: 'repos',
      variables: {
        action: 'MY_REPOS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/${username}?tab=repositories`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Starred Repos',
      icon: { path: 'icons/repo_star.png' },
      match: 'starred repos',
      variables: {
        action: 'MY_STARS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/${username}?tab=stars`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Lists',
      icon: { path: 'icons/list.png' },
      match: 'lists',
      variables: {
        action: 'MY_LISTS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/${username}?tab=stars`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Watching Repos',
      icon: { path: 'icons/repo_watch.png' },
      match: 'watching',
      variables: {
        action: 'MY_WATCHING',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/${username}?tab=watching`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Gists',
      icon: { path: 'icons/gist.png' },
      match: 'gists',
      variables: {
        action: 'MY_GISTS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${gistUrl}/${username}`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Starred Gists',
      icon: { path: 'icons/gist_star.png' },
      match: 'starred gists',
      variables: {
        action: 'MY_STARRED_GISTS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${gistUrl}/${username}/starred`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Following Users',
      icon: { path: 'icons/user_follow.png' },
      match: 'following user',
      variables: {
        action: 'MY_FOLLOWING',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/${username}?tab=following`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Issues',
      icon: { path: 'icons/issue.png' },
      match: 'issues',
      variables: {
        action: 'MY_ISSUES',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/issues`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Pull Requests',
      icon: { path: 'icons/pullRequest.png' },
      match: 'prs pull requests',
      variables: {
        action: 'MY_PRS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/pulls`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Notifications',
      icon: { path: 'icons/notification.png' },
      match: 'notifications',
      variables: {
        action: 'MY_NOTIFICATIONS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/notifications`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Projects',
      icon: { path: 'icons/project.png' },
      match: 'projects',
      variables: {
        action: 'MY_PROJECTS',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/${username}?tab=projects`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Codespaces',
      icon: { path: 'icons/codespace.png' },
      match: 'codespaces',
      variables: {
        action: 'MY_CODESPACES',
        options: JSON.stringify({ multiPages: true }),
        menu_path: this.#pathVar(),
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/codespaces`,
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'My Profile',
      icon: { path: 'icons/profile.png' },
      arg: `${baseUrl}/${username}`,
      match: 'profile',
      variables: { execute: 'open_link' },
    });
    this.Workflow.addItem({
      title: 'My Settings',
      icon: { path: 'icons/settings.png' },
      arg: `${baseUrl}/settings`,
      match: 'settings',
      variables: { execute: 'open_link' },
    });
    this.Workflow.addItem({
      title: 'My Tokens',
      icon: { path: 'icons/token.png' },
      arg: `${baseUrl}/settings/tokens`,
      match: 'tokens',
      variables: { execute: 'open_link' },
    });
    this.Workflow.addItem({
      title: 'My Keys',
      subtitle: 'Copy keys',
      icon: { path: 'icons/key.png' },
      arg: `${baseUrl}/settings/keys`,
      match: 'keys',
      variables: { execute: 'command', command: 'copy_keys' },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          variables: { execute: 'open_link' },
        },
      },
    });
    this.Workflow.addItem({
      title: 'New Repository',
      icon: { path: 'icons/repo_new.png' },
      match: 'new repo',
      variables: { action: 'CREATE_REPO', options: '' },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: `${baseUrl}/new`,
          variables: { execute: 'open_link' },
        },
      },
    });
  }

  async myRelatedRepos() {
    const promises = Cache.myRelatedRepos.map(([action, options]) =>
      this.#Cache.request(action, options).catch((e) => {
        console.error(e.message);
        return {};
      }),
    );
    const repos = [];
    (await Promise.all(promises))
      .map(p => p.data?.map(node => ({ ...node, prevId: p.id })) || [])
      .flat()
      .map(node =>
        node.id.startsWith('R_')
          ? node
          : { ...node.repository, prevId: node.prevId },
      )
      .forEach(
        node => repos.find(n => n.id === node.id) || repos.push(node),
      );
    repos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    repos.forEach(repo => this.formatOutput([repo], repo.prevId));
  }

  async mainMenu(input) {
    this.#menuPath = ['main:'];
    const { baseUrl } = this.#Cache;
    if (!input) {
      this.Workflow.addItem({
        title: 'My Resources',
        autocomplete: '.',
        icon: { path: 'icons/me.png' },
        valid: false,
      });
    } else {
      await this.myRelatedRepos();
      this.Workflow.filter(input);
    }
    this.Workflow.addItem({
      title: 'Search Repositories',
      icon: { path: 'icons/repo.png' },
      arg: input,
      valid: !!input,
      variables: { action: 'SEARCH_REPO', menu_path: this.#pathVar() },
      mods: {
        cmd: {
          subtitle: 'Search in browser',
          variables: { execute: 'open_link' },
          arg: `${baseUrl}/search?q=${encodeURIComponent(
            input,
          )}&type=repositories`,
        },
      },
    });
    this.Workflow.addItem({
      title: 'Search Users',
      icon: { path: 'icons/user.png' },
      arg: input,
      valid: !!input,
      variables: { action: 'SEARCH_USER', menu_path: this.#pathVar() },
      mods: {
        cmd: {
          subtitle: 'Search in browser',
          variables: { execute: 'open_link' },
          arg: `${baseUrl}/search?q=${encodeURIComponent(input)}&type=users`,
        },
      },
    });
    this.Workflow.addItem({
      title: 'Search Issues',
      icon: { path: 'icons/issue.png' },
      arg: input,
      valid: !!input,
      variables: { action: 'SEARCH_ISSUE', menu_path: this.#pathVar() },
      mods: {
        cmd: {
          subtitle: 'Search in browser',
          variables: { execute: 'open_link' },
          arg: `${baseUrl}/search?q=${encodeURIComponent(input)}&type=issues`,
        },
      },
    });
    this.Workflow.addItem({
      title: 'Search Topics',
      icon: { path: 'icons/topic.png' },
      variables: {
        action: 'SEARCH_TOPIC',
        options: JSON.stringify({ q: input }),
        menu_path: this.#pathVar(),
      },
      arg: input,
      valid: !!input,
      mods: {
        cmd: {
          subtitle: 'Search in browser',
          variables: { execute: 'open_link' },
          arg: `${baseUrl}/search?q=${encodeURIComponent(input)}&type=topics`,
        },
      },
    });
  }

  async search(q, action = 'SEARCH_REPO', path = []) {
    if (!action.startsWith('SEARCH_'))
      throw new Error('Invalid action.');
    try {
      const { data, id } = await this.#Cache.request(action, { q });
      if (!data?.length) {
        this.#menuPath = [...path, ''];
        this.Workflow.warnEmpty('No Results Found.');
        return;
      }
      this.#menuPath = [...path, `${id}:`];
      this.formatOutput(data, id);
    } catch (e) {
      this.#menuPath = [...path, ''];
      this.Workflow.warnEmpty(`Error: ${e.message}`);
    }
  }

  /**
   * format output based on node type
   * @param {Array} nodes
   * @param {number} id
   */
  formatOutput(nodes, id) {
    const lookUp = {
      R: this.#formatRepo,
      U: this.#formatUser,
      O: this.#formatUser,
      G: this.#formatGist,
      UL: this.#formatList,
      I: this.#formatIssue,
      PR: this.#formatIssue,
      RE: this.#formatRelease,
      RA: this.#formatAsset,
      PVT: this.#formatProject,
    };
    nodes.forEach((node) => {
      if (node.id?.split('_')[0] in lookUp) {
        lookUp[node.id.split('_')[0]].call(this, node, id);
      } else if (['tree', 'blob'].includes(node.type)) {
        this.#formatTree(node);
      } else if (node.thread_id) {
        this.#formatNotification(node);
      } else if (node.score !== undefined) {
        this.#formatTopic(node);
      } else if (node.git_status) {
        this.#formatCodespace(node);
      }
    });
  }

  #formatRepo(repo, id) {
    const name = repo.nameWithOwner;
    const starred = repo.viewerHasStarred ? '􀋂' : '';
    const watched = repo.viewerSubscription === 'SUBSCRIBED' ? '􀋙' : '';
    const lang = repo.primaryLanguage?.name;
    const stars = convertNum(repo.stargazerCount);
    const updated = datetimeFormat(repo.updatedAt);
    const fork = repo.parent ? `􀙠 ${repo.parent.nameWithOwner}` : '';
    const title = [`${name} `, starred, watched].filter(Boolean).join(' ');
    const subtitle = [lang, stars ? `􀋂 ${stars}` : '', updated, fork]
      .filter(Boolean)
      .join(' · ');
    this.Workflow.addItem({
      title,
      subtitle,
      arg: repo.url,
      autocomplete: repo.nameWithOwner,
      variables: { execute: 'open_link' },
      match: matchStr(repo.nameWithOwner),
      icon: {
        path: `icons/repo${
          repo.isPrivate ? '_private' : repo.viewerHasStarred ? '_star' : ''
        }.png`,
      },
      text: {
        largetype: repo.description,
        copy: repo.name,
      },
      mods: {
        cmd: {
          subtitle: 'Open menu',
          variables: { menu_path: this.#submenuPath(id, repo.id), action: '' },
          icon: { path: 'icons/menu.png' },
          arg: '',
        },
        alt: { subtitle: repo.description || '', valid: !1 },
      },
    });
  }

  #formatUser(user, id) {
    const name = `${user.login}${user.name ? `  (${user.name}) ` : ''}`;
    const followed = user.viewerIsFollowing ? '􀋭' : '';
    const verified = user.isVerified ? '􀇺' : '';
    const title = [name, verified, followed].filter(Boolean).join(' ');
    const followers = convertNum(user.followers?.totalCount);
    const repos = convertNum(user.repositories.totalCount);
    const subtitle = [
      followers ? `􀉬 ${followers}` : '',
      repos ? `􀤞 ${repos}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    this.Workflow.addItem({
      title,
      subtitle,
      arg: user.url,
      autocomplete: user.login,
      icon: {
        path: `icons/${
          user.id.startsWith('U') ? 'user' : 'organization'
        }${
          user.viewerIsFollowing ? '_follow' : ''
        }.png`,
      },
      variables: { execute: 'open_link' },
      match: matchStr(user.login),
      text: {
        largetype: user.bio || user.description,
        copy: user.login,
      },
      mods: {
        cmd: {
          subtitle: 'Open menu',
          variables: { menu_path: this.#submenuPath(id, user.id), action: '' },
          icon: { path: 'icons/menu.png' },
          arg: '',
        },
        alt: { subtitle: user.bio || user.description || '', valid: !1 },
      },
    });
  }

  #formatGist(gist) {
    const name = `${gist.owner}/${gist.files[0].name}`;
    const title = `${name}  ${gist.public ? '' : '􀎡'}`;
    const subtitle = `􀈷 ${gist.files.length} · 􀣔 ${datetimeFormat(
      gist.updatedAt,
    )}`;
    this.Workflow.addItem({
      title,
      subtitle,
      arg: gist.url,
      icon: { path: 'icons/gist.png' },
      variables: { execute: 'open_link' },
      match: matchStr(name),
      text: {
        largetype: gist.description,
      },
      mods: {
        cmd: {
          subtitle: 'Copy raw URL(s)',
          arg: gist.files.map(f => f.url),
          variables: { execute: 'copy' },
        },
        alt: { subtitle: gist.description || '', valid: !1 },
      },
    });
  }

  #formatList(list, id) {
    const title = `${list.name}  ${list.isPrivate ? '􀎡' : ''}`;
    const subtitle = `${list.items.totalCount} repo${list.items.totalCount > 1 ? 's' : ''}`;
    this.Workflow.addItem({
      title,
      subtitle,
      icon: { path: 'icons/list.png' },
      text: {
        largetype: list.description,
      },
      variables: {
        action: 'NODES',
        options: JSON.stringify({
          ids: list.items.nodes.map(n => n.id),
        }),
        menu_path: this.#nodeParentPath(id),
      },
      match: matchStr(list.name),
      mods: {
        alt: { subtitle: list.description || '', valid: !1 },
      },
    });
  }

  #formatIssue(issue) {
    const checkState = issue.statusCheckRollup?.state;
    const stateIcons = {
      SUCCESS: '􀆅 ',
      FAILURE: '􀆄 ',
      EXPECTED: '􀆊 ',
      PENDING: '􀖇 ',
      ERROR: '􀅎 ',
    };
    const title = [
      stateIcons[checkState],
      issue.title,
      issue.viewerSubscription === 'SUBSCRIBED' ? '  􀋙' : '',
    ]
      .filter(Boolean)
      .join('');
    const comments = convertNum(issue.comments.totalCount);
    const updated = datetimeFormat(issue.updatedAt);
    const subtitle = [
      `${issue.repository.nameWithOwner} #${issue.number}`,
      updated,
      comments ? `􀕺 ${comments}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const icon = `icons/${
      issue.id.startsWith('I') ? 'issue' : 'pullRequest'
    }_${issue.state.toLowerCase()}.png`;
    this.Workflow.addItem({
      title,
      subtitle,
      arg: issue.url,
      variables: { execute: 'open_link' },
      match: matchStr(issue.title),
      icon: { path: icon },
      text: {
        largetype: issue.bodyText,
      },
      mods: {
        alt: { subtitle: issue.bodyText, valid: !1 },
      },
    });
  }

  #formatRelease(release, id) {
    const tag = release.tagName && release.tagName !== release.name
      ? ` (􀋡 ${release.tagName})`
      : '';
    const title = `${release.name}${tag}  ${release.isPrerelease ? '🚧' : ''}`;
    const assets = release.releaseAssets.totalCount
      ? `􀐚 ${release.releaseAssets.totalCount}`
      : '';
    const subtitle = [datetimeFormat(release.publishedAt), assets]
      .filter(Boolean)
      .join(' · ');
    this.Workflow.addItem({
      title,
      subtitle,
      valid: !!assets,
      icon: { path: 'icons/release.png' },
      variables: {
        action: 'RELEASE_ASSETS',
        options: JSON.stringify({ id: release.id }),
        menu_path: this.#nodeParentPath(id),
      },
      quicklookurl: release.url,
      match: matchStr(release.name, release.tagName),
      text: {
        largetype: release.description,
      },
      mods: {
        shift: {
          subtitle: 'Open in browser',
          arg: release.url,
          variables: { execute: 'open_link' },
        },
        alt: { subtitle: release.description || '', valid: !1 },
      },
    });
  }

  #formatAsset(asset) {
    const title = asset.name;
    const subtitle = [
      asset.downloadCount ? `􀈄 ${asset.downloadCount}` : '',
      convertSize(asset.size),
    ]
      .filter(Boolean)
      .join(' · ');
    this.Workflow.addItem({
      title,
      subtitle,
      arg: asset.downloadUrl,
      match: matchStr(asset.name),
      variables: { execute: 'open_link' },
      icon: { path: 'icons/asset.png' },
      text: { largetype: asset.description },
      mods: {
        alt: { subtitle: asset.description || '', valid: !1 },
      },
    });
  }

  #formatTree(tree) {
    const { path, type, size, url } = tree;
    this.Workflow.addItem({
      title: path,
      subtitle: convertSize(size),
      quicklookurl: url,
      match: matchStr(path),
      valid: type === 'blob',
      autocomplete: type === 'tree' ? `${path}/` : undefined,
      arg: type === 'blob' ? url.replace('/blob/', '/raw/') : undefined,
      variables: { execute: 'open_link' },
      icon: { path: `icons/${type === 'tree' ? 'folder' : 'file'}.png` },
    });
  }

  #formatNotification(notification) {
    const { title, url, repo, updated_at, tag, thread_id, type, state } = notification;
    const icon = ['Issue', 'PullRequest'].includes(type)
      ? `${type.toLowerCase()}_${state}`
      : type.toLowerCase();
    this.Workflow.addItem({
      title,
      subtitle: `${repo}${tag ? `  􀆃${tag}` : ''}  􁙜 ${datetimeFormat(updated_at)}`,
      arg: url,
      match: matchStr(title, repo),
      icon: { path: `icons/${icon}.png` },
      variables: { execute: 'open_link' },
      mods: {
        cmd: {
          subtitle: 'Mark as read',
          variables: {
            execute: 'action',
            action: 'MARK_NOTIFICATION_AS_READ',
            options: JSON.stringify({ thread_id }),
          },
          icon: { path: 'icons/unseen.png' },
        },
        alt: {
          subtitle: 'Unsubscribe',
          variables: {
            execute: 'action',
            action: 'UNSUBSCRIBE_NOTIFICATION',
            options: JSON.stringify({ thread_id }),
          },
          icon: { path: 'icons/unsubscribe.png' },
        },
      },
    });
  }

  #formatTopic(topic) {
    const { name, display_name, short_description, description } = topic;
    this.Workflow.addItem({
      title: display_name || name,
      subtitle: short_description || description || '',
      arg: `${this.#Cache.baseUrl}/topics/${name}`,
      icon: { path: 'icons/topic.png' },
      variables: { execute: 'open_link' },
      text: {
        largetype: short_description || description,
        copy: name,
      },
    });
  }

  #formatCodespace(codespace) {
    const { name, state, repository, url, git_status, last_used_at } = codespace;
    this.Workflow.addItem({
      title: `${repository}  ·  􀙠 ${git_status.ref}`,
      subtitle: `${state}, 􀣔 ${datetimeFormat(last_used_at)}`,
      arg: url,
      icon: { path: 'icons/codespace.png' },
      variables: { execute: 'open_link' },
      mods: {
        cmd: {
          subtitle: 'Open repository in browser',
          arg: `${this.#Cache.baseUrl}/${repository}`,
          icon: { path: 'icons/repo.png' },
        },
        alt: {
          subtitle: 'Open codespace in VS Code',
          arg: `${this.#Cache.baseUrl}/codespaces/${name}?editor=vscode`,
          icon: { path: 'icons/vscode.png' },
        },
      },
    });
  }

  #formatProject(project) {
    const {
      title,
      public: _public,
      url,
      shortDescription,
      updatedAt,
    } = project;
    this.Workflow.addItem({
      title,
      subtitle: shortDescription,
      arg: url,
      icon: { path: `icons/project${_public ? '' : '_private'}.png` },
      variables: { execute: 'open_link' },
      mods: {
        cmd: { subtitle: `􀣔 ${datetimeFormat(updatedAt)}`, valid: !1 },
      },
    });
  }

  /**
   * Render a node submenu. `prevId` is the cached list the node came from (a
   * lookup shortcut; may be a sentinel like -1), `prevNodeId` is the node id.
   * @param {number|string} prevId
   * @param {string} prevNodeId
   */
  async subMenu(prevId, prevNodeId) {
    const nodes = this.#Cache.requestCacheById(prevId)?.data;
    try {
      const node = nodes?.find(n => n.id === prevNodeId)
        || (await this.#Cache.request('NODES', { ids: [prevNodeId] })).data?.[0];
      if (prevNodeId.startsWith('R_')) {
        this.#repoMenu(node);
      } else {
        this.#userMenu(node);
      }
    } catch (e) {
      this.Workflow.warnEmpty(`Error: ${e.message}`);
    }
  }

  #repoMenu(repo) {
    if (!repo) {
      this.Workflow.warnEmpty('Repo Not Found.');
      return;
    }
    const [owner, name] = repo.nameWithOwner.split('/');
    this.Workflow.addItem({
      title: repo.nameWithOwner,
      subtitle: 'Open in browser',
      icon: {
        path: `icons/repo${
          repo.isPrivate ? '_private' : repo.viewerHasStarred ? '_star' : ''
        }.png`,
      },
      match: 'wiki homepage ssh url link',
      quicklookurl: repo.url,
      arg: repo.url,
      text: {
        largetype: repo.description,
        copy: repo.nameWithOwner,
      },
      variables: { execute: 'open_link' },
      mods: {
        cmd: repo.hasWikiEnabled
          ? {
              subtitle: 'Open wiki',
              variables: { execute: 'open_link' },
              arg: `${repo.url}/wiki`,
              icon: { path: 'icons/wiki.png' },
            }
          : undefined,
        alt: repo.homepageUrl
          ? {
              subtitle: 'Open homepage',
              variables: { execute: 'open_link' },
              arg: repo.homepageUrl,
              icon: { path: 'icons/website.png' },
            }
          : undefined,
        shift: {
          subtitle: 'Copy SSH url',
          arg: repo.sshUrl,
          variables: { execute: 'copy' },
          icon: { path: 'icons/clone.png' },
        },
        ctrl: {
          subtitle: 'Open repo in VS Code',
          arg: `code --folder-uri vscode-vfs://github/${repo.nameWithOwner}`,
          variables: { execute: 'shell' },
          icon: { path: 'icons/vscode.png' },
        },
      },
    });
    this.Workflow.addItem({
      title: owner,
      icon: {
        path: `icons/${repo.owner.id.startsWith('U') ? 'user' : 'organization'}.png`,
      },
      match: `user ${owner}`,
      quicklookurl: repo.url.replace(`/${name}`, ''),
      variables: {
        menu_path: this.#childPath(`-1:${repo.owner.id}`),
        action: '',
      },
    });
    repo.issues.totalCount
    && this.Workflow.addItem({
      title: 'Issues',
      subtitle: `${repo.issues.totalCount} issue${
        repo.issues.totalCount > 1 ? 's' : ''
      }`,
      icon: { path: 'icons/issue.png' },
      match: 'issues',
      quicklookurl: `${repo.url}/issues`,
      variables: {
        action: 'SEARCH_ISSUE',
        queryPrefix: `repo:${repo.nameWithOwner} state:open, type:issue`,
        menu_path: this.#pathVar(),
      },
      mods: {
        cmd: {
          subtitle: 'Open in browser',
          variables: { execute: 'open_link' },
          arg: `${repo.url}/issues`,
        },
      },
    });
    repo.pullRequests.totalCount
    && this.Workflow.addItem({
      title: 'Pull Requests',
      subtitle: `${repo.pullRequests.totalCount} pull request${
        repo.pullRequests.totalCount > 1 ? 's' : ''
      }`,
      icon: { path: 'icons/pullRequest.png' },
      match: 'prs pull requests',
      quicklookurl: `${repo.url}/pulls`,
      variables: {
        action: 'SEARCH_ISSUE',
        queryPrefix: `repo:${repo.nameWithOwner} state:open, type:pr`,
        menu_path: this.#pathVar(),
      },
      mods: {
        cmd: {
          subtitle: 'Open in browser',
          variables: { execute: 'open_link' },
          arg: `${repo.url}/pulls`,
        },
      },
    });
    repo.releases.totalCount
    && this.Workflow.addItem({
      title: 'Releases',
      icon: { path: 'icons/release.png' },
      match: 'releases',
      quicklookurl: `${repo.url}/releases`,
      variables: {
        action: 'REPO_RELEASES',
        options: JSON.stringify({ owner, name }),
        menu_path: this.#pathVar(),
      },
    });
    this.Workflow.addItem({
      title: 'Tree',
      icon: { path: 'icons/tree.png' },
      quicklookurl: `${repo.url}?search=1`,
      match: 'tree',
      variables: {
        action: 'REPO_TREE',
        options: JSON.stringify({ owner, name }),
        menu_path: this.#pathVar(),
      },
    });
    if (owner !== this.#Cache.username) {
      this.Workflow.addItem({
        title: repo.viewerHasStarred ? 'Unstar Repo' : 'Star Repo',
        icon: { path: 'icons/star.png' },
        match: 'star',
        variables: {
          execute: 'action',
          action: 'STAR',
          options: JSON.stringify({
            id: repo.id,
            unstar: !!repo.viewerHasStarred,
          }),
        },
      });
      this.Workflow.addItem({
        title:
          repo.viewerSubscription === 'SUBSCRIBED'
            ? 'Unwatch Repo'
            : 'Watch Repo',
        icon: {
          path: `icons/${
            repo.viewerSubscription === 'SUBSCRIBED' ? 'unseen' : 'watching'
          }.png`,
        },
        match: 'watch subscribe',
        variables: {
          execute: 'action',
          action: 'SUBSCRIBE',
          options: JSON.stringify({
            id: repo.id,
            state:
              repo.viewerSubscription === 'SUBSCRIBED'
                ? 'UNSUBSCRIBED'
                : 'SUBSCRIBED',
          }),
        },
      });
      this.Workflow.addItem({
        title: 'Fork Repo',
        icon: { path: 'icons/fork.png' },
        match: 'fork',
        quicklookurl: `${repo.url}/fork`,
        variables: {
          action: 'FORK_REPO',
          options: JSON.stringify({ owner, repo: name }),
          menu_path: this.#pathVar(),
        },
        mods: {
          cmd: {
            subtitle: 'Open in browser',
            variables: { execute: 'open_link' },
            arg: `${repo.url}/fork`,
          },
          alt: {
            subtitle: 'With all branches',
            variables: {
              action: 'FORK_REPO',
              options: JSON.stringify({ owner, repo: name, default_branch_only: false }),
              menu_path: this.#pathVar(),
            },
          },
        },
      });
    }
    if (repo.parent) {
      this.Workflow.addItem({
        title: repo.parent.nameWithOwner,
        subtitle: 'Open menu',
        icon: { path: 'icons/fork.png' },
        match: 'fork',
        quicklookurl: repo.parent.url,
        text: { copy: repo.parent.nameWithOwner },
        variables: {
          menu_path: this.#childPath(`-1:${repo.parent.id}`),
          action: '',
        },
        mods: {
          shift: {
            subtitle: 'Open in browser',
            variables: { execute: 'open_link' },
            arg: repo.parent.url,
          },
        },
      });
    }
  }

  #userMenu(user) {
    if (!user) {
      this.Workflow.warnEmpty('User Not Found.');
      return;
    }
    this.Workflow.addItem({
      title: `${user.login}${user.name ? `  (${user.name}) ` : ''}`,
      subtitle: 'Open in browser',
      icon: {
        path: `icons/${
          user.id.startsWith('U') ? 'user' : 'organization'
        }${
          user.viewerIsFollowing ? '_follow' : ''
        }.png`,
      },
      text: {
        largetype: user.bio || user.description,
        copy: user.login,
      },
      match: 'profile homepage url link',
      arg: user.url,
      variables: { execute: 'open_link' },
      mods: {
        cmd: user.websiteUrl
          ? {
              subtitle: 'Open website',
              variables: { execute: 'open_link' },
              arg: user.websiteUrl,
              icon: { path: 'icons/website.png' },
            }
          : undefined,
      },
    });
    user.repositories.totalCount
    && this.Workflow.addItem({
      title: 'Repositories',
      subtitle: `${user.repositories.totalCount} repo${
        user.repositories.totalCount > 1 ? 's' : ''
      }`,
      icon: { path: 'icons/repo.png' },
      match: 'repos',
      variables: {
        action: 'SEARCH_REPO',
        queryPrefix: `${user.id.startsWith('U') ? 'user' : 'org'}:${user.login}`,
        menu_path: this.#pathVar(),
      },
      mods: {
        cmd: {
          subtitle: 'Open in browser',
          variables: { execute: 'open_link' },
          arg: `${user.url}?tab=repositories`,
        },
      },
    });
    user.isViewer
    || this.Workflow.addItem({
      title: user.viewerIsFollowing ? 'Unfollow User' : 'Follow User',
      icon: { path: 'icons/follow.png' },
      match: 'follow',
      variables: {
        execute: 'action',
        action: user.viewerIsFollowing ? 'UNFOLLOW' : 'FOLLOW',
        options: JSON.stringify({
          id: user.id,
          org: user.id.startsWith('O'),
        }),
      },
    });
  }

  async createRepo(input) {
    this.#menuPath = ['main:'];
    const options = JSON.parse(process.env.options || '{}');
    if (!options.name) {
      const nameWithOwner = `${this.#Cache.username}/${input}`;
      let valid = /^[\w\-.]{1,100}$/.test(input) && !/^[.-]|[.-]$|--/.test(input);
      let message = input.length === 0 || valid ? '' : '􀇾 Invalid repository name';
      if (valid) {
        try {
          const { data: myRepos } = await this.#Cache.requestCache('MY_REPOS', {
            multiPages: true,
          });
          if (myRepos.some(r => r.nameWithOwner === nameWithOwner)) {
            valid = !1;
            message = '􀇾 Repository already exists';
          }
        } catch {}
      }
      this.Workflow.addItem({
        title: nameWithOwner || 'Enter repository name',
        subtitle: message || 'Create public repository',
        icon: { path: 'icons/repo.png' },
        valid,
        variables: {
          action: 'CREATE_REPO',
          options: JSON.stringify({ name: input }),
        },
        mods: {
          cmd: {
            subtitle: message || 'Create private repository',
            icon: { path: 'icons/repo_private.png' },
            valid,
            variables: {
              action: 'CREATE_REPO',
              options: JSON.stringify({ name: input, visibility: 'PRIVATE' }),
            },
          },
          shift: {
            subtitle: 'Open in browser',
            arg: `https://github.com/new?name=${encodeURIComponent(input)}`,
            variables: { execute: 'open_link' },
          },
        },
      });
    } else {
      try {
        const { data } = await this.#Cache.request('CREATE_REPO', options);
        this.#menuPath = ['main:', `-1:${data.id}`];
        this.#repoMenu(data);
      } catch (e) {
        console.error(e.message);
        this.Workflow.warnEmpty(`Error: ${e.message}`);
      }
    }
  }

  async forkRepo() {
    const options = JSON.parse(process.env.options || '{}');
    try {
      const { data } = await this.#Cache.request('FORK_REPO', options);
      this.#menuPath = ['main:', `-1:${data.id}`];
      this.#repoMenu(data);
    } catch (e) {
      console.error(e.message);
      this.Workflow.warnEmpty(`Error: ${e.message}`);
    }
  }

  #copyKeys() {
    const url = `${this.#Cache.baseUrl}/${this.#Cache.username}.keys`;
    fetch(url).then(res => res.text()).then(input => spawnSync('pbcopy', [], { input }));
  }

  runCommand(command, input) {
    switch (command) {
      case 'set_enterprise_url':
        this.#Cache.baseUrl = input;
        notify('Enterprise URL set', input);
        break;
      case 'del_enterprise_url':
        this.#Cache.baseUrl = '';
        notify('Enterprise URL deleted');
        break;
      case 'set_gist_url':
        this.#Cache.gistUrl = input;
        notify('Gist URL set', input);
        break;
      case 'del_gist_url':
        this.#Cache.gistUrl = '';
        notify('Gist URL deleted');
        break;
      case 'set_access_token':
        this.#Cache.accessToken = input;
        notify('Personal Access Token set');
        break;
      case 'del_access_token':
        this.#Cache.accessToken = '';
        notify('Personal Access Token deleted');
        break;
      case 'clear_cache':
        this.#Cache.clearCache(!0);
        notify('Cache cleared');
        break;
      case 'copy_keys':
        this.#copyKeys();
        notify('Public keys copied');
        break;
    }
  }

  logIn(input) {
    const { accessToken, baseUrl, gistUrl } = this.#Cache;
    this.Workflow.addItem({
      title: `Set Personal Access Token${input ? `: ${input}` : ''}`,
      subtitle: accessToken
        ? `${accessToken.match(/^(gh[a-z]|github_pat)_/)?.[0] || ''}***`
        : '',
      arg: input,
      valid: !!input,
      icon: { path: 'icons/login.png' },
      variables: { execute: 'command', command: 'set_access_token' },
      mods: {
        cmd: accessToken
          ? {
              subtitle: 'Delete token',
              variables: { execute: 'command', command: 'del_access_token' },
              icon: { path: 'icons/delete.png' },
            }
          : undefined,
      },
    });
    if (this.#enterprise) {
      this.Workflow.addItem({
        title: `Set Enterprise URL${input ? `: ${input}` : ''}`,
        subtitle: baseUrl ? `Current: ${baseUrl}` : '',
        arg: input,
        valid: !!input,
        icon: { path: 'icon.png' },
        variables: { execute: 'command', command: 'set_enterprise_url' },
        mods: {
          cmd: {
            subtitle: 'Delete enterprise URL',
            variables: { execute: 'command', command: 'del_enterprise_url' },
            icon: { path: 'icons/delete.png' },
          },
        },
      });
      this.Workflow.addItem({
        title: `Set Gist URL${input ? `: ${input}` : ''}`,
        subtitle: gistUrl ? `Current: ${gistUrl}` : '',
        arg: input,
        valid: !!input,
        icon: { path: 'icons/gist.png' },
        variables: { execute: 'command', command: 'set_gist_url' },
        mods: {
          cmd: {
            subtitle: 'Delete gist URL',
            variables: { execute: 'command', command: 'del_gist_url' },
            icon: { path: 'icons/delete.png' },
          },
        },
      });
    }
  }

  config(input) {
    this.logIn(input);
    this.Workflow.addItem({
      title: 'Clear Cache',
      icon: { path: 'icons/clear_cache.png' },
      variables: { execute: 'command', command: 'clear_cache' },
    });
  }

  notifyAction(action, data) {
    switch (action) {
      case 'MARK_NOTIFICATION_AS_READ':
        notify('Notification marked as read');
        break;
      case 'STAR': {
        const name = data.nameWithOwner || data.name;
        notify(`${data.viewerHasStarred ? 'Starred' : 'Unstarred'} ${name}`);
        break;
      }
      case 'SUBSCRIBE': {
        const name = data.nameWithOwner
          || `${data.repository.nameWithOwner} #${data.number}`;
        notify(
          `${
            data.viewerSubscription === 'SUBSCRIBED' ? 'Watching' : 'Unwatched'
          } ${name}`,
        );
        break;
      }
      case 'FOLLOW':
      case 'UNFOLLOW': {
        notify(
          `${data.viewerIsFollowing ? 'Following' : 'Unfollowed'} ${data.login}`,
        );
        break;
      }
    }
    this.#Cache.refresh(!0);
  }
}

export default Interface;

if (fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  new Interface().run(process.argv[2]?.trim());
}
