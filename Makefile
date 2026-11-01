.DEFAULT_GOAL := help
.PHONY: help up down build restart ps shell logs install models typecheck lint test coverage e2e screenshots migrate seed fresh eval-generate eval

APP := web
EXEC := docker compose exec $(APP)
E2E := docker compose -p echdyn-e2e -f docker-compose.yml -f docker-compose.e2e.yml
# Screenshots slow the stub model so the list can be caught mid-extraction
screenshots: export STUB_DELAY_MS := 3000

-include .env

help: ## List available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Start all containers in the background
	@docker compose up -d

down: ## Stop and remove containers
	@docker compose down

build: ## Rebuild the app image
	@docker compose build

restart: ## Restart the web and worker containers
	@docker compose restart web worker

ps: ## Show container status and health
	@docker compose ps

shell: ## Open a shell in the web container
	@$(EXEC) bash

logs: ## Tail web and worker logs
	@docker compose logs -f web worker

install: ## Reinstall workspace dependencies inside the containers
	@docker compose run --rm deps

models: ## Pull the configured text and vision models into Ollama
	@docker compose exec ollama ollama pull $(or $(OLLAMA_TEXT_MODEL),qwen3:8b)
	@docker compose exec ollama ollama pull $(or $(OLLAMA_VISION_MODEL),qwen2.5vl:7b)

typecheck: ## Run tsc --noEmit across the workspace
	@$(EXEC) pnpm typecheck

lint: ## Run Prettier and ESLint checks
	@$(EXEC) pnpm lint

test: ## Run the Vitest suite
	@$(EXEC) pnpm test

coverage: ## Run tests with coverage (90% minimum)
	@$(EXEC) pnpm test:coverage

# The isolated stack for Playwright: up, migrated and seeded; runs $(1), then always tears down
define e2e_run
	@$(E2E) up -d -V --wait web worker ollama-stub
	@$(E2E) exec -T web pnpm db:migrate
	@$(E2E) exec -T web pnpm db:seed
	@$(E2E) run --rm $(1) playwright; status=$$?; $(E2E) rm -fsv storage; $(E2E) down; exit $$status
endef

e2e: ## Run the Playwright review flow on an isolated stack with a stub model
	$(call e2e_run,)

screenshots: ## Capture the README and site screenshots into docs/images (isolated stack)
	@$(E2E) down >/dev/null 2>&1 || true
	$(call e2e_run,-e SCREENSHOTS=1)

migrate: ## Run database migrations
	@$(EXEC) pnpm db:migrate

seed: ## Seed the database
	@$(EXEC) pnpm db:seed

fresh: ## Drop all tables, re-run migrations and seed
	@$(EXEC) pnpm db:fresh

eval-generate: ## Regenerate the labelled bill sets (synthetic, scanned, mixed) in eval/sets
	@$(EXEC) pnpm eval:generate

eval: ## Measure accuracy on the labelled sets (MODELS=a,b VISION_MODEL=m LIMIT="n" or LIMIT="scanned=n mixed=n")
	@$(EXEC) pnpm eval $(if $(MODELS),--models $(MODELS)) $(if $(VISION_MODEL),--vision-model $(VISION_MODEL)) $(foreach limit,$(LIMIT),--limit $(limit))
