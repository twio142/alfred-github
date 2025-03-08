# GitHub Workflow

An Alfred workflow to search on GitHub and manage your resources.

Written with Node.js. Uses GitHub's graphQL and REST API and stores cache in a sqlite database.

You need a [personal access token](https://github.com/settings/tokens/new?description=alfred-workflow&scopes=repo,read:org,read:enterprise,gist,notifications,user,codespace) to log in.

Run `npm run init` to set up the workflow.

## Dependencies

- `node`
- `terminal-notifier`

---

Inspired by and developed on the basis of [gharlan/alfred-github-workflow](https://github.com/gharlan/alfred-github-workflow).
