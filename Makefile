# nebula3d — common dev tasks.
#
# The web UI is a single React app (web/) built into two gitignored targets:
#   make ui        -> src/nebula3d/server/static  (served by native `nebula3d-web`)
#   make ui-pages  -> web/dist                 (GitHub Pages / Pyodide build)
# Both are build artifacts: rerun the matching target after changing web/src,
# or the running UI will be stale (native `nebula3d-web` warns at startup if so).

NPM ?= npm
WEB := web

.DEFAULT_GOAL := help

.PHONY: help ui ui-pages web-install web-wheel check

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

ui: ## Rebuild the native (API-mode) SPA served by `nebula3d-web`
	cd $(WEB) && $(NPM) run build

ui-pages: ## Rebuild the GitHub Pages / Pyodide bundle (web/dist)
	cd $(WEB) && $(NPM) run build:pages

web-install: ## Install frontend dependencies (npm install in web/)
	cd $(WEB) && $(NPM) install

web-wheel: ## Build the data-free wheel + manifest for dev:pyodide (mirrors CI)
	rm -rf build src/*.egg-info src/nebula3d/server/static/data
	rm -f $(WEB)/public/wheels/*.whl
	python -m pip wheel . --no-deps --no-cache-dir -w $(WEB)/public/wheels
	@if unzip -l $(WEB)/public/wheels/*.whl | grep -iqE '\.(bin|nxs|h5|hdf5|npy)'; then \
		echo "DATA LEAK in wheel — aborting"; exit 1; fi
	python -c "import glob, json, pathlib; \
		w = sorted(glob.glob('$(WEB)/public/wheels/*.whl')); \
		assert len(w) == 1, w; \
		pathlib.Path('$(WEB)/public/wheels/manifest.json').write_text( \
		    json.dumps({'wheel': pathlib.Path(w[0]).name})); \
		print('manifest:', pathlib.Path(w[0]).name)"

check: ## Run the backend test + lint + type suite
	./scripts/check.sh
