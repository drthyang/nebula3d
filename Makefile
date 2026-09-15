# nebula3d — common dev tasks.
#
# The web UI is a single React app (web/) built into two gitignored targets:
#   make ui        -> src/nebula3d/server/static  (served by native `nebula3d-web`)
#   make ui-pages  -> web/dist                 (GitHub Pages / Pyodide build)
# Both are build artifacts: rerun the matching target after changing web/src,
# or the running UI will be stale (native `nebula3d-web` warns at startup if so).

NPM ?= npm
WEB := web
# Interpreter for the Python targets: the repo venv when present, else python3.
PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.DEFAULT_GOAL := help

.PHONY: help ui ui-pages web-install web-wheel check check-web

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

ui: ## Rebuild the native (API-mode) SPA served by `nebula3d-web`
	cd $(WEB) && $(NPM) run build

ui-pages: ## Rebuild the GitHub Pages / Pyodide bundle (web/dist)
	cd $(WEB) && $(NPM) run build:pages

web-install: ## Install frontend dependencies (npm install in web/)
	cd $(WEB) && $(NPM) install

web-wheel: ## Build the data-free, content-addressed wheel + manifest for the Pages/Pyodide build (mirrors CI)
	$(PY) scripts/build_web_wheel.py

check: ## Run the backend test + lint + type suite
	PY=$(PY) ./scripts/check.sh

check-web: ## Run the frontend lint + unit tests + type-check/build (both modes)
	cd $(WEB) && $(NPM) run lint && $(NPM) test && $(NPM) run build && $(NPM) run build:pages
