SHELL := /bin/bash
.SHELLFLAGS := -Eeuo pipefail -c
.ONESHELL:
ifeq ($(filter oneshell,$(.FEATURES)),)
$(error reach build needs GNU make with .ONESHELL support; install it and run again)
endif
REPO_ROOT := $(abspath ../..)
VERSION := $(shell cat VERSION)
HOST_OS := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ifeq ($(HOST_OS),darwin)
HOST_OS := macos
endif
HOST_ARCH := $(shell uname -m)
ifneq ($(filter arm64 aarch64,$(HOST_ARCH)),)
HOST_ARCH := aarch64
endif
PLATFORM := $(HOST_OS)-$(HOST_ARCH)
ifneq ($(filter package install,$(MAKECMDGOALS)),)
ifeq ($(filter $(PLATFORM),linux-x86_64 linux-aarch64 macos-x86_64 macos-aarch64),)
$(error reach package: unsupported platform $(PLATFORM))
endif
endif
ARCHIVE := reach-$(VERSION)-$(PLATFORM).tar.gz
TAR := $(shell if tar --sort=name --version >/dev/null 2>&1; then printf tar; elif gtar --sort=name --version >/dev/null 2>&1; then printf gtar; fi)
TOOLS := maddr magrep mcom mrep mbnc mdate mdeliver mdirs mflag mgenmid mhdr mlist mmime mmkdir mpick mquote mscan msed mseq mshow msort mthread museragent

.PHONY: all deps test package install
all: deps

deps:
	SOURCE_DATE_EPOCH="$$(git -C "$(REPO_ROOT)" show -s --format=%ct HEAD)" GIT_CEILING_DIRECTORIES="$(abspath vendor)" $(MAKE) -C vendor/mblaze all CFLAGS='-O2 -fstack-protector-strong -D_FORTIFY_SOURCE=2 -ffile-prefix-map=$(CURDIR)=.'
	mkdir -p vendor/bin
	for tool in $(TOOLS); do
		test -e "vendor/mblaze/$$tool"
		ln -sfn "../mblaze/$$tool" "vendor/bin/$$tool"
	done

test: deps
	bash "$(REPO_ROOT)/tests/apps/reach/run.sh"

package: deps
	[[ "$(VERSION)" =~ ^[0-9]+[.][0-9]+([.][0-9]+)?$$ ]]
	[[ -n "$(TAR)" ]] || { printf 'reach package: needs GNU tar; install it and run again.\n' >&2; exit 1; }
	command -v sha256sum >/dev/null || { printf 'reach package: needs sha256sum; install it and run again.\n' >&2; exit 1; }
	stage="$$(mktemp -d)"
	trap 'rm -r -- "$$stage"' EXIT
	mkdir -p "$$stage/vendor/bin"
	cp -a bin lib guide spec VERSION NOTICE "$$stage/"
	cp "$(REPO_ROOT)/LICENSE" "$$stage/LICENSE"
	for tool in $(TOOLS); do cp -L "vendor/bin/$$tool" "$$stage/vendor/bin/$$tool"; done
	epoch="$$(git -C "$(REPO_ROOT)" show -s --format=%ct HEAD)"
	mkdir -p dist
	$(TAR) --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$$epoch" -C "$$stage" -cf - LICENSE NOTICE VERSION bin guide lib spec vendor | gzip -n >"dist/$(ARCHIVE)"
	(cd dist && sha256sum "$(ARCHIVE)" >"$(ARCHIVE).sha256")

install:
	archive="dist/$(ARCHIVE)"
	test -f "$$archive" && test -f "$$archive.sha256" || { printf 'reach install: run make package first\n' >&2; exit 1; }
	(cd dist && sha256sum -c "$(ARCHIVE).sha256")
	base="$$HOME/.local/lib/sno-reach"
	command="$$HOME/.local/bin/sno-reach"
	[[ ! -e "$$command" || -L "$$command" ]] || { printf 'reach install: command is not a symlink: %s\n' "$$command" >&2; exit 1; }
	mkdir -p "$$base/releases" "$$HOME/.local/bin"
	stage="$$(mktemp -d "$$base/releases/.install.XXXXXX")"
	trap 'test ! -d "$$stage" || rm -r -- "$$stage"' EXIT
	tar -xzf "$$archive" -C "$$stage"
	[[ "$$(<"$$stage/VERSION")" == "$(VERSION)" && -x "$$stage/bin/sno-reach" ]]
	dest="$$base/releases/$(VERSION)"
	if [[ -e "$$dest" ]]; then
		diff -qr "$$stage" "$$dest"
	elif ! mv -T -- "$$stage" "$$dest"; then
		diff -qr "$$stage" "$$dest"
	fi
	[[ "$$(readlink "$$base/current" || true)" == "$$dest" ]] || ln -sfnT -- "$$dest" "$$base/current"
	[[ "$$(readlink "$$command" || true)" == "$$base/current/bin/sno-reach" ]] || ln -sfnT -- "$$base/current/bin/sno-reach" "$$command"
