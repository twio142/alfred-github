#!/usr/bin/env node
'use strict';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFile } from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import GitHub from './github.js';

class Cache {
  static #dbFile = `${process.env.alfred_workflow_data}/cache.db`;
  #db;
  #enterprise = process.env.enterprise === 1;
  #accessToken = () =>
    this.#db
      .prepare('SELECT value FROM configs WHERE key = \'accessToken\'')
      .get()
      ?.value;

  #apiUrl = () => {
    if (this.#enterprise) {
      const url = this.#db
        .prepare('SELECT value FROM configs WHERE key = \'enterpriseUrl\'')
        .get()
        ?.value;
      return url ? url.replace(/\/?$/, '/api/v3') : null;
    } else {
      return 'https://api.github.com';
    }
  };

  #loggedIn = () => !!this.#accessToken() && !!this.#apiUrl();
  #username = () => {
    const { data } = this.requestCache('ME');
    return data?.login;
  };

  #GitHub;
  // #debug = !!process.env.alfred_debug;

  constructor() {
    if (!process.env.alfred_workflow_data)
      throw new Error('`alfred_workflow_data` not available.');
    mkdirSync(process.env.alfred_workflow_data, { recursive: true });
    mkdirSync(process.env.alfred_workflow_cache, { recursive: true });
    this.#db = new Database(Cache.#dbFile);
    this.#db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '{}',
    data TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    prevId INTEGER,
    prevNodeId TEXT,
    FOREIGN KEY (prevId) REFERENCES cache(id)
    );
  `);
    this.#db.exec(`
    CREATE TABLE IF NOT EXISTS configs (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT
    );
  `);
    if (this.#loggedIn()) {
      this.#GitHub = new GitHub({
        auth: this.#accessToken(),
        baseUrl: this.#apiUrl(),
      });
    }
  }

  static #dict(options = {}) {
    return JSON.stringify(Object.fromEntries(Object.entries(options).sort()));
  }

  /**
   * @param {string} action
   * @param {object} options
   * @param {boolean} forceRefresh
   * @param {number} prevId
   * @param {string} prevNodeId
   * @returns {Promise<{data: object, id: number}>} response
   */
  async request(action, options = {}, forceRefresh = !1, prevId, prevNodeId) {
    const row = this.requestCache(action, options);
    if (row.data && !forceRefresh) {
      if (!row.fresh) {
        this.#cacheInBackground(action, options, row.id);
      }
      return { data: row.data, id: row.id };
    } else {
      return await this.requestAPI(action, options, null, prevId, prevNodeId);
    }
  }

  /**
   * @param {string} action
   * @param {object} options
   * @param {number} id
   * @param {number} prevId
   * @param {string} prevNodeId
   * @returns {Promise<{data: object, id: number}>} response
   */
  async requestAPI(action, options = {}, id, prevId, prevNodeId) {
    console.error(action, options);
    id = Number.parseInt(id) || null;
    prevId = Number.parseInt(prevId) || null;
    if (!this.#loggedIn())
      throw new Error('Not logged in.');
    const data = await this.#GitHub.request(action, options);
    if (Cache.#noCacheActions.includes(action)) {
      return { data };
    } else if (data) {
      if (action === 'ME')
        this.#cacheMyAvatar(data.avatarUrl);
      id = this.#cacheData(action, options, data, id, prevId, prevNodeId);
      return { data, id };
    } else {
      return {};
    }
  }

  /**
   * @param {string} action
   * @param {object} options
   * @returns {data: object, id: number, fresh: boolean} data
   */
  requestCache(action, options) {
    const row = this.#db
      .prepare(
        `
    SELECT id, data, timestamp > DATETIME('now', '-10 minutes') AS fresh FROM cache
    WHERE action = ? AND options = ?
    ORDER BY timestamp DESC
    LIMIT 1;
  `,
      )
      .get(action, Cache.#dict(options));
    if (row)
      row.data = JSON.parse(row.data);
    return row || {};
  }

  /**
   * @param {number} id
   * @returns {data: object, id: number, ...} data
   */
  requestCacheById(id) {
    if (!Number.parseInt(id))
      return {};
    const row = this.#db
      .prepare(
        `
    SELECT * FROM cache
    WHERE id = ?
  `,
      )
      .get(Number.parseInt(id));
    if (row) {
      row.data = JSON.parse(row.data);
      row.options = JSON.parse(row.options);
    }
    return row || {};
  }

  #cacheMyAvatar(url) {
    if (!existsSync('icons/me.png')) {
      spawn('curl', ['-o', 'icons/me.png', url], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
  }

  /**
   * @param {string} action
   * @param {object} options
   * @param {object} data
   * @param {number} id
   * @param {number} prevId
   * @param {string} prevNodeId
   * @returns {number} id
   */
  #cacheData(action, options = {}, data, id, prevId, prevNodeId = null) {
    id = Number.parseInt(id) || null;
    prevId = Number.parseInt(prevId) || null;
    if (id) {
      this.#db
        .prepare(
          `
    UPDATE cache
    SET data = ?, timestamp = CURRENT_TIMESTAMP, prevId = ?, prevNodeId = ?
    WHERE id = ?
    `,
        )
        .run(JSON.stringify(data), prevId, prevNodeId, id);
    } else {
      id = this.#db
        .prepare(
          `
    INSERT INTO cache (action, options, data, prevId, prevNodeId)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id;
    `,
        )
        .get(
          action,
          Cache.#dict(options),
          JSON.stringify(data),
          prevId,
          prevNodeId,
        )
        .id;
    }
    return id;
  }

  /**
   * @param {string} action
   * @param {object} options
   * @param {number} id
   */
  #cacheInBackground(action = '', options = {}, id = '') {
    if (!this.#loggedIn())
      return;
    const child = spawn(
      fileURLToPath(import.meta.url),
      [action, JSON.stringify(options), String(id)],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
    if (action) {
      child.unref();
      return;
    }
    writeFile(
      `${process.env.alfred_workflow_cache}/pid`,
      String(child.pid),
      () => child.unref(),
    );
  }

  refreshInBackground() {
    if (!existsSync(`${process.env.alfred_workflow_cache}/pid`))
      this.#cacheInBackground();
  }

  static #noCacheActions = [
    'STAR',
    'SUBSCRIBE',
    'FOLLOW',
    'UNFOLLOW',
    'MARK_NOTIFICATION_AS_READ',
    'UNSUBSCRIBE_NOTIFICATION',
    'CREATE_REPO',
    'FORK_REPO',
  ];

  static myRelatedRepos = [
    ['MY_REPOS', { multiPages: true }],
    ['MY_STARS', { multiPages: true }],
    ['MY_WATCHING', { multiPages: true }],
    ['MY_ISSUES', { multiPages: true }],
    ['MY_PRS', { multiPages: true }],
  ];

  static myResources = [
    ['ME'],
    ['MY_REPOS', { multiPages: true }],
    ['MY_STARS', { multiPages: true }],
    ['MY_LISTS', { multiPages: true }],
    ['MY_WATCHING', { multiPages: true }],
    ['MY_FOLLOWING', { multiPages: true }],
    ['MY_ISSUES', { multiPages: true }],
    ['MY_PRS', { multiPages: true }],
    ['MY_GISTS', { multiPages: true }],
    ['MY_STARRED_GISTS', { multiPages: true }],
    ['MY_NOTIFICATIONS', { multiPages: true }],
  ];

  async refresh(force = !1) {
    const promises = Cache.myResources.map(([action, options]) =>
      this.request(action, options, force),
    );
    await Promise.all(promises);
  }

  clearCache(all = !1) {
    if (all) {
      this.#db.exec('DELETE FROM cache;');
    } else {
      this.#db.exec(
        'DELETE FROM cache WHERE timestamp < DATETIME(\'now\', \'-1 day\');',
      );
    }
  }

  get loggedIn() {
    return this.#loggedIn();
  }

  get accessToken() {
    return this.#accessToken();
  }

  set accessToken(token) {
    this.#db
      .prepare(
        `
    INSERT INTO configs (key, value)
    VALUES ('accessToken', ?)
    ON CONFLICT DO UPDATE SET value = ?;
  `,
      )
      .run(token, token);
    if (this.#loggedIn()) {
      this.#GitHub = new GitHub({
        auth: this.#accessToken(),
        baseUrl: this.#apiUrl(),
      });
    }
  }

  get apiUrl() {
    return this.#apiUrl();
  }

  get baseUrl() {
    return this.#enterprise
      ? this.#db
          .prepare('SELECT value FROM configs WHERE key = \'enterpriseUrl\'')
          .get()
          ?.value
          ?.replace(/\/$/, '')
      : 'https://github.com';
  }

  set baseUrl(url) {
    url = url.replace(/\/$/, '');
    if (this.#enterprise) {
      this.#db
        .prepare(
          `
    INSERT INTO configs (key, value)
    VALUES ('enterpriseUrl', ?)
    ON CONFLICT DO UPDATE SET value = ?;
    `,
        )
        .run(url, url);
      if (this.#loggedIn()) {
        this.#GitHub = new GitHub({
          auth: this.#accessToken(),
          baseUrl: `${url}/api/v3`,
        });
      }
    }
  }

  get gistUrl() {
    return this.#enterprise
      ? this.#db
        .prepare('SELECT value FROM configs WHERE key = \'gistUrl\'')
        .get()
        ?.value
      : 'https://gist.github.com';
  }

  set gistUrl(url) {
    if (this.#enterprise) {
      this.#db
        .prepare(
          `
    INSERT INTO configs (key, value)
    VALUES ('gistUrl', ?)
    ON CONFLICT DO UPDATE SET value = ?;
    `,
        )
        .run(url, url);
    }
  }

  get username() {
    return this.#username();
  }
}

export default Cache;

if (fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const cache = new Cache();
  if (process.argv[2] === 'clear') {
    cache.clearCache();
  } else if (process.argv[2]) {
    cache.requestAPI(
      process.argv[2],
      JSON.parse(process.argv[3]),
      process.argv[4],
    );
  } else {
    cache
      .refresh()
      .finally(() => unlinkSync(`${process.env.alfred_workflow_cache}/pid`));
  }
}
