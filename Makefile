PUBLISHER ?= virtualpete
CLI_REPO ?= virtualpeter/buddy
CLI_PROVIDER ?= auto

.PHONY: all package compile check clean help

all: package

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

compile: node_modules
	npm run compile

check: node_modules
	npm run check

# VSIX next to package.json (buddy-<git-tag>.vsix). Override publisher / version / CLI repo:
#   make package PUBLISHER=otherorg
#   make package VERSION=0.2.0
#   make package CLI_REPO=otherorg/buddy
#   make package CLI_REPO=https://git.example.com/org/buddy CLI_PROVIDER=gitlab
package: node_modules
	PUBLISHER=$(PUBLISHER) VERSION=$(VERSION) CLI_REPO=$(CLI_REPO) CLI_PROVIDER=$(CLI_PROVIDER) npm run package

clean:
	rm -rf node_modules out *.vsix

help:
	@echo "buddy-extension"
	@echo ""
	@echo "  make / make package  - npm install + vsce package → ./buddy-<tag>.vsix"
	@echo "  make compile         - esbuild bundle (out/extension.js)"
	@echo "  make check           - tsc --noEmit"
	@echo "  make clean           - remove node_modules, out, *.vsix"
	@echo ""
	@echo "PUBLISHER=$(PUBLISHER) (extension id $(PUBLISHER).buddy)"
	@echo "CLI_REPO=$(CLI_REPO) (baked into buddy.cli.repo default)"
	@echo "CLI_PROVIDER=$(CLI_PROVIDER) (auto / github / gitlab)"
	@echo "VERSION from git tag (v0.2.0 → 0.2.0), or VERSION=..."
