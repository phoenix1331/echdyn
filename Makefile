.DEFAULT_GOAL := help
.PHONY: help up down build restart ps shell logs install models typecheck lint test coverage migrate seed fresh

APP := web
EXEC := docker compose exec $(APP)

-include .env

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

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

migrate: ## Run database migrations
	@$(EXEC) pnpm db:migrate

seed: ## Seed the database
	@$(EXEC) pnpm db:seed

fresh: ## Drop all tables, re-run migrations and seed
	@$(EXEC) pnpm db:fresh
