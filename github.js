'use strict';
// https://docs.github.com/en/rest
// https://github.com/octokit/core.js

import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";
import fetch from "node-fetch";
import * as GQL from './github-gql.js';
import { Enum } from "./utils.js";

const MyOctokit = Octokit.plugin(paginateRest, paginateGraphql);

class GitHub {
  #Octokit;
  static headers = { "X-Github-Next-Global-ID": 1 };
  // #debug = !!process.env.alfred_debug;

  constructor({ auth, baseUrl }) {
    this.#Octokit = new MyOctokit({ auth, baseUrl, request: { fetch } });
  }

  static #REST = {
    MY_NOTIFICATIONS: [
      'GET /notifications',
      { all: false, per_page: 100 }
      // all (also show those marked as read): true / false (*)
    ],
    MARK_NOTIFICATION_AS_READ: [
      'PUT /notifications',
      { thread_id: "" },
    ],
    MY_GISTS: [
      'GET /gists',
      { per_page: 100 }
    ],
    MY_STARRED_GISTS: [
      'GET /gists/starred',
      { per_page: 100 }
    ],
    SEARCH_TOPIC: [
      'GET /search/topics',
      { q: "", per_page: 20 },
    ],
  };

  static #GQL = GQL;

  /**
   *
   * @param {string} action
   * @param {object} options
   * @returns {Promise<object>}
   */
  async request(action, options = {}) {
    let data, ACTION;
    if (ACTION = GitHub.#REST[action], ACTION) {
      for (let key in options) {
        if (Object.keys(ACTION[1]).includes(key)) {
          ACTION[1][key] = options[key];
        }
      }
      ACTION[1].headers = GitHub.headers;
      if (options.multiPages) {
        data = await this.#Octokit.paginate(...ACTION);
      } else {
        data = (await this.#Octokit.request(...ACTION)).data;
        if (data.total_count !== undefined && Array.isArray(data.items))
          data = data.items;
      }
      if (action === "MY_NOTIFICATIONS") {
        data = await Promise.all(data.map(d => this.#getNotifications(d)));
      } else if (["MY_GISTS", "MY_STARRED_GISTS"].includes(action)) {
        data = GitHub.#tidyGists(data);
      }
    } else if (ACTION = GitHub.#GQL[action], ACTION) {
      for (let key in ACTION[1]) {
        if (ACTION[1][key] instanceof Enum) {
          ACTION[1][key] = ACTION[1][key].includes(options[key]) ? options[key] : ACTION[1][key][0];
        } else {
          ACTION[1][key] = options[key] === undefined ? ACTION[1][key] : options[key];
        }
      }
      ACTION[1].headers = GitHub.headers;
      if (options.multiPages) {
        data = await this.#Octokit.graphql.paginate(...ACTION);
      } else {
        data = (await this.#Octokit.graphql(...ACTION));
      }
      if (action === "REPO_TREE") {
        data = await this.#getTree(data);
      } else {
        while (Object.values(data)[0] instanceof Object && data.nodes === undefined) {
          data = Object.values(data)[0];
        }
        data = data.nodes || data;
      }
    } else {
      throw new Error(`Unknown action ${action}`);
    }
    return data;
  }

  async #getNotifications(data) {
    let {
      reason,
      id: thread_id,
      subject: { title, url, latest_comment_url, type },
      repository: { full_name: repo },
      updated_at,
      unread,
    } = data;
    let html_url, state, tag;
    if (!latest_comment_url) {
      html_url = data.repository.html_url;
    } else {
      let { data: subject } = await this.#Octokit.request(
        `GET ${latest_comment_url.replace(
          "https://api.github.com",
          ""
        )}`
      );
      html_url = subject.html_url;
      if (url != latest_comment_url) {
        subject = (
          await this.#Octokit.request(
            `GET ${url.replace("https://api.github.com", "")}`
          )
        ).data;
      }
      if (type == "PullRequest") {
        state = subject.merged_at ? "merged" : subject.state;
        tag = subject.number;
      } else if (type == "Issue") {
        state = subject.state;
        tag = subject.number;
      } else if (type == "Release") {
        tag = subject.tag_name;
      } else if (type == "Discussion") {
        tag = subject.number;
      }
    }
    return {
      reason,
      title,
      url: html_url,
      type,
      repo,
      updated_at,
      unread,
      state,
      tag,
      thread_id,
    };
  }

  async #getTree({ repository }) {
    let repo = repository.nameWithOwner;
    let url = repository.url;
    let ref = repository.defaultBranchRef.name;
    let { oid } = repository.defaultBranchRef.target.tree;
    let { data } = await this.#Octokit.request(
      `GET /repos/${repo}/git/trees/${oid}?recursive=true`,
      { headers: GitHub.headers }
    );
    let tree = data.tree.map(({ path, type, size }) => ({ path, type, size, url: `${url}/${type}/${ref}/${path}` }));
    return tree;
  }

  static #tidyGists = (nodes) =>
    nodes.map(({ node_id: id, html_url: url, files, public: _public, updated_at: updatedAt, description, owner: { login: owner } }) => {
      files = Object.values(files).map(f => ({ name: f.filename, url: f.raw_url, size: f.size }));
      return { id, url, files, public: _public, updatedAt, description, owner };
    });
}

export default GitHub;
