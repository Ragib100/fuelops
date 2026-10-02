# FuelOps top-level convenience targets.
# All commands are thin wrappers around `docker compose` / `curl` / `k6`.
# Run `make help` to list them.

COMPOSE := docker compose
API_URL := http://localhost:8080
FRONTEND_URL := http://localhost:3000
GRAFANA_URL := http://localhost:3001
PROMETHEUS_URL := http://localhost:9090

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: env
env: ## Copy .env.example to .env (only if .env doesn't already exist).
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env — please fill in DATABASE_URL"; else echo ".env already exists"; fi

.PHONY: up
up: env ## docker compose up --build (builds images, starts everything).
	$(COMPOSE) up -d --build

.PHONY: down
down: ## docker compose down (keeps volumes).
	$(COMPOSE) down

.PHONY: nuke
nuke: ## docker compose down -v (DELETES volumes incl. grafana-storage).
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Tail logs from all services.
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## Show container status.
	$(COMPOSE) ps

.PHONY: smoke
smoke: ## Quick smoke test against the running stack.
	@echo "--- API health ---"
	@curl -fsS $(API_URL)/health && echo
	@echo "--- Frontend ---"
	@curl -fsS -o /dev/null -w "HTTP %{http_code}\n" $(FRONTEND_URL)/
	@echo "--- Prometheus ---"
	@curl -fsS -o /dev/null -w "HTTP %{http_code}\n" $(PROMETHEUS_URL)/-/ready
	@echo "--- Grafana ---"
	@curl -fsS -o /dev/null -w "HTTP %{http_code}\n" $(GRAFANA_URL)/api/health

.PHONY: loadtest
loadtest: ## Run the k6 load test (50 VUs × 2 min).
	k6 run --out json=loadtest/results.json loadtest/decision-path.js

.PHONY: single-decision
single-decision: ## Run the single-decision k6 smoke test.
	k6 run loadtest/single-decision.js

.PHONY: open
open: ## Open the operator URLs in your default browser.
	@echo "Dashboard: $(FRONTEND_URL)"
	@echo "API docs:  $(API_URL)/docs"
	@echo "Grafana:   $(GRAFANA_URL) (admin/admin)"
	@echo "Prom:      $(PROMETHEUS_URL)"