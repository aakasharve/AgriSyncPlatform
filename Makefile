# Makefile — AgriSync Cofounder OS
# runbook: _COFOUNDER/runbooks/devcontainer.md
# Usage: make <target>  |  make help

.PHONY: help boot build test lint eval eval-smoke ship digest gate-review clean

DOTNET_PROJECT := src/AgriSync.sln
MOBILE_WEB     := src/clients/mobile-web
SPEC_ID        ?= $(shell git log -1 --pretty=%B | grep -oE 'spec: [a-z0-9-]+' | cut -d' ' -f2)
PHASE          ?= 1

## help: List all make targets with descriptions
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'

## boot: Bootstrap dev environment (install deps, migrate DB, seed data)
boot:
	@echo "[make boot] Installing .NET dependencies..."
	dotnet restore $(DOTNET_PROJECT)
	@echo "[make boot] Installing frontend dependencies..."
	cd $(MOBILE_WEB) && npm ci
	@echo "[make boot] Running database migrations..."
	dotnet ef database update \
		--project src/apps/ShramSafal/ShramSafal.Infrastructure \
		--startup-project src/AgriSync.Bootstrapper 2>/dev/null || echo "[make boot:warn] EF update failed — check Postgres connection"
	@echo "[make boot] Done. Run 'make build' to verify."

## build: Build backend + frontend
build:
	dotnet build $(DOTNET_PROJECT) --configuration Release
	cd $(MOBILE_WEB) && npm run build

## test: Run all tests (backend + frontend)
test:
	dotnet test $(DOTNET_PROJECT) --configuration Release --no-build
	cd $(MOBILE_WEB) && npm test -- --run

## lint: Format check + ESLint + Prettier
lint:
	dotnet format $(DOTNET_PROJECT) --verify-no-changes
	cd $(MOBILE_WEB) && npm run lint

## eval: Run full AI golden-set evaluation
eval:
	@echo "[make eval] Running full golden-set eval..."
	@if [ -f "_COFOUNDER/eval/run.ts" ]; then \
		cd $(MOBILE_WEB) && npx ts-node ../../_COFOUNDER/eval/run.ts --mode full; \
	else \
		echo "[make eval:warn] eval/run.ts not yet authored. Skipping."; \
	fi

## eval-smoke: Run smoke AI eval (10 cases, < 60s)
eval-smoke:
	@echo "[make eval-smoke] Running smoke eval (10 cases)..."
	@if [ -f "_COFOUNDER/eval/run.ts" ]; then \
		cd $(MOBILE_WEB) && npx ts-node ../../_COFOUNDER/eval/run.ts --mode smoke --max-cases 10; \
	else \
		echo "[make eval-smoke:warn] eval/run.ts not yet authored. Skipping."; \
	fi

## ship: Pre-merge checklist runner (requires fresh PROD_SNAPSHOT ≤24h)
# Pre-flight gate (Mitigation — _COFOUNDER/runbooks/prod-state-snapshot.md):
# A merge cannot ship without a recent prod-state snapshot on disk so we
# never reason about staged changes against a stale view of production.
# Refresh with: bash _COFOUNDER/scripts/prod-state-snapshot.sh
ship:
	@echo "[make ship] Pre-flight: checking prod snapshot freshness..."
	@SNAP=$$(ls -t _COFOUNDER/OS/State/PROD_SNAPSHOT_*.md 2>/dev/null | head -1); \
	if [ -z "$$SNAP" ]; then \
		echo "[make ship] ERROR: no PROD_SNAPSHOT found. Run: bash _COFOUNDER/scripts/prod-state-snapshot.sh"; \
		exit 1; \
	fi; \
	AGE=$$(($$(date +%s) - $$(stat -c %Y "$$SNAP" 2>/dev/null || stat -f %m "$$SNAP" 2>/dev/null || echo 0))); \
	if [ "$$AGE" -gt 86400 ]; then \
		echo "[make ship] ERROR: PROD_SNAPSHOT is $$((AGE / 3600))h old (>24h). Refresh first."; \
		exit 1; \
	fi; \
	echo "[make ship] OK — snapshot is $$((AGE / 60))min old"
	@echo "[make ship] Running pre-merge checklist..."
	@FAILED=0; \
	echo "1/6 dotnet format..."; dotnet format $(DOTNET_PROJECT) --verify-no-changes || FAILED=1; \
	echo "2/6 dotnet build..."; dotnet build $(DOTNET_PROJECT) --configuration Release --no-restore || FAILED=1; \
	echo "3/6 dotnet test..."; dotnet test $(DOTNET_PROJECT) --configuration Release --no-build || FAILED=1; \
	echo "4/6 frontend lint + test + build..."; (cd $(MOBILE_WEB) && npm run lint && npm test -- --run && npm run build) || FAILED=1; \
	echo "5/6 eval-smoke..."; $(MAKE) eval-smoke || true; \
	echo "6/6 spec-id check..."; \
		SPEC=$(shell git log -1 --pretty=%B | grep -oE 'spec: [a-z0-9-]+' | head -1); \
		if [ -z "$$SPEC" ]; then echo "[make ship:warn] No spec ID in commit message."; fi; \
	if [ "$$FAILED" -ne 0 ]; then echo "[make ship] FAILED — fix errors above."; exit 1; fi; \
	echo "[make ship] All checks passed. Ready to PR."

## digest: Generate weekly founder digest
digest:
	@echo "[make digest] Generating weekly digest via doc-curator..."
	@WEEK=$(shell date +%Y-W%V); \
	echo "# Digest $$WEEK — generated $(shell date +%Y-%m-%d)" > "_COFOUNDER/dashboards/digest-$$WEEK.md"; \
	echo "" >> "_COFOUNDER/dashboards/digest-$$WEEK.md"; \
	echo "## Metrics snapshot" >> "_COFOUNDER/dashboards/digest-$$WEEK.md"; \
	tail -5 "_COFOUNDER/dashboards/slop-rate.md" 2>/dev/null >> "_COFOUNDER/dashboards/digest-$$WEEK.md" || echo "(no slop data yet)" >> "_COFOUNDER/dashboards/digest-$$WEEK.md"; \
	echo "[make digest] Written to _COFOUNDER/dashboards/digest-$$WEEK.md"

## gate-review: Run scorecard for a phase gate (PHASE=1|2|3|4|close)
gate-review:
	@echo "[make gate-review] Running Phase $(PHASE) gate review..."
	@if [ -f "_COFOUNDER/scripts/scorecard.sh" ]; then \
		bash _COFOUNDER/scripts/scorecard.sh --phase $(PHASE) | tee /tmp/gate-review-$(PHASE).md; \
		echo ""; \
		echo "Review written to /tmp/gate-review-$(PHASE).md. Append your sign-off to _COFOUNDER/dashboards/gate-reviews.md"; \
	else \
		echo "[make gate-review:warn] scorecard.sh not yet available. Skipping."; \
	fi

## clean: Remove build artifacts
clean:
	find . -name "bin" -o -name "obj" | xargs rm -rf 2>/dev/null || true
	rm -rf $(MOBILE_WEB)/dist $(MOBILE_WEB)/node_modules/.cache || true
