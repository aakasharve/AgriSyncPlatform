## Private Provenance Hooks

This repo uses a private-provenance model (CoFounder OS v4).
After cloning, install the parent pre-commit hook:

```powershell
# Windows PowerShell
Copy-Item docs/hooks/pre-commit-sample.sh .git/hooks/pre-commit
icacls .git\hooks\pre-commit /grant Everyone:RX
```

Without this hook, you may accidentally stage private paths
(`_COFOUNDER/`, `.obsidian/`, `.mcp.json`, etc.) into the public repo.
