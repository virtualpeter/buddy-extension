PUBLISHER ?= virtualpete

.PHONY: all package compile check clean help

all: package

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

compile: node_modules
	npm run compile

check: node_modules
	npm run check

# VSIX next to package.json (buddy-<git-tag>.vsix). Override publisher / version:
#   make package PUBLISHER=otherorg
#   make package VERSION=0.2.0
package: node_modules
	PUBLISHER=$(PUBLISHER) VERSION=$(VERSION) npm run package

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
	@echo "VERSION from git tag (v0.2.0 → 0.2.0), or VERSION=..."
