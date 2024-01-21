#!/usr/bin/env node
"use strict";
import Workflow from "./workflow.js";
import Cache from "./cache.js";
import {
  datetimeFormat,
  convertNum,
  convertSize,
  matchStr,
  notify,
} from "./utils.js";
import { fileURLToPath } from "url";

class Interface {
  Workflow;
  #Cache;
  #enterprise = !!process.env.enterprise;
  #prevId = "main";
  #prevNodeId;
  #debug = !!process.env.alfred_debug;

  constructor() {
    this.Workflow = new Workflow();
    this.#Cache = new Cache();
  }

  async run(query = "") {
    if (!this.#Cache.loggedIn) {
      return this.logIn(query);
    } else {
      this.#Cache.refreshInBackground();
    }
    if (parseInt(process.env.back)) {
      if (this.#debug) console.error(1, process.env.back, process.env.prevNodeId);
      let row = this.#Cache.requestCacheById(process.env.back);
      this.Workflow.setVar("back", "");
      if (row?.data) {
        if (process.env.prevNodeId) {
          this.#prevId = process.env.back;
          this.#prevNodeId = process.env.prevNodeId;
          await this.subMenu(query);
        } else {
          this.formatOutput(row.data, row.id);
          this.Workflow.filter(query);
        }
        this.#prevId = row.prevId || this.#prevId;
        this.#prevNodeId = row.prevNodeId;
      } else {
        await this.mainMenu();
      }
    } else if (process.env.action?.startsWith("SEARCH_")) {
      if (this.#debug) console.error(2, process.env.action);
      await this.search(query, process.env.action);
    } else if (process.env.action) {
      if (this.#debug) console.error(3, process.env.action, process.env.prevId, process.env.prevNodeId);
      let action = process.env.action;
      this.#prevId = process.env.prevId || this.#prevId;
      this.#prevNodeId = process.env.prevNodeId;
      let options = JSON.parse(process.env.options || "{}");
      try {
        let { id, data } = await this.#Cache.request(action, options, null, this.#prevId, this.#prevNodeId);
        if (Cache.noCacheActions.includes(action)) {
          return this.notifyAction(action, data);
        } else if (!data?.length) {
          this.Workflow.warnEmpty("No Results Found.");
        } else {
          this.formatOutput(data, id);
          this.Workflow.filter(query);
        }
      } catch (e) {
        console.error(e.message);
        if (Cache.noCacheActions.includes(action)) {
          return notify("Error: " + e.message);
        } else {
          this.Workflow.warnEmpty("Error: " + e.message);
        }
      }
    } else if (
      process.env.prevNodeId && parseInt(process.env.prevId)
    ) {
      if (this.#debug)
          console.error(
              4,
              process.env.prevId,
              process.env.prevNodeId
          );
      this.#prevId = process.env.prevId;
      this.#prevNodeId = process.env.prevNodeId;
      this.Workflow.setVar("prevId", "");
      await this.subMenu(query);
    } else if (process.env.command) {
      if (this.#debug) console.error(5, process.env.command);
      return this.runCommand(process.env.command, query);
    } else if (process.env.config) {
      if (this.#debug) console.error(6, process.env.config);
      this.config(query);
    } else if (query.startsWith(".")) {
      if (this.#debug) console.error(7);
      this.myMenu();
      this.Workflow.filter(query.slice(1));
    } else {
      if (this.#debug) console.error(8);
      await this.mainMenu(query);
    }
    if (this.#prevId)
      this.Workflow.addItem({
        title: "Back",
        icon: { path: "icons/back.png" },
        variables: {
          back: this.#prevId,
          prevNodeId: this.#prevNodeId,
          action: "",
        },
      });
    return this.Workflow.output();
  }

  myMenu() {
    this.#prevId = null;
    this.#prevNodeId = null;
    const { baseUrl, username } = this.#Cache;
    this.Workflow.addItem({
      title: "My Repos",
      icon: { path: "icons/repo.png" },
      match: "repos",
      variables: {
        action: "MY_REPOS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Starred Repos",
      icon: { path: "icons/repo_star.png" },
      match: "starred repos",
      variables: {
        action: "MY_STARS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Lists",
      icon: { path: "icons/list.png" },
      match: "lists",
      variables: {
        action: "MY_LISTS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Watching Repos",
      icon: { path: "icons/watching.png" },
      match: "watching",
      variables: {
        action: "MY_WATCHING",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Gists",
      icon: { path: "icons/gist.png" },
      match: "gists",
      variables: {
        action: "MY_GISTS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Starred Gists",
      icon: { path: "icons/gist_star.png" },
      match: "starred gists",
      variables: {
        action: "MY_STARRED_GISTS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Following Users",
      icon: { path: "icons/user_follow.png" },
      match: "following user",
      variables: {
        action: "MY_FOLLOWING",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Issues",
      icon: { path: "icons/issue.png" },
      match: "issues",
      variables: {
        action: "MY_ISSUES",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Pull Requests",
      icon: { path: "icons/pr.png" },
      match: "prs pull requests",
      variables: {
        action: "MY_PRS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Notifications",
      icon: { path: "icons/notification.png" },
      match: "notifications",
      variables: {
        action: "MY_NOTIFICATIONS",
        options: JSON.stringify({ multiPages: true }),
      },
    });
    this.Workflow.addItem({
      title: "My Profile",
      icon: { path: "icons/profile.png" },
      arg: `${baseUrl}/${username}`,
      match: "profile",
      variables: { execute: "open_link" },
    });
    this.Workflow.addItem({
      title: "My Settings",
      icon: { path: "icons/settings.png" },
      arg: `${baseUrl}/settings`,
      match: "settings",
      variables: { execute: "open_link" },
    });
    this.Workflow.addItem({
      title: "My Tokens",
      icon: { path: "icons/token.png" },
      arg: `${baseUrl}/settings/tokens`,
      match: "tokens",
      variables: { execute: "open_link" },
    });
    this.Workflow.addItem({
      title: "New Repository",
      icon: { path: "icons/repo_new.png" },
      arg: `${baseUrl}/new`,
      match: "new repo",
      variables: { execute: "open_link" },
    });
  }

  async myRelatedRepos() {
    let promises = Cache.myRelatedRepos.map(([action, options]) =>
      this.#Cache.request(action, options).catch((e) => {
        console.error(e.message);
        return {};
      })
    );
    let repos = [];
    (await Promise.all(promises))
      .map((p) => p.data || [])
      .flat()
      .map((node) => (node.id.startsWith("R_") ? node : node.repository))
      .forEach(
        (node) =>
          repos.find((n) => n.id === node.id) || repos.push(node)
      );
    repos.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return repos;
  }

  async mainMenu(query) {
    this.#prevId = null;
    this.#prevNodeId = null;
    const { baseUrl } = this.#Cache;
    if (!query) {
      this.Workflow.addItem({
        title: "My Resources",
        autocomplete: ".",
        icon: { path: "icons/me.png" },
        valid: false,
      });
    } else {
      this.formatOutput(await this.myRelatedRepos());
      this.Workflow.filter(query);
    }
    this.Workflow.addItem({
      title: "Search Repositories",
      icon: { path: "icons/repo.png" },
      arg: query,
      valid: !!query,
      variables: { action: "SEARCH_REPO" },
      mods: {
        cmd: {
          subtitle: "Search in browser",
          variables: { execute: "open_link" },
          arg: `${baseUrl}/search?q=${encodeURIComponent(
            query
          )}&type=repositories`,
        },
      },
    });
    this.Workflow.addItem({
      title: "Search Users",
      icon: { path: "icons/user.png" },
      arg: query,
      valid: !!query,
      variables: { action: "SEARCH_USER" },
      mods: {
        cmd: {
          subtitle: "Search in browser",
          variables: { execute: "open_link" },
          arg: `${baseUrl}/search?q=${encodeURIComponent(
            query
          )}&type=users`,
        },
      },
    });
    this.Workflow.addItem({
      title: "Search Issues",
      icon: { path: "icons/issue.png" },
      arg: query,
      valid: !!query,
      variables: { action: "SEARCH_ISSUE" },
      mods: {
        cmd: {
          subtitle: "Search in browser",
          variables: { execute: "open_link" },
          arg: `${baseUrl}/search?q=${encodeURIComponent(
            query
          )}&type=issues`,
        },
      },
    });
    this.Workflow.addItem({
      title: "Search Topics",
      icon: { path: "icons/topic.png" },
      variables: {
        action: "SEARCH_TOPIC",
        options: JSON.stringify({ q: query }),
      },
      arg: query,
      valid: !!query,
      mods: {
        cmd: {
          subtitle: "Search in browser",
          variables: { execute: "open_link" },
          arg: `${baseUrl}/search?q=${encodeURIComponent(
            query
          )}&type=topics`,
        },
      },
    });
  }

  async search(query, action = "SEARCH_REPO") {
    if (!action.startsWith("SEARCH_")) throw new Error("Invalid action.");
    try {
      let { data, id } = await this.#Cache.request(action, { q: query });
      this.formatOutput(data, id);
    } catch (e) {
      this.Workflow.warnEmpty("Error: " + e.message);
    }
  }

  /**
   * format output based on node type
   * @param {array} nodes
   * @param {number} id
   */
  formatOutput(nodes, id) {
    this.Workflow.setVar("prevId", "");
    // this.Workflow.setVar("action", "");
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
    };
    nodes.forEach((node) => {
      if (node.id?.split("_")[0] in lookUp) {
        lookUp[node.id.split("_")[0]].call(this, node, id);
      } else if (["tree", "blob"].includes(node.type)) {
        this.#formatTree(node, id);
      } else if (node.thread_id) {
        this.#formatNotification(node, id);
      } else if (node.score !== undefined) {
        this.#formatTopic(node, id);
      }
    });
  }

  #formatRepo(repo, id) {
    let name = repo.nameWithOwner,
      starred = repo.viewerHasStarred ? "★" : "",
      watched = repo.viewerSubscription === "SUBSCRIBED" ? "🔔" : "";
    let title = [name + " ", starred, watched].filter(Boolean).join(" ");
    let lang = repo.primaryLanguage?.name,
      stars = convertNum(repo.stargazerCount),
      updated = datetimeFormat(repo.updatedAt);
    stars = stars ? `★ ${stars}` : "";
    let subtitle = [lang, stars, updated].filter(Boolean).join(" · ");
    this.Workflow.addItem({
      title,
      subtitle,
      arg: repo.url,
      autocomplete: repo.nameWithOwner,
      variables: { execute: "open_link" },
      match: matchStr(repo.nameWithOwner),
      icon: { path: `icons/repo${repo.isPrivate ? "_private" : ""}.png` },
      text: {
        largetype: repo.description,
        copy: repo.name,
      },
      mods: {
        cmd: {
          subtitle: "Open menu",
          variables: { prevNodeId: repo.id, prevId: id, action: "" },
          icon: { path: "icons/menu.png" },
          arg: "",
        },
        alt: { subtitle: repo.description || "", valid: !1 },
      },
    });
  }

  #formatUser(user, id) {
    let name = `${user.login}${user.name ? `  (${user.name}) ` : ""}`,
      followed = user.viewerIsFollowing ? "💗" : "",
      verified = user.isVerified ? "🎖️" : "";
    let title = [name, verified, followed].filter(Boolean).join(" ");
    let followers = convertNum(user.followers?.totalCount),
      repos = convertNum(user.repositories.totalCount);
    let subtitle = [
      followers ? `👥 ${followers}` : "",
      repos ? `📕 ${repos}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    this.Workflow.addItem({
      title,
      subtitle,
      arg: user.url,
      autocomplete: user.login,
      icon: {
        path: `icons/${user.id.startsWith("U") ? "user" : "organization"}.png`,
      },
      variables: { execute: "open_link" },
      match: matchStr(user.login),
      text: {
        largetype: user.bio || user.description,
        copy: user.login,
      },
      mods: {
        cmd: {
          subtitle: "Open menu",
          variables: { prevNodeId: user.id, prevId: id, action: "" },
          icon: { path: "icons/menu.png" },
          arg: "",
        },
        alt: { subtitle: user.bio || user.description || "", valid: !1 },
      },
    });
  }

  #formatGist(gist) {
    let name = `${gist.owner}/${gist.files[0].name}`;
    let title = `${name}  ${gist.public ? "" : "🔒"}`;
    let subtitle = `📄 ${gist.files.length} · ${datetimeFormat(
      gist.updatedAt
    )}`;
    this.Workflow.addItem({
      title,
      subtitle,
      arg: gist.url,
      icon: { path: `icons/gist.png` },
      match: matchStr(name),
      text: {
        largetype: gist.description,
      },
      mods: {
        alt: { subtitle: gist.description || "", valid: !1 },
      },
    });
  }

  #formatList(list, id) {
    let title = `${list.name}  ${list.isPrivate ? "🔒" : ""}`;
    let subtitle = `📦 ${list.items.totalCount}`;
    this.Workflow.addItem({
      title,
      subtitle,
      icon: { path: "icons/list.png" },
      text: {
        largetype: list.description,
      },
      variables: {
        action: "NODES",
        options: JSON.stringify({
          ids: list.items.nodes.map((n) => n.id),
        }),
        prevId: id,
      },
      match: matchStr(list.name),
      mods: {
        alt: { subtitle: list.description || "", valid: !1 },
      },
    });
  }

  #formatIssue(issue) {
    let title = `${issue.title}  ${issue.viewerSubscription === "SUBSCRIBED" ? "🔔" : ""
      }`;
    let comments = convertNum(issue.comments.totalCount),
      updated = datetimeFormat(issue.updatedAt);
    let subtitle = [
      `${issue.repository.nameWithOwner} #${issue.number}`,
      updated,
      comments ? `💬 ${comments}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    let icon = `icons/${issue.id.startsWith("I") ? "issue" : "pr"}_${issue.state
      .toLowerCase()}.png`;
    this.Workflow.addItem({
      title,
      subtitle,
      arg: issue.url,
      variables: { execute: "open_link" },
      match: matchStr(issue.title),
      icon: { path: icon },
      text: {
        largetype: issue.body,
      },
      mods: {
        alt: { subtitle: issue.bodyText, valid: !1 },
      },
    });
  }

  #formatRelease(release, id) {
    let tag =
      release.tagName && release.tagName !== release.name
        ? ` (🏷️ ${release.tagName})`
        : "";
    let title = `${release.name}${tag}  ${release.isPrerelease ? "🚧" : ""
      }`;
    let assets = release.releaseAssets.totalCount
      ? `📦 ${release.releaseAssets.totalCount}`
      : "";
    let subtitle = [datetimeFormat(release.publishedAt), assets]
      .filter(Boolean)
      .join(" · ");
    this.Workflow.addItem({
      title,
      subtitle,
      valid: !!assets,
      icon: { path: "icons/release.png" },
      variables: {
        action: "RELEASE_ASSETS",
        options: JSON.stringify({ id: release.id }),
        prevId: id,
        prevNodeId: ""
      },
      quicklookurl: release.url,
      match: matchStr(release.name, release.tagName),
      text: {
        largetype: release.description,
      },
      mods: {
        shift: {
            subtitle: "Open in browser",
            arg: release.url,
            variables: { execute: "open_link" },
          },
        alt: { subtitle: release.description || "", valid: !1 },
      },
    });
  }

  #formatAsset(asset) {
    let title = asset.name;
    let subtitle = [
      asset.downloadCount ? `📥 ${asset.downloadCount}` : "",
      convertSize(asset.size),
    ]
      .filter(Boolean)
      .join(" · ");
    this.Workflow.addItem({
      title,
      subtitle,
      arg: asset.downloadUrl,
      match: matchStr(asset.name),
      variables: { execute: "open_link" },
      icon: { path: "icons/asset.png" },
      text: {
        largetype: asset.description,
      },
      mods: {
        alt: { subtitle: asset.description || "", valid: !1 },
      },
    });
  }

  #formatTree(tree) {
    let { path, type, size, url } = tree;
    this.Workflow.addItem({
      title: path,
      subtitle: convertSize(size),
      quicklookurl: url,
      match: matchStr(path),
      valid: type === "blob",
      autocomplete: type === "tree" ? path + "/" : undefined,
      arg: type === "blob" ? url.replace("/blob/", "/raw/") : undefined,
      variables: { execute: "open_link" },
      icon: { path: `icons/${type === "tree" ? "folder" : "file"}.png` },
    });
  }

  #formatNotification(notification) {
    let { title, url, repo, updated_at, tag, thread_id } = notification;
    tag = tag ? ` #${tag}` : "";
    this.Workflow.addItem({
      title,
      subtitle: `${repo}${tag} ${datetimeFormat(updated_at)}`,
      arg: url,
      match: matchStr(title, repo),
      icon: { path: `icons/notification.png` },
      variables: { execute: "open_link" },
      mods: {
        cmd: {
          subtitle: "Mark as read",
          variables: {
            execute: "action",
            action: "MARK_NOTIFICATION_AS_READ",
            options: JSON.stringify({ thread_id }),
          },
          icon: { path: "icons/unseen.png" },
        },
      },
    });
  }

  #formatTopic(topic) {
    let { name, display_name, short_description, description } = topic;
    this.Workflow.addItem({
      title: display_name || name,
      subtitle: short_description || description || "",
      arg: `${this.#Cache.baseUrl}/topics/${name}`,
      icon: { path: "icons/topic.png" },
      variables: { execute: "open_link" },
      text: {
        largetype: short_description || description,
        copy: name,
      },
    });
  }

  async subMenu() {
    const nodes = this.#Cache.requestCacheById(this.#prevId)?.data;
    try {
      const node = nodes?.find((n) => n.id === this.#prevNodeId) || (await this.#Cache.request("NODES", { ids: [this.#prevNodeId] })).data?.[0];
      if (this.#prevNodeId.startsWith('R_')) {
        this.#repoMenu(node);
      } else {
        this.#userMenu(node);
      }
      this.Workflow.setVar("prevNodeId", "");
    } catch (e) {
      this.Workflow.warnEmpty("Error: " + e.message);
    }
  }

  #repoMenu(repo) {
    if (!repo) {
      this.Workflow.warnEmpty("Repo Not Found.");
      return;
    }
    let [owner, name] = repo.nameWithOwner.split("/");
    this.Workflow.addItem({
      title: repo.nameWithOwner,
      subtitle: "Open in browser",
      icon: { path: "icons/repo.png" },
      match: "wiki homepage ssh url link",
      arg: repo.url,
      text: {
        largetype: repo.description,
        copy: repo.nameWithOwner,
      },
      variables: { execute: "open_link" },
      mods: {
        cmd: repo.hasWikiEnabled
          ? {
            subtitle: "Open wiki",
            variables: { execute: "open_link" },
            arg: `${repo.url}/wiki`,
            icon: { path: "icons/wiki.png" },
          }
          : undefined,
        alt: repo.homepageUrl
          ? {
            subtitle: "Open homepage",
            variables: { execute: "open_link" },
            arg: repo.homepageUrl,
            icon: { path: "icons/website.png" },
          }
          : undefined,
        shift: {
          subtitle: "Copy SSH url",
          arg: repo.sshUrl,
          variables: { execute: "copy" },
          icon: { path: "icons/clone.png" },
        },
      },
    });
    this.Workflow.addItem({
      title: owner,
      icon: { path: "icons/user.png" },
      match: `user ${owner}`,
      variables: { prevNodeId: repo.owner.id, prevId: -1 },
    });
    repo.issues.totalCount &&
      this.Workflow.addItem({
        title: "Issues",
        subtitle: `${repo.issues.totalCount} issue${repo.issues.totalCount > 1 ? "s" : ""
          }`,
        icon: { path: "icons/issue.png" },
        match: "issues",
        variables: {
          action: "REPO_ISSUES",
          options: JSON.stringify({ owner, name }),
          prevId: this.#prevId,
          prevNodeId: this.#prevNodeId,
        },
        mods: {
          cmd: {
            subtitle: "Open in browser",
            variables: { execute: "open_link" },
            arg: `${repo.url}/issues`,
          },
        },
      });
    repo.pullRequests.totalCount &&
      this.Workflow.addItem({
        title: "Pull Requests",
        subtitle: `${repo.pullRequests.totalCount} pull request${repo.pullRequests.totalCount > 1 ? "s" : ""
          }`,
        icon: { path: "icons/pr.png" },
        match: "prs pull requests",
        variables: {
          action: "REPO_PRS",
          options: JSON.stringify({ owner, name }),
          prevId: this.#prevId,
          prevNodeId: this.#prevNodeId,
        },
        mods: {
          cmd: {
            subtitle: "Open in browser",
            variables: { execute: "open_link" },
            arg: `${repo.url}/pulls`,
          },
        },
      });
    repo.releases.totalCount &&
      this.Workflow.addItem({
        title: "Releases",
        icon: { path: "icons/release.png" },
        match: "releases",
        variables: {
          action: "REPO_RELEASES",
          options: JSON.stringify({ owner, name }),
          prevId: this.#prevId,
          prevNodeId: this.#prevNodeId,
        },
      });
    this.Workflow.addItem({
      title: "Tree",
      icon: { path: "icons/tree.png" },
      match: "tree",
      variables: {
        action: "REPO_TREE",
        options: JSON.stringify({ owner, name }),
        prevId: this.#prevId,
        prevNodeId: this.#prevNodeId,
      },
    });
    if (owner !== this.#Cache.username) {
      this.Workflow.addItem({
        title: repo.viewerHasStarred ? "Unstar Repo" : "Star Repo",
        icon: { path: "icons/star.png" },
        match: "star",
        variables: {
          execute: "action",
          action: "STAR",
          options: JSON.stringify({
            id: repo.id,
            unstar: !!repo.viewerHasStarred,
          }),
        },
      });
      this.Workflow.addItem({
        title:
          repo.viewerSubscription === "SUBSCRIBED"
            ? "Unwatch Repo"
            : "Watch Repo",
        icon: { path: `icons/${repo.viewerSubscription === "SUBSCRIBED" ? 'unseen' : 'watching'}.png` },
        match: "watch subscribe",
        variables: {
          execute: "action",
          action: "SUBSCRIBE",
          options: JSON.stringify({
            id: repo.id,
            state:
              repo.viewerSubscription === "SUBSCRIBED"
                ? "UNSUBSCRIBED"
                : "SUBSCRIBED",
          }),
        },
      });
    }
  }

  #userMenu(user) {
    if (!user) {
      this.Workflow.warnEmpty("User Not Found.");
      return;
    }
    this.Workflow.addItem({
      title: `${user.login}${user.name ? `  (${user.name}) ` : ""}`,
      subtitle: "Open in browser",
      icon: {
        path: `icons/${prevNodeId.startsWith("U") ? "user" : "org"}.png`,
      },
      text: {
        largetype: user.bio || user.description,
        copy: user.login,
      },
      match: "profile homepage url link",
      arg: user.url,
      variables: { execute: "open_link" },
      mods: {
        cmd: user.websiteUrl
          ? {
            subtitle: "Open website",
            variables: { execute: "open_link" },
            arg: user.websiteUrl,
            icon: { path: "icons/website.png" },
          }
          : undefined,
      },
    });
    user.repositories.totalCount &&
      this.Workflow.addItem({
        title: "Repositories",
        subtitle: `${user.repositories.totalCount} repo${user.repositories.totalCount > 1 ? "s" : ""
          }`,
        icon: { path: "icons/repo.png" },
        match: "repos",
        variables: {
          action: "USER_REPOS",
          options: JSON.stringify({ login: user.login }),
          prevId: this.#prevId,
          prevNodeId: this.#prevNodeId,
        },
        mods: {
          cmd: {
            subtitle: "Open in browser",
            variables: { execute: "open_link" },
            arg: `${user.url}?tab=repositories`,
          },
        },
      });
    user.isViewer ||
      this.Workflow.addItem({
        title: user.viewerIsFollowing ? "Unfollow User" : "Follow User",
        icon: { path: "icons/follow.png" },
        match: "follow",
        variables: {
          execute: "action",
          action: user.viewerIsFollowing ? "UNFOLLOW" : "FOLLOW",
          options: JSON.stringify({
            id: user.id,
            org: prevNodeId.startsWith("O"),
          }),
        },
      });
  }

  runCommand(command, query) {
    switch (command) {
      case "set_enterprise_url":
        this.#Cache.baseUrl = query;
        notify("Enterprise URL set", query);
        break;
      case "del_enterprise_url":
        this.#Cache.baseUrl = "";
        notify("Enterprise URL deleted");
        break;
      case "set_access_token":
        this.#Cache.accessToken = query;
        notify("Personal Access Token set");
        break;
      case "del_access_token":
        this.#Cache.accessToken = "";
        notify("Personal Access Token deleted");
        break;
      case "clear_cache":
        this.#Cache.clearCache(!0);
        notify("Cache cleared");
        break;
    }
  }

  logIn(query) {
    const { accessToken, baseUrl } = this.#Cache;
    this.Workflow.addItem({
      title: `Set Personal Access Token${query ? `: ${query}` : ""}`,
      subtitle: `Current: ${accessToken ? "＊＊＊＊＊＊" : ""}`,
      arg: query,
      valid: !!query,
      icon: { path: "icons/login.png" },
      variables: { command: "set_access_token" },
      mods: {
        cmd: {
          subtitle: "Delete token",
          variables: { command: "del_access_token" },
          icon: { path: "icons/delete.png" },
        },
      },
    });
    if (this.#enterprise) {
      this.Workflow.addItem({
        title: `Set Enterprise URL${query ? `: ${query}` : ""}`,
        subtitle: `Current: ${baseUrl || ""}`,
        arg: query,
        valid: !!query,
        icon: { path: "icons/login.png" },
        variables: { command: "set_enterprise_url" },
        mods: {
          cmd: {
            subtitle: "Delete enterprise URL",
            variables: { command: "del_enterprise_url" },
            icon: { path: "icons/delete.png" },
          },
        },
      });
    }
  }

  config(query) {
    this.#prevId = null;
    this.Workflow.addItem({
      title: "Clear Cache",
      icon: { path: "icons/clear_cache.png" },
      variables: { command: "clear_cache" },
    });
    this.logIn(query);
  }

  notifyAction(action, data) {
    switch (action) {
      case "MARK_NOTIFICATION_AS_READ":
        notify("Notification marked as read");
        break;
      case "STAR": {
        let name = data.nameWithOwner || data.name;
        notify(
          `${data.viewerHasStarred ? "Starred" : "Unstarred"} ${name}`
        );
        break;
      }
      case "SUBSCRIBE": {
        let name =
          data.nameWithOwner ||
          `${data.repository.nameWithOwner} #${data.number}`;
        notify(
          `${data.viewerSubscription === "SUBSCRIBED"
            ? "Watching"
            : "Unwatched"
          } ${name}`
        );
        break;
      }
      case "FOLLOW":
      case "UNFOLLOW":
        {
        notify(
          `${data.viewerIsFollowing ? "Following" : "Unfollowed"} ${data.login}`
        );
        break;
      }
    }
    this.#Cache.refresh(!0);
  }
}

export default Interface;

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  new Interface().run(process.argv[2]?.trim());
}
