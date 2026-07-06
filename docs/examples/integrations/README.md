# RunWitness MCP Host Snippets

These examples show how to point MCP hosts at the RunWitness stdio MCP server.
Use them after installing `@runwitness/mcp-server`, or after building this
repo and pointing the host at the built `packages/mcp-server` entrypoint.

The server should work with MCP hosts that support stdio MCP servers. In that
mode, the host starts the server as a local process and communicates over stdin
and stdout. RunWitness still only records what the server and underlying
adapter can expose; unreported nested activity should be treated as opaque.

## Files

- `codex-runwitness-mcp.toml`: Codex `config.toml` snippet.
- `claude-runwitness-mcp.json`: Claude-compatible `mcpServers` JSON snippet.

Host references:

- Codex MCP configuration: <https://developers.openai.com/codex/mcp>
- Claude Code MCP configuration: <https://docs.anthropic.com/en/docs/claude-code/mcp>

## Placeholders

Replace these values before use:

- `runwitness-mcp-server`: the package binary. From a source checkout after
  `npm run build`, use `node <repo>/packages/mcp-server/dist/src/bin.js`
  instead.
- `<absolute-workspace-path>`: the workspace the server should witness.
- `<absolute-data-dir>`: the RunWitness data directory, usually a `.runwitness`
  folder inside the workspace.

Prefer absolute paths in shared snippets so host startup does not depend on the
directory from which the client was launched.

## Codex

Codex MCP servers can be configured in `~/.codex/config.toml` or, for trusted
projects, `.codex/config.toml`.

```toml
[mcp_servers.runwitness]
command = "runwitness-mcp-server"
args = ["--workspace", "<absolute-workspace-path>", "--data-dir", "<absolute-data-dir>"]
startup_timeout_sec = 20
tool_timeout_sec = 120
enabled = true
default_tools_approval_mode = "prompt"
```

You can also add the same stdio server with the Codex CLI:

```bash
codex mcp add runwitness -- runwitness-mcp-server --workspace <absolute-workspace-path> --data-dir <absolute-data-dir>
```

## Claude

Claude-compatible MCP clients that read an `mcpServers` JSON object can use the
same server command.

```json
{
  "mcpServers": {
    "runwitness": {
      "command": "runwitness-mcp-server",
      "args": [
        "--workspace",
        "<absolute-workspace-path>",
        "--data-dir",
        "<absolute-data-dir>"
      ],
      "env": {}
    }
  }
}
```

For Claude Code, the equivalent CLI form is:

```bash
claude mcp add --transport stdio runwitness -- runwitness-mcp-server --workspace <absolute-workspace-path> --data-dir <absolute-data-dir>
```
