SHELL := /bin/bash
API_PORT ?= 8788
WEB_PORT ?= 5173
RUN_DIR := .dev

# Two processes: the API runs in the real Workers runtime against a local D1
# file, and Vite serves the web app and proxies /api to it, so the browser stays
# single-origin exactly as it will in production.

# Everything below is plain bash except how a port is inspected, which is the
# one thing macOS and Linux do differently. macOS keeps `lsof`, as it always
# has. Linux uses `ss`, which ships with every Ubuntu (lsof often does not), and
# falls back to lsof when ss is missing.
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
  # port_busy PORT      → exit 0 when something listens on PORT
  # port_pid PORT       → the pid holding PORT
  # port_show PORT      → a line per listener, for a human
  PORT_FUNCS := \
    port_busy() { lsof -nP -iTCP:$$1 -sTCP:LISTEN >/dev/null 2>&1; }; \
    port_pid() { lsof -nP -iTCP:$$1 -sTCP:LISTEN -t | head -1; }; \
    port_show() { lsof -nP -iTCP:$$1 -sTCP:LISTEN | tail -n +2; };
else ifeq ($(UNAME_S),Linux)
  ifneq ($(shell command -v ss 2>/dev/null),)
    PORT_FUNCS := \
      port_busy() { [ -n "$$(ss -ltnH "sport = :$$1")" ]; }; \
      port_pid() { ss -ltnpH "sport = :$$1" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1; }; \
      port_show() { ss -ltnpH "sport = :$$1"; };
  else
    PORT_FUNCS := \
      port_busy() { lsof -nP -iTCP:$$1 -sTCP:LISTEN >/dev/null 2>&1; }; \
      port_pid() { lsof -nP -iTCP:$$1 -sTCP:LISTEN -t | head -1; }; \
      port_show() { lsof -nP -iTCP:$$1 -sTCP:LISTEN | tail -n +2; };
  endif
else
  $(error make start/stop support macOS and Linux; this is $(UNAME_S))
endif

# A process and every descendant, deepest first. `npx` starts a chain — npm,
# a shell, node, and for the API the workerd runtime — and on Linux killing the
# top of it leaves the rest running with the port still open.
TREE_FUNC := tree() { local child; for child in $$(pgrep -P $$1); do tree $$child; done; echo $$1; };

.PHONY: start start-overdue stop

# start: build, migrate the local database, and run the API and the web app.
start:
	@mkdir -p $(RUN_DIR)
	@$(PORT_FUNCS) \
	for port in $(API_PORT) $(WEB_PORT); do \
		if port_busy $$port; then \
			echo "port $$port is already in use:"; \
			port_show $$port | sed 's/^/  /'; \
			echo "run 'make stop' if it is ours, or free it yourself if it is not."; \
			exit 1; \
		fi; \
	done
	@echo "→ building the web assets"
	@npm run build >/dev/null
	@echo "→ applying migrations to the local database"
	@npx wrangler d1 migrations apply planify --local >/dev/null 2>&1
	@echo "→ starting the API on $(API_PORT)"
	@npx wrangler pages dev --port $(API_PORT) > $(RUN_DIR)/api.log 2>&1 & echo $$! > $(RUN_DIR)/api.pid
	@echo "→ starting the web app on $(WEB_PORT)"
	@# The host is explicit: left to itself Vite binds "localhost", which Ubuntu
	@# resolves to ::1 only, and the check below — and the URL printed at the
	@# end — are on 127.0.0.1.
	@npx vite --host 127.0.0.1 --port $(WEB_PORT) --strictPort > $(RUN_DIR)/web.log 2>&1 & echo $$! > $(RUN_DIR)/web.pid
	@ready=1; \
	for i in $$(seq 1 60); do \
		curl -s --max-time 2 http://127.0.0.1:$(API_PORT)/api/health >/dev/null 2>&1 && { ready=0; break; }; \
		sleep 1; \
	done; \
	if [ $$ready -ne 0 ]; then \
		echo "the API never answered on $(API_PORT). Last lines of $(RUN_DIR)/api.log:"; \
		tail -n 15 $(RUN_DIR)/api.log | sed 's/^/  /'; \
		exit 1; \
	fi
	@ready=1; \
	for i in $$(seq 1 60); do \
		curl -s --max-time 2 -o /dev/null http://127.0.0.1:$(WEB_PORT)/ && { ready=0; break; }; \
		sleep 1; \
	done; \
	if [ $$ready -ne 0 ]; then \
		echo "the web app never answered on $(WEB_PORT). Last lines of $(RUN_DIR)/web.log:"; \
		tail -n 15 $(RUN_DIR)/web.log | sed 's/^/  /'; \
		exit 1; \
	fi
	@items=$$(curl -s --max-time 5 http://127.0.0.1:$(API_PORT)/api/health | sed -n 's/.*"items":\([0-9]*\).*/\1/p'); \
	echo; \
	if [ "$$items" = "0" ] || [ -z "$$items" ]; then \
		echo "the database has no items yet. Load a roadmap with:"; \
		echo "  npm run seed:sql && npx wrangler d1 execute planify --local --file build/seed.sql"; \
	else \
		echo "$$items items loaded"; \
	fi
	@echo "app  http://127.0.0.1:$(WEB_PORT)"
	@echo "api  http://127.0.0.1:$(API_PORT)/api/state"
	@echo "logs $(RUN_DIR)/api.log · $(RUN_DIR)/web.log"

# start-overdue: start, with the local plan moved four weeks into the past
# first, so there are late items to look at. Works on a running app too: it then
# only shifts and reprojects. Rewrites the local database's dates; reload the
# seed with --with-dates to get the originals back.
start-overdue:
	@mkdir -p $(RUN_DIR)
	@echo "→ moving the local plan four weeks into the past"
	@npx wrangler d1 migrations apply planify --local >/dev/null 2>&1
	@npx wrangler d1 execute planify --local --file tools/dev/overdue.sql >/dev/null 2>&1 \
		|| { echo "could not shift the local plan; run it by hand to see why:"; \
		     echo "  npx wrangler d1 execute planify --local --file tools/dev/overdue.sql"; exit 1; }
	@if curl -s --max-time 2 http://127.0.0.1:$(API_PORT)/api/health >/dev/null 2>&1; then \
		echo "→ the app is already running; keeping it"; \
	else \
		$(MAKE) --no-print-directory start || exit 1; \
	fi
	@echo "→ recomputing the projections"
	@code=$$(curl -s --max-time 30 -o $(RUN_DIR)/reproject.json -w '%{http_code}' \
		-X POST http://127.0.0.1:$(API_PORT)/api/reproject); \
	if [ "$$code" != "200" ]; then \
		echo "reproject answered $$code:"; sed 's/^/  /' $(RUN_DIR)/reproject.json; echo; exit 1; \
	fi
	@echo "the plan now started four weeks ago · app http://127.0.0.1:$(WEB_PORT)"

# stop: stop only what start launched. Never a broad pkill: a development
# machine usually has other servers running, and some of them are on these
# ports.
stop:
	@$(TREE_FUNC) \
	stopped=0; \
	for entry in api:$(API_PORT) web:$(WEB_PORT); do \
		name=$${entry%%:*}; port=$${entry##*:}; \
		file=$(RUN_DIR)/$$name.pid; \
		[ -f "$$file" ] || continue; \
		pid=$$(cat $$file); \
		if kill -0 $$pid 2>/dev/null; then \
			if ps -p $$pid -o command= | grep -qE 'wrangler|vite'; then \
				kill $$(tree $$pid) 2>/dev/null || true; \
				echo "stopped $$name (pid $$pid)"; \
				stopped=1; \
			else \
				echo "pid $$pid is no longer ours — leaving it alone"; \
			fi; \
		fi; \
		rm -f $$file; \
	done; \
	[ $$stopped -eq 1 ] || echo "nothing of ours was running"
	@# Vite ignores SIGTERM, so a child can outlive the parent we just killed.
	@# The port is the honest check, and only a process from this project's
	@# node_modules is ever escalated to SIGKILL.
	@$(PORT_FUNCS) \
	for port in $(API_PORT) $(WEB_PORT); do \
		for i in 1 2 3 4 5; do \
			port_busy $$port || break; \
			sleep 1; \
		done; \
		port_busy $$port || continue; \
		holder=$$(port_pid $$port); \
		if [ -z "$$holder" ]; then \
			echo "port $$port is held by a process this user cannot see:"; \
			port_show $$port | sed 's/^/  /'; \
		elif ps -p $$holder -o command= | grep -q "$(CURDIR)/node_modules"; then \
			kill -9 $$holder 2>/dev/null || true; \
			echo "port $$port needed SIGKILL (pid $$holder)"; \
		else \
			echo "port $$port is held by a process we did not start:"; \
			ps -p $$holder -o pid=,command= | cut -c1-120 | sed 's/^/  /'; \
		fi; \
	done
