# validate-mis-dashboards.ps1
# CI gate: every SQL query in every Metabase dashboard JSON must only reference
# views that appear in the _views_required contract manifest of that same JSON.
# Exits 1 if any drift is detected.
#
# Usage: pwsh build/scripts/validate-mis-dashboards.ps1

param(
    [string]$DashboardDir = "$PSScriptRoot/../metabase/dashboards"
)

$errors = @()
$dashboards = Get-ChildItem -Path $DashboardDir -Filter "*.json" -Recurse

if ($dashboards.Count -eq 0) {
    Write-Warning "No dashboard JSONs found in $DashboardDir"
    exit 0
}

foreach ($file in $dashboards) {
    $json = Get-Content $file.FullName -Raw | ConvertFrom-Json
    $contract = $json._views_required
    if (-not $contract) {
        $errors += "$($file.Name): missing _views_required contract array"
        continue
    }

    $contractSet = $contract | ForEach-Object { $_.ToLower() }

    # Extract all SQL queries from cards
    $queries = @()
    foreach ($card in $json.cards) {
        $q = $card.card.dataset_query.native.query
        if ($q) { $queries += $q }
    }

    # Find mis.* references in queries (regex: mis\.\w+)
    $referenced = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($q in $queries) {
        $matches = [regex]::Matches($q, 'mis\.\w+')
        foreach ($m in $matches) {
            $null = $referenced.Add($m.Value.ToLower())
        }
    }

    # Check every referenced view is in contract
    foreach ($view in $referenced) {
        if (-not ($contractSet -contains $view)) {
            $errors += "$($file.Name): query references '$view' which is NOT in _views_required"
        }
    }

    # Check every contracted view is actually referenced (warn only — contract can be forward-declared)
    foreach ($view in $contractSet) {
        if (-not ($referenced -contains $view)) {
            Write-Warning "$($file.Name): contracted view '$view' not referenced in any query (forward-declared?)"
        }
    }
}

if ($errors.Count -gt 0) {
    Write-Error "MIS dashboard contract violations:"
    $errors | ForEach-Object { Write-Error "  - $_" }
    exit 1
}

Write-Host "MIS dashboard validation passed. $($dashboards.Count) dashboard(s) checked." -ForegroundColor Green
exit 0
